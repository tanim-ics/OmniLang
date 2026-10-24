import express from 'express';
import User from '../models/User.js';
import { callOllamaJSON, TASK } from '../utils/ollama.js';
import { proofreadText } from '../utils/proofread.js';
import { awardActivity } from '../utils/game.js';

const router = express.Router();

// Stage-2 scoring schema. The response payload still follows CLAUDE.md §4
// (cefrGrade, score, grammarErrors, vocabularyEnhancements) plus rubric/correctedText/overall.
const ESSAY_SCHEMA = {
    type: 'object',
    properties: {
        cefrGrade: { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1'] },
        rubric: {
            type: 'object',
            properties: {
                task: { type: 'integer' }, grammar: { type: 'integer' },
                vocabulary: { type: 'integer' }, coherence: { type: 'integer' }
            },
            required: ['task', 'grammar', 'vocabulary', 'coherence']
        },
        vocabularyEnhancements: {
            type: 'array',
            items: {
                type: 'object',
                properties: { overusedWord: { type: 'string' }, betterAlternative: { type: 'string' } },
                required: ['overusedWord', 'betterAlternative']
            }
        },
        overall: { type: 'string' }
    },
    required: ['cefrGrade', 'rubric', 'vocabularyEnhancements', 'overall']
};
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || '';

// POST /api/essay/grade
// Accepts essay text + optional prompt goal → returns structured assessment
router.post('/grade', async (req, res) => {
    try {
        const { text, prompt: essayPrompt, userId, level } = req.body;

        if (!text || !userId || !level) {
            return res.status(400).json({ error: 'Missing required fields: text, userId, level' });
        }

        const user = await User.findOne({ userId });
        const targetModel = user?.selectedModel || DEFAULT_MODEL;
        const goal = essayPrompt || 'Write a short paragraph in German on any topic.';

        const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
        if (wordCount < 5) return res.status(400).json({ error: 'Please write at least a few full sentences (5+ words).' });

        // Stage 1 — sentence-level proofreading (the same temperature-0 pass the chat tutor uses).
        const proofed = await proofreadText(targetModel, level, text);
        const grammarErrors = [];
        proofed.forEach(({ correction }) => {
            if (!correction) return;
            const fixes = correction.fixes.length ? correction.fixes
                : [{ wrong: correction.original, right: correction.corrected, rule: '' }];
            fixes.forEach(f => grammarErrors.push({ error: f.wrong, fix: f.right, rule: f.rule || 'Sentence correction' }));
        });
        const correctedText = proofed.map(p => p.correction ? p.correction.corrected : p.sentence).join(' ');
        const sentencesWithErrors = proofed.filter(p => p.correction).length;

        // Stage 2 — holistic scoring, informed by the verified error list.
        const { json } = await callOllamaJSON(targetModel, [
            {
                role: 'system',
                content: `You are a certified Goethe-Institut examiner grading German writing against the CEFR.
The learner is studying at level ${level}. Grade honestly and consistently; do not inflate.

Rubric (each 0-25):
- task: does the text address the prompt with enough content for ${level}?
- grammar: accuracy — use the proofreader's findings below (many errors per sentence = low; none = high)
- vocabulary: range and precision appropriate for ${level}
- coherence: logical flow, connectors, paragraphing
"cefrGrade": the level the text DEMONSTRATES (A1, A2, B1, B2 or C1), which may be below or above ${level}.
"vocabularyEnhancements": up to 4 SINGLE common words (e.g. gut, sehr, machen, schön) the learner ACTUALLY used — never grammar fixes — each with a more precise ${level}-appropriate alternative that fits the same sentence.
"overall": 2-3 encouraging, specific English sentences: one strength, one priority to improve.`
            },
            {
                role: 'user',
                content: `Writing prompt: "${goal}"
Word count: ${wordCount}
Sentences with mistakes: ${sentencesWithErrors} of ${proofed.length}
Proofreader findings:
${grammarErrors.length ? grammarErrors.map(e => `- "${e.error}" -> "${e.fix}" (${e.rule})`).join('\n') : '- none'}

Learner's text:
"""
${text}
"""`
            }
        ], ESSAY_SCHEMA, { options: TASK.grade });

        // ---- Validate the model's output ----
        const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
        const clamp = (n, max) => Math.min(max, Math.max(0, Math.round(Number(n) || 0)));
        const rubric = {
            task:       clamp(json.rubric?.task, 25),
            grammar:    clamp(json.rubric?.grammar, 25),
            vocabulary: clamp(json.rubric?.vocabulary, 25),
            coherence:  clamp(json.rubric?.coherence, 25)
        };
        // Keep the grammar sub-score consistent with the measured error rate.
        const errorRate = proofed.length ? sentencesWithErrors / proofed.length : 0;
        rubric.grammar = Math.min(rubric.grammar, Math.round(25 * (1 - errorRate * 0.8)));
        const score = rubric.task + rubric.grammar + rubric.vocabulary + rubric.coherence;
        const cefrGrade = LEVELS.includes(String(json.cefrGrade).toUpperCase()) ? String(json.cefrGrade).toUpperCase() : level;
        const overall = String(json.overall || '').trim() || 'Well written! Keep practicing regularly to refine your grammar.';

        const haystack = text.toLowerCase();
        const vocabularyEnhancements = (Array.isArray(json.vocabularyEnhancements) ? json.vocabularyEnhancements : [])
            .map(v => ({ overusedWord: String(v.overusedWord || '').trim(), betterAlternative: String(v.betterAlternative || '').trim() }))
            // Single plain words only, and never a repeat of a grammar fix.
            .filter(v => v.overusedWord && v.betterAlternative && !/\s/.test(v.overusedWord)
                && v.overusedWord.toLowerCase() !== v.betterAlternative.toLowerCase()
                && !grammarErrors.some(e => e.error.toLowerCase().includes(v.overusedWord.toLowerCase()))
                && new RegExp(`(^|[^\\p{L}])${v.overusedWord.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(haystack))
            .slice(0, 4);

        // XP scales with quality: 10 base + up to 20 for the score
        const essayXp = 10 + Math.floor(score / 5);

        let targetUser = await User.findOne({ userId });
        if (!targetUser) {
            targetUser = new User({ userId, currentLevel: level, username: 'Learner' });
        }

        targetUser.essaysGraded = (targetUser.essaysGraded || 0) + 1;
        const currentAvg = targetUser.averageEssayScore || score;
        targetUser.averageEssayScore = Math.round((currentAvg * (targetUser.essaysGraded - 1) + score) / targetUser.essaysGraded);

        // Record mistakes for AI Coach
        if (!targetUser.recentMistakes) targetUser.recentMistakes = [];
        grammarErrors.forEach(ge => {
            targetUser.recentMistakes.push({ error: ge.error, fix: ge.fix, rule: ge.rule, source: 'essay', timestamp: new Date() });
        });
        if (targetUser.recentMistakes.length > 25) {
            targetUser.recentMistakes = targetUser.recentMistakes.slice(-25);
        }

        // Update level progress
        if (!targetUser.progressByLevel) targetUser.progressByLevel = {};
        if (!targetUser.progressByLevel[level]) {
            targetUser.progressByLevel[level] = { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 };
        }
        targetUser.progressByLevel[level].writingScore = score;
        targetUser.progressByLevel[level].sessionsCount = (targetUser.progressByLevel[level].sessionsCount || 0) + 1;

        targetUser.markModified('progressByLevel');
        const progress = await awardActivity(targetUser, 'essay_graded', { xp: essayXp });
        await targetUser.save();

        res.json({ cefrGrade, score, rubric, grammarErrors, vocabularyEnhancements, correctedText, overall, xpEarned: progress.xpGained, progress });

    } catch (err) {
        console.error('[essay] Error:', err.message);
        res.status(500).json({ error: 'Essay grading failed: ' + err.message });
    }
});

export default router;
