#!/usr/bin/env bash
# ==============================================================================
#  OmniLang launcher — asks Docker or Native, checks every prerequisite, starts
#  the stack and opens the browser. Works on macOS (Apple Silicon/Intel) and Linux.
#
#  Usage:  ./start.sh            interactive (remembers your last choice)
#          ./start.sh --native   skip the question, run natively
#          ./start.sh --docker   skip the question, run with Docker Compose
#          ./start.sh --stop     stop everything OmniLang started
# ==============================================================================
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

STATE_DIR="$APP_DIR/.omnilang"
MODE_FILE="$STATE_DIR/launch-mode"
LOG_FILE="$STATE_DIR/server.log"
PORT="${PORT:-5001}"
APP_URL="http://localhost:$PORT"
DEFAULT_MODEL="mistral-nemo:12b"
mkdir -p "$STATE_DIR"

B=$'\033[1m'; D=$'\033[2m'; R=$'\033[0m'
BLUE=$'\033[38;5;33m'; GREEN=$'\033[38;5;35m'; YELLOW=$'\033[38;5;214m'; RED=$'\033[38;5;203m'

ok()    { echo "  ${GREEN}✓${R} $*"; }
info()  { echo "  ${BLUE}›${R} $*"; }
warn()  { echo "  ${YELLOW}!${R} $*"; }
fail()  { echo "  ${RED}✗${R} $*"; }
step()  { echo; echo "${B}$*${R}"; }
die()   { fail "$*"; echo; exit 1; }

IS_TTY=0; [ -t 0 ] && [ -t 1 ] && IS_TTY=1
OS="$(uname -s)"; ARCH="$(uname -m)"

# ask "question" default(y/n) -> returns 0 for yes
ask() {
    local q="$1" def="${2:-y}" ans hint="[Y/n]"
    [ "$def" = "n" ] && hint="[y/N]"
    # Without a terminal, never consent to installs or downloads.
    if [ $IS_TTY -eq 0 ]; then [ "${ASSUME_YES:-0}" = "1" ]; return; fi
    read -r -p "  ${B}?${R} $q $hint " ans
    ans="${ans:-$def}"
    [[ "$ans" =~ ^[Yy] ]]
}

open_url() {
    if [ "$OS" = "Darwin" ]; then open "$1"
    elif command -v xdg-open >/dev/null; then xdg-open "$1" >/dev/null 2>&1
    else info "Open $1 in your browser"; fi
}

wait_for() { # url seconds
    local i
    for ((i = 0; i < $2; i++)); do
        curl -fs -m 2 "$1" >/dev/null 2>&1 && return 0
        sleep 1
    done
    return 1
}

env_get() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-; }
env_set() {
    if grep -qE "^$1=" .env 2>/dev/null; then
        sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak
    else
        echo "$1=$2" >> .env
    fi
}

host_tz() {
    if [ -n "${TZ:-}" ]; then echo "$TZ"; return; fi
    local link; link="$(readlink /etc/localtime 2>/dev/null || true)"
    [ -n "$link" ] && echo "${link#*zoneinfo/}" || echo "UTC"
}

# ------------------------------------------------------------------------------
banner() {
    clear 2>/dev/null || true
    echo
    echo "   ${B}OmniLang${R}  ${D}— learn German with a local AI tutor${R}"
    local mem=""
    if [ "$OS" = "Darwin" ]; then
        mem="$(( $(sysctl -n hw.memsize) / 1073741824 )) GB"
        echo "   ${D}$(sysctl -n machdep.cpu.brand_string 2>/dev/null) · $mem unified memory · macOS $(sw_vers -productVersion)${R}"
    else
        echo "   ${D}$OS $ARCH${R}"
    fi
}

# stop_all [app-only] — app-only keeps the MongoDB container up (used when switching modes)
stop_all() {
    step "Stopping OmniLang"
    if [ -f "$STATE_DIR/server.pid" ] && kill -0 "$(cat "$STATE_DIR/server.pid")" 2>/dev/null; then
        kill "$(cat "$STATE_DIR/server.pid")" && ok "Native server stopped"
    fi
    rm -f "$STATE_DIR/server.pid"
    if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
        if [ "${1:-}" = "app-only" ]; then
            docker compose ps -q app 2>/dev/null | grep -q . && docker compose stop app >/dev/null 2>&1 && ok "App container stopped"
        else
            docker compose ps -q 2>/dev/null | grep -q . && docker compose stop >/dev/null 2>&1 && ok "Docker containers stopped"
        fi
    fi
    ok "Done. Ollama keeps running in the menu bar (quit it there to free memory)."
}

# ------------------------------------------------------------------------------
choose_mode() {
    local last="native"; [ -f "$MODE_FILE" ] && last="$(cat "$MODE_FILE")"
    for a in "$@"; do
        case "$a" in --native) echo native; return;; --docker) echo docker; return;; esac
    done
    if [ $IS_TTY -eq 0 ]; then echo "$last"; return; fi

    local n1="" n2=""
    [ "$last" = "native" ] && n1=" ${D}(last used)${R}"
    [ "$last" = "docker" ] && n2=" ${D}(last used)${R}"
    {
        echo
        echo "   How do you want to run OmniLang?"
        echo
        echo "   ${B}1${R}  Native$n1"
        echo "      ${D}Node + MongoDB run directly on your Mac. Fastest start, easiest to develop.${R}"
        echo "   ${B}2${R}  Docker$n2"
        echo "      ${D}App + MongoDB in containers. Nothing installed on your Mac but Docker.${R}"
        echo
        echo "   ${D}Either way, Ollama runs natively so the model uses the Apple GPU (Metal).${R}"
        echo
    } >&2
    local def=1; [ "$last" = "docker" ] && def=2
    local choice
    read -r -p "   Choose 1 or 2 [$def]: " choice
    choice="${choice:-$def}"
    case "$choice" in 2|d|docker) echo docker;; *) echo native;; esac
}

# ------------------------------------------------------------------------------
ensure_env() {
    if [ ! -f .env ]; then
        cp .env.example .env
        ok "Created .env from .env.example"
    fi
    env_set TZ "$(host_tz)"
}

ensure_brew() {
    command -v brew >/dev/null && return 0
    [ "$OS" != "Darwin" ] && return 1
    warn "Homebrew is not installed (needed to install missing tools)."
    info "Install it from https://brew.sh, then run ./start.sh again."
    return 1
}

ensure_ollama() {
    step "Local AI engine (Ollama)"
    if ! command -v ollama >/dev/null && [ ! -d /Applications/Ollama.app ]; then
        warn "Ollama is not installed."
        if [ "$OS" = "Darwin" ] && ensure_brew && ask "Install Ollama with Homebrew now?"; then
            brew install --cask ollama || die "Ollama install failed"
        else
            die "Install Ollama from https://ollama.com/download and run ./start.sh again."
        fi
    fi

    if ! curl -fs -m 2 http://localhost:11434/api/tags >/dev/null; then
        info "Starting Ollama…"
        if [ "$OS" = "Darwin" ] && [ -d /Applications/Ollama.app ]; then
            open -g -a Ollama
        else
            (OLLAMA_KEEP_ALIVE=1h nohup ollama serve >"$STATE_DIR/ollama.log" 2>&1 &)
        fi
        wait_for http://localhost:11434/api/tags 30 || die "Ollama did not start. Open the Ollama app manually and retry."
    fi
    ok "Ollama is running $(ollama --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 | sed 's/^/v/')"

    local model; model="$(env_get OLLAMA_MODEL)"; model="${model:-$DEFAULT_MODEL}"
    if curl -fs http://localhost:11434/api/tags | grep -q "\"name\":\"$model\""; then
        ok "Model $model is installed"
    else
        warn "Model $model is not downloaded yet (about 7 GB for mistral-nemo:12b)."
        if ask "Download it now?"; then
            ollama pull "$model" || die "Model download failed"
            ok "Model $model downloaded"
        else
            warn "Continuing without it — AI features stay offline until you run: ollama pull $model"
        fi
    fi
}

port_owner() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1" (pid "$2")"}'; }

ensure_port_free() {
    local owner; owner="$(port_owner)"
    [ -z "$owner" ] && return 0
    if curl -fs -m 2 "$APP_URL/api/health" >/dev/null; then
        warn "OmniLang is already running on port $PORT ($owner)."
        if ASSUME_YES=1 ask "Restart it in $1 mode?"; then
            stop_all app-only >/dev/null
            [ -n "$(port_owner)" ] && lsof -ti:"$PORT" | xargs kill 2>/dev/null
            sleep 1
        else
            open_url "$APP_URL"; exit 0
        fi
    else
        die "Port $PORT is used by $owner. Stop it or set PORT in .env."
    fi
}

# ---- Native -------------------------------------------------------------------
ensure_node() {
    step "Node.js"
    if ! command -v node >/dev/null; then
        if ensure_brew && ask "Node.js is missing. Install it with Homebrew?"; then
            brew install node || die "Node install failed"
        else
            die "Install Node.js 20+ from https://nodejs.org"
        fi
    fi
    local major; major="$(node -p 'process.versions.node.split(".")[0]')"
    [ "$major" -ge 18 ] || die "Node $major is too old — OmniLang needs Node 18+ (brew upgrade node)."
    ok "Node $(node -v)"
    if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
        info "Installing dependencies…"
        npm ci --no-audit --no-fund --loglevel=error || npm install --no-audit --no-fund || die "npm install failed"
    fi
    ok "Dependencies ready"
}

mongo_up() { (exec 3<>/dev/tcp/127.0.0.1/27017) 2>/dev/null; }

ensure_mongo_native() {
    step "Database (MongoDB)"
    if mongo_up; then ok "MongoDB is running on 27017"; return; fi

    if command -v brew >/dev/null && brew list mongodb-community >/dev/null 2>&1; then
        info "Starting MongoDB service…"
        brew services start mongodb-community >/dev/null
    else
        warn "MongoDB is not running."
        echo "      ${B}1${R} Install MongoDB with Homebrew ${D}(fully native)${R}"
        echo "      ${B}2${R} Run only MongoDB in Docker ${D}(no install, needs Docker Desktop)${R}"
        local c="2"
        if [ $IS_TTY -eq 1 ]; then
            read -r -p "      Choose 1 or 2 [1]: " c; c="${c:-1}"
        elif ! command -v docker >/dev/null; then
            die "MongoDB is not running. Re-run ./start.sh in a terminal to set it up."
        fi
        if [ "$c" = "2" ]; then
            ensure_docker_daemon
            docker compose up -d mongo >/dev/null || die "Could not start MongoDB container"
        else
            ensure_brew || die "Homebrew is required to install MongoDB natively."
            info "Installing MongoDB Community from the official mongodb/brew tap…"
            brew tap mongodb/brew >/dev/null || die "Could not add the mongodb/brew tap"
            # Newer Homebrew refuses third-party taps until they are trusted.
            brew trust mongodb/brew >/dev/null 2>&1 || true
            HOMEBREW_NO_AUTO_UPDATE=1 brew install mongodb-community || die "MongoDB install failed"
            brew services start mongodb-community >/dev/null
        fi
    fi
    for _ in $(seq 1 30); do mongo_up && break; sleep 1; done
    mongo_up || die "MongoDB did not come up on 27017."
    ok "MongoDB is running on 27017"
}

run_native() {
    ensure_port_free native
    ensure_node
    ensure_mongo_native
    ensure_env
    env_set MONGO_URI "mongodb://127.0.0.1:27017/tanim_german"
    env_set OLLAMA_ENDPOINT "http://localhost:11434/api/chat"
    ensure_ollama

    step "Starting OmniLang"
    TZ="$(host_tz)" nohup node src/server.js >"$LOG_FILE" 2>&1 &
    echo $! > "$STATE_DIR/server.pid"
    if wait_for "$APP_URL/api/health" 60; then
        ok "Running at ${B}$APP_URL${R}"
    else
        fail "Server did not start. Last log lines:"; tail -20 "$LOG_FILE"; exit 1
    fi
    finish native
}

# ---- Docker -------------------------------------------------------------------
ensure_docker_daemon() {
    command -v docker >/dev/null || die "Docker is not installed. Get Docker Desktop: https://www.docker.com/products/docker-desktop"
    if ! docker info >/dev/null 2>&1; then
        info "Starting Docker Desktop…"
        [ "$OS" = "Darwin" ] && open -g -a Docker
        for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
        docker info >/dev/null 2>&1 || die "Docker did not start. Open Docker Desktop and retry."
    fi
}

run_docker() {
    step "Docker"
    ensure_docker_daemon
    ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
    ensure_port_free docker
    ensure_env
    ensure_ollama

    step "Starting containers"
    export TZ; TZ="$(host_tz)"
    docker compose up -d --build || die "docker compose failed"
    if wait_for "$APP_URL/api/health" 90; then
        ok "Running at ${B}$APP_URL${R}"
    else
        fail "App container is not healthy. Recent logs:"; docker compose logs --tail 30 app; exit 1
    fi
    finish docker
}

finish() {
    echo "$1" > "$MODE_FILE"
    echo
    echo "   ${GREEN}${B}Viel Erfolg!${R}  Opening ${B}$APP_URL${R}"
    echo "   ${D}Stop with: ./start.sh --stop   ·   Logs: $([ "$1" = docker ] && echo 'docker compose logs -f app' || echo "tail -f .omnilang/server.log")${R}"
    echo
    open_url "$APP_URL"
}

# ------------------------------------------------------------------------------
for a in "$@"; do
    case "$a" in
        --stop) stop_all; exit 0;;
        -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    esac
done

banner
MODE="$(choose_mode "$@")"
echo; echo "   ${B}Mode:${R} $MODE"
if [ "$MODE" = "docker" ]; then run_docker; else run_native; fi
