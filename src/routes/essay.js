import express from 'express';
import User from '../models/User.js';
import { checkAndAwardAchievements, getOrCreateDailyStatus } from './auth.js';
import { callOllama } from '../utils/ollama.js';

const router = express.Router();
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

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

        const systemPrompt = `You are an expert German language examiner assessing a CEFR ${level} student.

Essay prompt given to student: "${goal}"

Student's German text:
"""
${text}
"""

Assess the essay and respond ONLY in this exact format (use the exact headers):

CEFR_GRADE: <A1|A2|B1|B2|C1>
SCORE: <0-100>
GRAMMAR_ERRORS:
- error: "<wrong phrase>" | fix: "<corrected form>" | rule: "<grammar rule>"
- error: "<wrong phrase>" | fix: "<corrected form>" | rule: "<grammar rule>"
VOCABULARY_ENHANCEMENTS:
- overused: "<basic word>" | better: "<more advanced alternative>"
- overused: "<basic word>" | better: "<more advanced alternative>"
OVERALL_FEEDBACK: <2-3 sentences of constructive, encouraging English feedback>

If there are no grammar errors, write "none" on the line after GRAMMAR_ERRORS:
If there are no vocabulary improvements, write "none" on the line after VOCABULARY_ENHANCEMENTS:
Return ONLY the assessment in the format above. No extra text.`;

        const result = await callOllama(targetModel, [{ role: 'user', content: systemPrompt }]);
        const raw    = result.content || '';
        if (!raw)    throw new Error('Empty response from Ollama');

        // ---- Parse structured response ----
        const cefrGrade = (raw.match(/CEFR_GRADE:\s*([A-C][12]?)/i) || [])[1]?.toUpperCase() || level;
        const scoreStr  = (raw.match(/SCORE:\s*(\d+)/i) || [])[1];
        const score     = scoreStr ? Math.min(100, Math.max(0, parseInt(scoreStr))) : 75;

        const overall = (raw.match(/OVERALL_FEEDBACK:\s*([\s\S]*?)(?=\n[A-Z_]+:|$)/i) || [])[1]?.trim() || 'Well written! Keep practicing regularly to refine your grammar.';

        // Parse grammar errors
        const grammarBlock = (raw.match(/GRAMMAR_ERRORS:\s*([\s\S]*?)(?=\nVOCABULARY_ENHANCEMENTS:|$)/i) || [])[1] || '';
        const grammarErrors = grammarBlock
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.startsWith('-') && l.includes('error:'))
            .map(l => ({
                error: (l.match(/error:\s*"([^"]+)"/)  || [])[1] || '',
                fix:   (l.match(/fix:\s*"([^"]+)"/)    || [])[1] || '',
                rule:  (l.match(/rule:\s*"([^"]+)"/)   || [])[1] || ''
            }))
            .filter(e => e.error && e.error.toLowerCase() !== 'none');

        // Parse vocabulary enhancements
        const vocabBlock = (raw.match(/VOCABULARY_ENHANCEMENTS:\s*([\s\S]*?)(?=\nOVERALL_FEEDBACK:|$)/i) || [])[1] || '';
        const vocabularyEnhancements = vocabBlock
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.startsWith('-') && l.includes('overused:'))
            .map(l => ({
                overusedWord:      (l.match(/overused:\s*"([^"]+)"/) || [])[1] || '',
                betterAlternative: (l.match(/better:\s*"([^"]+)"/)   || [])[1] || ''
            }))
            .filter(e => e.overusedWord && e.overusedWord.toLowerCase() !== 'none');

        // Award XP proportional to score
        const xpEarned = Math.max(10, Math.floor(score / 5));
        const todayStr = new Date().toISOString().split('T')[0];

        let targetUser = await User.findOne({ userId });
        if (!targetUser) {
            targetUser = new User({ userId, currentLevel: level, username: 'Learner' });
        }

        targetUser.xp = (targetUser.xp || 0) + xpEarned;
        targetUser.essaysGraded = (targetUser.essaysGraded || 0) + 1;
        
        // Update average essay score
        const currentAvg = targetUser.averageEssayScore || score;
        targetUser.averageEssayScore = Math.round((currentAvg * (targetUser.essaysGraded - 1) + score) / targetUser.essaysGraded);

        // Record mistakes for AI Coach
        if (!targetUser.recentMistakes) targetUser.recentMistakes = [];
        grammarErrors.forEach(ge => {
            targetUser.recentMistakes.push({
                error: ge.error,
                fix: ge.fix,
                rule: ge.rule,
                source: 'essay',
                timestamp: new Date()
            });
        });
        if (targetUser.recentMistakes.length > 25) {
            targetUser.recentMistakes = targetUser.recentMistakes.slice(-25);
        }

        // Update daily module status
        const dailyStatus = getOrCreateDailyStatus(targetUser, todayStr);
        dailyStatus.writingCount = (dailyStatus.writingCount || 0) + 1;
        dailyStatus.writingCompleted = true;

        // Update daily study history
        if (!targetUser.studyHistory) targetUser.studyHistory = [];
        let historyEntry = targetUser.studyHistory.find(h => h.date === todayStr);
        if (historyEntry) {
            historyEntry.xp = (historyEntry.xp || 0) + xpEarned;
            historyEntry.essaysGraded = (historyEntry.essaysGraded || 0) + 1;
            historyEntry.minutesSpent = (historyEntry.minutesSpent || 0) + 5;
        } else {
            targetUser.studyHistory.push({
                date: todayStr,
                xp: xpEarned,
                wordsLearned: 0,
                messagesSent: 0,
                essaysGraded: 1,
                minutesSpent: 5
            });
        }

        // Update level progress
        if (!targetUser.progressByLevel) targetUser.progressByLevel = {};
        if (!targetUser.progressByLevel[level]) {
            targetUser.progressByLevel[level] = { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 };
        }
        targetUser.progressByLevel[level].writingScore = score;
        targetUser.progressByLevel[level].sessionsCount = (targetUser.progressByLevel[level].sessionsCount || 0) + 1;

        targetUser.lastActiveAt = new Date();
        targetUser.markModified('dailyModuleStatus');
        targetUser.markModified('studyHistory');
        await checkAndAwardAchievements(targetUser);
        await targetUser.save();

        res.json({ cefrGrade, score, grammarErrors, vocabularyEnhancements, overall, xpEarned });

    } catch (err) {
        console.error('[essay] Error:', err.message);
        res.status(500).json({ error: 'Essay grading failed: ' + err.message });
    }
});

export default router;
