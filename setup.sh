#!/usr/bin/env bash
# ==============================================================================
#  OmniLang — 1-Command Automated Local Setup & Deployment
#  Local-first CEFR-aligned German learning platform with AI speaking immersion
# ==============================================================================

# Ensure TCMalloc compatibility with Linux kernels >= 6.19 for MongoDB
export GLIBC_TUNABLES="glibc.pthread.rseq=1"

# Terminal formatting
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

MODE="start"
for arg in "$@"; do
    case "$arg" in
        --dev)
            MODE="dev"
            ;;
        --doctor|--check-only)
            MODE="doctor"
            ;;
        --docker)
            MODE="docker"
            ;;
        -h|--help)
            echo -e "${CYAN}${BOLD}OmniLang Setup & Local Deployment CLI${NC}"
            echo -e "Usage: ./setup.sh [OPTIONS]\n"
            echo "Options:"
            echo "  (no args)           Run full automated setup and launch OmniLang in production mode"
            echo "  --dev               Run setup and launch in development mode (hot reload via nodemon)"
            echo "  --doctor            Run system diagnostics & prerequisite checks without launching"
            echo "  --docker            Deploy the complete stack using Docker Compose"
            echo "  -h, --help          Show this help message"
            exit 0
            ;;
        *)
            echo -e "${YELLOW}Unknown option: $arg${NC}. Use --help for usage."
            ;;
    esac
done

echo -e "${CYAN}${BOLD}"
echo "  ================================================================"
echo "      ___                 _  __                     "
echo "     / _ \ _ __ ___  _ __ (_)/ /   __ _ _ __   __ _ "
echo "    | | | | '_ \` _ \| '_ \| | |   / _\` | '_ \ / _\` |"
echo "    | |_| | | | | | | | | | | |__| (_| | | | | (_| |"
echo "     \___/|_| |_| |_|_| |_|_|\____/\__,_|_| |_|\__, |"
echo "                                               |___/ "
echo "    OmniLang — Automated 1-Step Setup & Local Deployment"
echo "  ================================================================"
echo -e "${NC}"

# Handle Docker Compose mode directly if requested
if [ "$MODE" = "docker" ]; then
    echo -e "${CYAN}▶ Launching OmniLang via Docker Compose...${NC}"
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}✗ Docker is not installed. Please install Docker or run './setup.sh' for native setup.${NC}"
        exit 1
    fi
    docker compose up -d --build
    echo -e "\n${GREEN}${BOLD}✓ OmniLang containers are up and running!${NC}"
    echo -e "${GREEN}${BOLD}➜ Open your browser: http://localhost:5001${NC}\n"
    exit 0
fi

# ------------------------------------------------------------------------------
# 1. Environment & Configuration Check
# ------------------------------------------------------------------------------
echo -e "${CYAN}▶ [1/5] Preparing environment configuration...${NC}"

if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "  ${GREEN}✓ Created .env from .env.example${NC}"
    else
        cat <<EOF > .env
# OmniLang Environment Configuration
PORT=5001
MONGO_URI=mongodb://127.0.0.1:27017/tanim_german
OLLAMA_ENDPOINT=http://localhost:11434/api/chat
OLLAMA_MODEL=mistral-nemo:12b
CUDA_VISIBLE_DEVICES=0
OLLAMA_FLASH_ATTENTION=1
OLLAMA_NUM_PARALLEL=1
OLLAMA_KEEP_ALIVE=24h
OLLAMA_ORIGINS=*
EOF
        echo -e "  ${GREEN}✓ Generated default .env configuration (Port 5001)${NC}"
    fi
else
    echo -e "  ${GREEN}✓ Configuration file (.env) detected${NC}"
fi

# ------------------------------------------------------------------------------
# 2. Node.js & NPM Check
# ------------------------------------------------------------------------------
echo -e "\n${CYAN}▶ [2/5] Verifying Node.js & dependencies...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "  ${YELLOW}Node.js not found! Attempting automatic installation...${NC}"
    if command -v apt-get &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y nodejs
    elif command -v pacman &> /dev/null; then
        sudo pacman -S --noconfirm nodejs npm
    elif command -v brew &> /dev/null; then
        brew install node
    else
        echo -e "  ${RED}✗ Please install Node.js 18+ manually: https://nodejs.org${NC}"
        exit 1
    fi
fi

NODE_VERSION=$(node -v)
echo -e "  ${GREEN}✓ Node.js runtime: ${NODE_VERSION}${NC}"

if [ ! -d "node_modules" ] || [ package.json -nt node_modules ]; then
    echo -e "  ${CYAN}Installing npm dependencies...${NC}"
    npm install --no-audit --no-fund
    echo -e "  ${GREEN}✓ Node dependencies up to date${NC}"
else
    echo -e "  ${GREEN}✓ Node dependencies already installed${NC}"
fi

# Verify Vocab Bank dataset
if [ -f "src/data/vocabBank15k.json" ]; then
    DATASET_SIZE=$(wc -c < "src/data/vocabBank15k.json" 2>/dev/null || echo "0")
    echo -e "  ${GREEN}✓ 15,000-word CEFR Vocabulary Bank ready ($((DATASET_SIZE / 1024 / 1024)) MB)${NC}"
fi

# ------------------------------------------------------------------------------
# 3. MongoDB Database Verification & Auto-Startup
# ------------------------------------------------------------------------------
echo -e "\n${CYAN}▶ [3/5] Verifying MongoDB database service...${NC}"

check_mongo() {
    (echo > /dev/tcp/127.0.0.1/27017) >/dev/null 2>&1
}

if check_mongo; then
    echo -e "  ${GREEN}✓ MongoDB is online and accepting connections on port 27017${NC}"
else
    echo -e "  ${YELLOW}MongoDB not detected on port 27017. Starting automatically...${NC}"
    
    # Strategy A: Zero-privilege local user daemon (no sudo needed, bypasses kernel 6.19+ bug)
    if command -v mongod &> /dev/null; then
        DATA_DIR="$HOME/.omnilang/data/db"
        LOG_DIR="$HOME/.omnilang/logs"
        mkdir -p "$DATA_DIR" "$LOG_DIR"
        GLIBC_TUNABLES="glibc.pthread.rseq=1" mongod --dbpath "$DATA_DIR" --bind_ip 127.0.0.1 --port 27017 --fork --logpath "$LOG_DIR/mongod.log" >/dev/null 2>&1 || true
    fi

    # Strategy B: System service (if available & accessible)
    if ! check_mongo; then
        if command -v systemctl &> /dev/null; then
            systemctl start mongod 2>/dev/null || sudo -n systemctl start mongod 2>/dev/null || true
        elif command -v service &> /dev/null; then
            service mongodb start 2>/dev/null || sudo -n service mongodb start 2>/dev/null || true
        fi
    fi

    # Strategy C: Docker container fallback
    if ! check_mongo && command -v docker &> /dev/null; then
        DOCKER_BIN="docker"
        if ! docker info >/dev/null 2>&1 && docker --context default info >/dev/null 2>&1; then
            DOCKER_BIN="docker --context default"
        fi
        if $DOCKER_BIN info >/dev/null 2>&1; then
            echo -e "  ${CYAN}Starting MongoDB via Docker container...${NC}"
            $DOCKER_BIN run -d --name omnilang-mongo -p 27017:27017 -e GLIBC_TUNABLES="glibc.pthread.rseq=1" -v omnilang_data:/data/db mongo:7 >/dev/null 2>&1 || $DOCKER_BIN start omnilang-mongo >/dev/null 2>&1 || true
        fi
    fi

    # Wait up to 5 seconds for connection
    for i in {1..10}; do
        if check_mongo; then break; fi
        sleep 0.5
    done

    if check_mongo; then
        echo -e "  ${GREEN}✓ MongoDB started successfully on port 27017${NC}"
    else
        echo -e "  ${YELLOW}⚠️  Notice: MongoDB could not be started automatically without credentials.${NC}"
        echo -e "  ${YELLOW}To start MongoDB manually, run in another terminal:${NC}"
        echo -e "    ${BOLD}mongod --dbpath ~/.omnilang/data/db --port 27017${NC}"
        echo -e "    ${BOLD}or: docker run -d --name omnilang-mongo -p 27017:27017 mongo:7${NC}"
    fi
fi

# ------------------------------------------------------------------------------
# 4. Ollama AI Engine & Model Verification
# ------------------------------------------------------------------------------
echo -e "\n${CYAN}▶ [4/5] Verifying Ollama AI engine & models...${NC}"

if ! command -v ollama &> /dev/null; then
    echo -e "  ${YELLOW}Ollama not found. Installing official Ollama engine...${NC}"
    curl -fsSL https://ollama.com/install.sh | sh || {
        echo -e "  ${RED}Could not auto-install Ollama. Please install from https://ollama.com${NC}"
    }
fi

check_ollama() {
    curl -s --connect-timeout 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1
}

if ! check_ollama; then
    echo -e "  ${YELLOW}Starting Ollama service in background...${NC}"
    CUDA_VISIBLE_DEVICES="0" OLLAMA_FLASH_ATTENTION="1" OLLAMA_NUM_PARALLEL="1" OLLAMA_ORIGINS="*" ollama serve > /dev/null 2>&1 &
    
    for i in {1..12}; do
        if check_ollama; then break; fi
        sleep 0.5
    done
fi

if check_ollama; then
    echo -e "  ${GREEN}✓ Ollama service is active on http://localhost:11434${NC}"
    
    # Model check
    AVAILABLE_MODELS=$(curl -s http://127.0.0.1:11434/api/tags 2>/dev/null | grep -o '"name":"[^"]*"' | cut -d '"' -f4 || true)
    
    CONFIGURED_MODEL=$(grep -E "^OLLAMA_MODEL=" .env 2>/dev/null | cut -d '=' -f2 | tr -d '"' | tr -d "'" || echo "")
    CONFIGURED_MODEL=${CONFIGURED_MODEL:-mistral-nemo:12b}

    # Check if configured model or any compatible model is already present
    MODEL_READY=0
    if echo "$AVAILABLE_MODELS" | grep -q "${CONFIGURED_MODEL%%:*}"; then
        MODEL_READY=1
        echo -e "  ${GREEN}✓ Configured AI Model \"${CONFIGURED_MODEL}\" is ready in local library${NC}"
    elif [ -n "$AVAILABLE_MODELS" ]; then
        FIRST_MODEL=$(echo "$AVAILABLE_MODELS" | head -n 1)
        echo -e "  ${GREEN}✓ Detected installed local model: \"${FIRST_MODEL}\"${NC}"
        echo -e "  ${CYAN}  Adopting \"${FIRST_MODEL}\" as active model in .env${NC}"
        sed -i "s/^OLLAMA_MODEL=.*/OLLAMA_MODEL=${FIRST_MODEL}/" .env
        MODEL_READY=1
    fi

    if [ $MODEL_READY -eq 0 ]; then
        echo -e "  ${YELLOW}No local LLM found. Pulling model \"mistral-nemo:12b\"...${NC}"
        echo -e "  ${CYAN}(This is a one-time download for German conversations & grammar evaluation)${NC}"
        ollama pull mistral-nemo:12b || {
            echo -e "  ${YELLOW}⚠️ Model pull was interrupted. You can pull anytime via: ollama pull mistral-nemo:12b${NC}"
        }
        sed -i 's/^OLLAMA_MODEL=.*/OLLAMA_MODEL=mistral-nemo:12b/' .env
    fi
else
    echo -e "  ${YELLOW}⚠️  Ollama service not responding yet. The web app will auto-retry connecting on boot.${NC}"
fi

# ------------------------------------------------------------------------------
# 5. Diagnostic Summary or Application Launch
# ------------------------------------------------------------------------------
echo -e "\n${CYAN}▶ [5/5] Finalizing deployment...${NC}"

if [ "$MODE" = "doctor" ]; then
    echo -e "\n${GREEN}${BOLD}================================================================${NC}"
    echo -e "${GREEN}${BOLD}  ✓ OmniLang Environment Check Complete!${NC}"
    echo -e "${GREEN}${BOLD}  Ready to run:${NC}"
    echo -e "    ${BOLD}./setup.sh${NC}          (production start)"
    echo -e "    ${BOLD}./setup.sh --dev${NC}    (developer nodemon mode)"
    echo -e "    ${BOLD}docker compose up -d${NC} (Docker container mode)"
    echo -e "${GREEN}${BOLD}================================================================${NC}\n"
    exit 0
fi

echo -e "\n${GREEN}${BOLD}================================================================${NC}"
echo -e "${GREEN}${BOLD}  ✓ Setup complete! Launching OmniLang German Platform...${NC}"
echo -e "${GREEN}${BOLD}  ➜ Open your browser: http://localhost:5001${NC}"
echo -e "${GREEN}${BOLD}================================================================${NC}\n"

if [ "$MODE" = "dev" ]; then
    npm run dev
else
    npm start
fi
