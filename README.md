# OmniLang — German Learning Platform

Local-first, CEFR-aligned (A1–B2) German learning app with conversational AI, essay grading, graded reading, and spaced-repetition vocabulary. Runs entirely on local Ollama models — no cloud API keys needed.

---

## Prerequisites

Install and start these before running the app:

### 1. MongoDB
```bash
# Install (Ubuntu/Debian)
sudo apt install -y mongodb-org

# Start the service
sudo systemctl start mongod
sudo systemctl enable mongod   # optional: auto-start on boot

# Verify
mongosh --eval "db.adminCommand('ping')"
```

### 2. Ollama + Model
```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Start the Ollama server (keep this terminal open, or run as a service)
ollama serve

# Pull the required model (in a separate terminal)
ollama pull llama3.2

# Verify models available
curl http://localhost:11434/api/tags
```

---

## First-Time Setup

```bash
cd /home/tm/Downloads/learnGerman

# Copy environment config (pre-configured with sensible defaults)
cp .env.example .env

# Install Node dependencies
npm install
```

The default `.env` values work out of the box:
| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5001` | Express server port |
| `MONGO_URI` | `mongodb://localhost:27017/tanim_german` | MongoDB connection |
| `OLLAMA_ENDPOINT` | `http://localhost:11434/api/chat` | Ollama API |
| `OLLAMA_MODEL` | `qwen3:14b` | Model used for all AI features |
| `OLLAMA_ORIGINS` | `*` | CORS allowed origins |

---

## Running the App

```bash
npm run dev
```

Then open **http://localhost:5001** in your browser.

> `npm run dev` uses `nodemon` for auto-reload on file changes and sets `OLLAMA_ORIGINS="*"`.  
> For production: `npm start` (plain Node, no auto-reload).

---

## Checklist Before Opening the Browser

- [ ] `mongod` is running
- [ ] `ollama serve` is running
- [ ] `qwen3:14b` or `llama3.2` model is pulled
- [ ] `.env` file exists (copied from `.env.example`)
- [ ] `npm install` has been run at least once
- [ ] `npm run dev` shows `✓ MongoDB connected` and `✓ Tanim.ai running → http://localhost:5001`

---

## Project Structure

```
public/          # Static frontend (served at http://localhost:5001)
  index.html     # Main single-page app
  login.html
  dashboard.html
  app.js
  style.css
src/
  server.js      # Express API gateway (port 5001)
  models/        # Mongoose schemas
    User.js      # CEFR level, streaks, SRS data
    Conversation.js
    Vocabulary.js
  routes/
    auth.js
    chat.js        # /api/chat   — AI conversation
    coach.js       # /api/coach  — AI Learning Advisor / Coach
    settings.js    # /api/settings — Model & System settings
    vocabulary.js  # /api/vocabulary — SRS flashcards
    reading.js     # /api/reading — CEFR-graded stories
    essay.js       # /api/essay/grade — writing evaluation
```

## API Health Check

```bash
curl http://localhost:5001/api/health
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `✗ Port 5001 in use` | `lsof -ti:5001 \| xargs kill` |
| `MongoServerError` / connection refused | `sudo systemctl start mongod` |
| Ollama requests fail | `ollama serve` is not running, or model not pulled |
| No AI response | Run `ollama pull llama3.2` to ensure the model is downloaded |
