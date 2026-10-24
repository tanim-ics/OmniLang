# CLAUDE.md — OmniLang (German learning, game edition)

Local-first, CEFR-aligned (A1–C1) German learning app. A local Ollama model (default `mistral-nemo:12b`) powers a chat tutor, speaking drills, essay grading, graded stories and vocabulary generation. Progress is gamified: XP, player levels, streaks with freezes, daily quests, combos and achievements. Primary target: **macOS on Apple Silicon** (Ollama runs natively on Metal); Linux works too.

## Run it
- **Launcher (asks Docker or Native, remembers the choice):** `./start.sh` · double-click `OmniLang.command` in Finder · `npm run launch`
  - Skip the question: `./start.sh --native` / `./start.sh --docker` · stop everything: `./start.sh --stop`
  - The launcher never installs or downloads without an interactive "yes" (non-TTY = no).
- Dev server with reload: `npm run dev` (needs MongoDB on 27017 and Ollama on 11434)
- Health: `curl localhost:5001/api/health` · Models: `curl localhost:11434/api/tags` · Doctor: `npm run doctor`
- Tests: `npm test` (admin/auth scripts in `tests/`)
- In **both** modes Ollama runs on the host. Docker on macOS has no GPU access, so never containerize Ollama there.

## Architecture
```
start.sh / OmniLang.command   launcher (native | docker), writes .env (MONGO_URI, TZ), state in .omnilang/
src/server.js                 Express gateway :5001, seeds 15k VocabBank, pre-warms the model
src/utils/
  ollama.js                   callOllama / callOllamaJSON, TASK presets, model cache, foreground priority
  proofread.js                temperature-0 sentence proofreader (shared by chat, speaking, essay)
  game.js                     XP, level curve, streaks + freezes, daily quests, achievements → progress snapshot
  ollamaManager.js            daemon start (Ollama.app on macOS), pre-warm, .env model switch
src/routes/
  auth.js      accounts, profile, daily-status (quests), settings; exports getOrCreateDailyStatus, checkAndAwardAchievements
  chat.js      tutor chat + speaking turns (proofread ∥ reply), sessions, end-of-chat bonus
  essay.js     2-stage grading: per-sentence proofreading → rubric scoring
  reading.js   story + 3-question quiz, quiz rewards, contextual word lookup (lemma + article)
  vocabulary.js Leitner SRS deck, AI word packs, 15k bank browser, add/rate
  coach.js     daily AI study plan (background, cached per day), ask-the-coach
  settings.js / admin.js   model discovery & switching / admin panel API
src/models/   User (XP, streak, lastStudyDate, streakFreezes, bestCombo, quests, history, achievements),
              Conversation, Vocabulary (user deck), VocabBank (15k seeded words)
public/
  dashboard.html  home ("Heute") + full-screen module sheets
  apple.css       Apple design layer (tokens for light/dark, components, game UI) — loaded after style.css
  game.js         client game layer: applyProgress(), island notifications, sounds, level-up sheet, combo, rings, quests, appearance
  app.js          module logic (vocab, chat, speaking, writing, reading, progress, settings)
  style.css       legacy base styles (kept; apple.css overrides via tokens)
```

## Conventions (must follow)
- **ES modules only** (`import`/`export`), Node ≥ 18. No `require()`.
- Every async route is wrapped in `try/catch` and answers errors as `{ error: "explanation" }`.
- **All learner rewards go through `awardActivity(user, activity, opts)`** in `src/utils/game.js`. Never touch `user.xp`, `studyHistory` or `dailyModuleStatus` by hand in a route. Return its snapshot as `progress` (and `xpEarned: progress.xpGained`) so the client can animate it.
- On the client, hand every such response to `applyProgress(data)`. Never do `auth.xp += …`.
- Dates for streaks, quests and history are **local** calendar days: use `localDateStr()`, never `toISOString().split('T')[0]` (that's UTC and flips days at the wrong hour in Europe). Docker gets `TZ` from the launcher.
- LLM calls go through `callOllama` / `callOllamaJSON` with a `TASK.*` preset. Use JSON-schema `format` for anything you parse. Mark non-urgent work `{ background: true }` so it never blocks a learner's request.
- Keep `num_ctx` identical everywhere (`OLLAMA_NUM_CTX`, default 4096). A different value makes Ollama reload the model (adds ~10 s).
- Validate model output before storing it (clamp numbers, check enums, drop hallucinated items). See essay.js and reading.js.
- UI: use the tokens in `apple.css` (`--label`, `--bg-elevated`, `--sys-blue`, …), not hard-coded colors. German UI copy for learner-facing text; English for rules and explanations.

## Validation rules
- `User.currentLevel` / `Conversation.level` / `Vocabulary.level`: `['A1','A2','B1','B2','C1']`
- `Conversation.messages[].sender`: `['user','ai']`
- `Vocabulary.srsStage`: integer 1–5 (Leitner box)

## Learning engines

### Chat & speaking (chat.js)
- Two LLM calls run in parallel:
  - **Proofreader** (`proofread.js`): temperature 0. Returns `corrected` text plus `fixes[{wrong, right, rule}]`. A correction counts only if `corrected` differs from the input, ignoring punctuation and whitespace. Case is compared for typed text, ignored for speech transcripts.
  - **Reply:** German, at most 3 sentences, ending with one follow-up question. Max 3 sentences is also enforced in code by `capSentences`.
- Stored reply format (spec): `[Correction: <rules> → „<corrected sentence>“] <reply>`, with the correction at the very start. The API also returns a structured `correction` object; the client renders a word-level diff.
- Speaking turns send `isSpeaking` plus the question being answered (`speakingPrompt`), are single-turn (not stored as a chat thread) and count toward the speaking quest.
- Measured on mistral-nemo:12b: 16/16 on a mixed set of correct and incorrect A2 sentences; about 3–4 s per message when warm.

### Essay (essay.js) → `/api/essay/grade`
1. Proofread every sentence (concurrency 3) → `grammarErrors` and `correctedText`.
2. Scoring call (JSON schema) informed by the verified errors → `cefrGrade` and `rubric` (task/grammar/vocabulary/coherence, each 0–25). The grammar sub-score is capped by the measured error rate; `score` is the rubric sum.
- Response keeps the spec fields `{ cefrGrade, score, grammarErrors[{error,fix,rule}], vocabularyEnhancements[{overusedWord,betterAlternative}] }` plus `rubric`, `correctedText`, `overall`, `progress`.
- XP = 10 + score/5.

### Reading (reading.js)
- `/generate` returns `{ title, story, questions[3] }`, sized per CEFR level (`LEVEL_INSTRUCTIONS`). Quiz answers are rewarded via `/quiz` (3 XP each, +5 for a perfect score).
- `/translate` takes the clicked word **and its sentence** and returns `lemma`, `article`, `translation` and `deckWord`. Separable verbs resolve ("stand … auf" → `aufstehen`), and noun gender is taken from the 15k bank. The deck stores `deckWord` (e.g. `der Bahnhof`), which is the lexical root.
- Don't use VocabBank glosses for translation: they are machine-generated and noisy (e.g. "geben = will be"). Its article+noun pairs are reliable.

### SRS (vocabulary.js)
- `good`/`easy` = correct → `srsStage = min(stage+1, 5)`, next review = now + stage×3 days.
- `again`/`hard` = wrong → `srsStage = 1`, next review = now + 1 day.
- A word counts toward `totalWordsLearned` the first time it is recalled correctly.
- The client sends the current `combo`; the server adds +1 XP per 5 in a row (max +3).

## Game design (src/utils/game.js)
- **XP per activity** (`ACTIVITIES`):
  - card: correct 2 / wrong 1
  - word added: 3
  - chat message: 3, plus 2 if it's error-free
  - speaking turn: 5
  - chat completed: 10
  - story: 10
  - essay: 10–30
  - quiz: 3 per correct answer
- **Daily quests:** vocab 10 cards · chat 5 · speaking 3 · writing 1 · reading 1. Each completed quest gives +10; all five give +50.
- **Level curve:** XP to reach level L = 50(L−1) + 25(L−1)². Titles run from Sprach-Neuling 🌱 to Sprachlegende 👑. The client mirrors this in `public/game.js` (`levelFromXp`) only for instant UI; the server is authoritative.
- **Streak:** extended by the first rewarded activity of a local day. Logging in never extends it. Every 7-day milestone earns a streak freeze (max 2), which is used up automatically when exactly one day is missed.
- **Achievements:** defined in `checkAndAwardAchievements` (auth.js). Unlocks come back in `progress.achievements` and show as island notifications.

## Ollama protocol
- Endpoint `OLLAMA_ENDPOINT` (default `http://localhost:11434/api/chat`), `stream: false`, `think: false`, `keep_alive: OLLAMA_KEEP_ALIVE` (default 1h).
- Fallback: at most one other installed chat model, never embedding models. Never loop through every model.
- Model list cached for 30 s. Timeout `OLLAMA_TIMEOUT_MS` (120 s). `OLLAMA_DEBUG=1` logs latency per call.
- Memory on a 24 GB Mac: mistral-nemo 12B Q4 ≈ 7.5 GB loaded with 4k context, 100% GPU.

## Known gaps / next steps
- `src/data/vocabBank15k.json` glosses need a cleanup pass. Examples: function words turned into nouns (`das Ich = ego`, `das Aber`) and wrong senses (`geben = will be`).
- Proofreader `rule` labels are sometimes imprecise even when the correction itself is right. The UI therefore leads with the diff.
- "Google/Apple" sign-in buttons are local placeholders, not real OAuth.
- Story generation takes about 15–20 s (non-streaming by spec). Streaming the story text would improve perceived speed.
