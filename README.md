# OmniLang — AI-Powered German Learning Platform

A local-first, privacy-respecting, CEFR-aligned (A1–B2) German learning ecosystem featuring real-time conversational AI immersion, automated essay grading, graded reading comprehension, and Leitner spaced-repetition vocabulary loops. 

Runs 100% locally on your hardware using Ollama — zero cloud API keys, zero subscription fees, zero privacy leaks.

---

## ⚡ Quick Start (1-Minute Setup)

### Option A: One-Command Automated Setup (Recommended)

OmniLang includes an automated setup and deployment script that verifies your environment, auto-configures settings, ensures MongoDB and Ollama are active, downloads required models, and launches the app:

```bash
git clone git@github.com:tanim-ics/OmniLang.git
cd OmniLang
./setup.sh
```

Then open **http://localhost:5001** in your browser. That's it!

#### Setup Script Options
| Command | Action |
|---|---|
| `./setup.sh` | Full automated setup + launch in production mode |
| `./setup.sh --dev` | Full automated setup + launch in development mode (hot-reload via nodemon) |
| `./setup.sh --doctor` | Run system diagnostics & verify all prerequisites without launching |
| `./setup.sh --docker` | Launch the entire stack via Docker Compose |

---

### Option B: Docker Compose (Zero-Config Container)

If you have Docker and Docker Compose installed:

```bash
docker compose up -d
```

Open **http://localhost:5001**.

> **Note**: The container automatically connects to your host machine's Ollama service on port `11434` to utilize your host GPU acceleration.

---

### Option C: Manual Installation

If you prefer manual control:

1. **Clone repository & enter directory:**
   ```bash
   git clone git@github.com:tanim-ics/OmniLang.git
   cd OmniLang
   ```

2. **Copy environment variables:**
   ```bash
   cp .env.example .env
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Start MongoDB:**
   ```bash
   # Native service
   sudo systemctl start mongod
   
   # Or user-space daemon (safe for Linux kernels >= 6.19)
   GLIBC_TUNABLES="glibc.pthread.rseq=1" mongod --dbpath ~/.omnilang/data/db --port 27017 --fork --logpath ~/.omnilang/logs/mongod.log
   ```

5. **Start Ollama & verify model:**
   ```bash
   ollama serve
   ollama pull mistral-nemo:12b
   ```

6. **Launch OmniLang:**
   ```bash
   npm start
   # or for development:
   npm run dev
   ```

---

## 🛠️ NPM Command Reference

| Command | Description |
|---|---|
| `npm run setup` | Runs the automated 1-step installer & launches the app |
| `npm run doctor` | Runs the system health & environment diagnostics check |
| `npm start` | Boots OmniLang with GPU VRAM pre-warming |
| `npm run dev` | Boots OmniLang in development mode with nodemon hot-reloading |
| `npm run docker:up` | Starts MongoDB and OmniLang in Docker background containers |
| `npm run docker:down` | Stops all Docker containers |

---

## ⚙️ Environment Configuration (`.env`)

Default configuration values work out of the box:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5001` | Express web server and API port |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/tanim_german` | MongoDB connection string |
| `OLLAMA_ENDPOINT` | `http://localhost:11434/api/chat` | Ollama chat completion endpoint |
| `OLLAMA_MODEL` | `mistral-nemo:12b` | Active LLM for dialogue, reading & essay grading |
| `CUDA_VISIBLE_DEVICES` | `0` | NVIDIA GPU device ID for acceleration |
| `OLLAMA_FLASH_ATTENTION`| `1` | Enables flash attention for faster inference |
| `OLLAMA_KEEP_ALIVE` | `24h` | Keeps model pre-warmed in GPU VRAM |
| `OLLAMA_ORIGINS` | `*` | Allowed CORS origins for API requests |

---

## 📂 Project Architecture

```
OmniLang/
├── docker-compose.yml       # Production turnkey container configuration
├── Dockerfile               # Production container definition with healthchecks
├── setup.sh                 # 1-command automated installer & deployment engine
├── package.json             # Scripts & dependencies
├── .env.example             # Template environment configuration
├── public/                  # Frontend single-page application
│   ├── index.html           # Landing page
│   ├── dashboard.html       # Student command center & immersive UI
│   ├── app.js               # Audio synthesis, speech recognition, UI controllers
│   └── style.css            # Premium dark-mode UI design system
├── scripts/
│   ├── setup.js             # Diagnostic doctor script
│   └── build_vocab_bank_15k.py # 15,000-word CEFR dataset generator
└── src/
    ├── server.js            # Express API gateway & database auto-seeder
    ├── models/              # Mongoose schemas (User, Conversation, VocabBank)
    ├── routes/              # Modular Express API endpoints
    │   ├── auth.js          # User profiles, CEFR levels & streak tracking
    │   ├── chat.js          # Immersive conversational partner with error correction
    │   ├── coach.js         # AI learning advisor & study recommendations
    │   ├── essay.js         # CEFR-graded writing evaluation & grammar rubrics
    │   ├── reading.js       # Graded interactive story generation
    │   ├── settings.js      # Model selection & Ollama integration
    │   └── vocabulary.js    # 5-stage Leitner spaced repetition system (SRS)
    └── utils/
        └── ollamaManager.js # Ollama daemon lifecycle & GPU model pre-warming
```

---

## 🔍 System Health & Diagnostics

You can verify the status of all subsystems at any time:

```bash
# Terminal diagnostic report
npm run doctor

# Web API health check
curl http://localhost:5001/api/health
```

Expected response:
```json
{
  "status": "ok",
  "port": 5001,
  "activeModel": "mistral-nemo:12b",
  "timestamp": "2026-09-02T12:38:00.000Z",
  "mongoStatus": "connected"
}
```

---

## ❓ Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| **Port 5001 in use** | Previous instance still running | Run `lsof -ti:5001 \| xargs kill` or change `PORT` in `.env`. |
| **MongoDB failed on Linux kernel 6.19+** | TCMalloc RSEQ incompatibility (`SERVER-121912`) | Resolved automatically by `./setup.sh`. For manual runs, prepend `GLIBC_TUNABLES="glibc.pthread.rseq=1"`. |
| **Ollama connection refused** | Daemon not started | Run `ollama serve` or let `./setup.sh` start it in the background. |
| **AI response is slow on CPU** | GPU acceleration disabled | Set `CUDA_VISIBLE_DEVICES=0` and verify NVIDIA drivers with `nvidia-smi`. |
| **Vocabulary bank not populated** | Initial seed pending | `server.js` auto-seeds all 15,000 words on first MongoDB connection. Check logs for confirmation. |

---

## 📜 License

MIT License. Designed and engineered for local-first language mastery.
