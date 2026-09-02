# CLAUDE.md - German Learning Platform (Langey Clone - Complete Edition)

## Project Context
A local-first, premium, CEFR-aligned (A1-B2) German learning application featuring conversational AI immersion, automated writing evaluation, graded reading engines, and vocabulary spaced-repetition loops driven entirely by local Ollama microservices.

## Expanded System Architecture Map
- `/public/index.html`              -> Landing page
- `/public/dashboard.html`          -> Main UI learning command center
- `/src/server.js`                  -> Main Express API gateway configuration (port 5001)
- `/src/models/User.js`            -> User profiles, CEFR metrics, streaks, SRS, learning history & achievements
- `/src/models/Conversation.js`    -> Chronological immersive chat memory threads
- `/src/models/Vocabulary.js`      -> Spaced Repetition (SRS) flashcard index collections
- `/src/routes/auth.js`            -> User profile, authentication, settings and progress sync
- `/src/routes/coach.js`           -> AI Learning Coach & personalized study recommendations
- `/src/routes/settings.js`        -> Ollama model auto-discovery & system configuration
- `/src/routes/chat.js`             -> Immersive speech/text conversational controller endpoints
- `/src/routes/vocabulary.js`       -> Leitner-system spaced repetition database operations
- `/src/routes/reading.js`          -> Dynamic CEFR level text generator endpoint
- `/src/routes/essay.js`            -> Advanced text evaluation, grading, and rubric analytics

## Critical Developer Commands
- **Automated 1-Step Setup:** `./setup.sh` (or `npm run setup`)
- **System Doctor & Diagnostics:** `npm run doctor` (or `./setup.sh --doctor`)
- **Boot Local Stack (Dev):** `npm run dev`
- **Boot Local Stack (Prod):** `npm start`
- **Docker Compose Stack:** `npm run docker:up` / `npm run docker:down`
- **Verify Local Engine:** `curl http://localhost:11434/api/tags`
- **Database Status Check:** `mongosh --eval "db.adminCommand('ping')"`
- **Health Check:** `curl http://localhost:5001/api/health`

## Technology Constraints & Strict Conventions
- **Module Format:** ES Modules strictly (`import/export`). No CommonJS `require()`.
- **Error Boundaries:** All asynchronous controllers must be wrapped in `try/catch` layers routing errors to a standardized json container response: `{ error: "Structured explanation" }`.
- **Database Validation Rules:**
  - `User.currentLevel`: Enforce strict enum validations: `['A1', 'A2', 'B1', 'B2']`.
  - `Conversation.messages`: Objects must track `sender` directly matching `['user', 'ai']`.
  - `Vocabulary.srsStage`: Tracks Leitner progression index layers integer scale `1` through `5`.

## Local Ollama Integration Protocol
- **Endpoint Target:** Forward prompt strings to `http://localhost:11434/api/chat`.
- **Streaming Toggle:** Maintain `"stream": false` parameter structures to simplify data state alignment during heavy multi-collection database queries.
- **Model Standard:** Standard model is `mistral-nemo:12b` local binary.

## Specialized Engine Feature Specifications

### 1. Immersive Conversational Mode & Audio Processing
- **AI Response Prompting:** Cap chat responses to a max of 3 sentences. If grammatical errors occur, append a clear feedback string enclosed in square brackets: `[Correction: ...]` at the absolute beginning of the return text payload.
- **Voice Immersion:** Utilize the Web Speech API (`SpeechSynthesisUtterance`) to voice-render incoming AI responses locally. Utilize `webkitSpeechRecognition` to process microphoned user input into text values dynamically.

### 2. Graded Reading & Vocabulary Context Mining
- **Story Generation:** The reading route must pass dynamic prompts requesting short paragraphs focused entirely on specific CEFR constraints (e.g., *A1: simple structures, present tense, focus on public transport vocabulary*).
- **Interactive Parsing:** Client UI text displays stories wrapped as clickable word spans (`<span>word</span>`). Clicking elements calls `/api/vocabulary/add`, assigning the lexical root string directly into the user's Leitner SRS dictionary database.

### 3. Spaced Repetition System (SRS) Mechanics
- **Review Math Engine:** Track intervals using simplified interval steps based on last performance rating:
  - Wrong answer: Reset `srsStage` to `1`, calculate `nextReviewDate = current_time + 1_day`.
  - Correct answer: Increment `srsStage` by 1. Set `nextReviewDate = current_time + (srsStage * 3) days`.

### 4. Advanced Essay Assessment Rubric
- **Writing Prompts:** Route `/api/essay/grade` processes user paragraph text inputs matching structured challenges.
- **Evaluation Payload Structure:** Prompt the LLM to output a JSON string tracking performance analytics using this explicit formatting schema:
```json
  {
    "cefrGrade": "A2",
    "score": 82,
    "grammarErrors": [{"error": "...", "fix": "...", "rule": "..."}],
    "vocabularyEnhancements": [{"overusedWord": "...", "betterAlternative": "..."}]
  }