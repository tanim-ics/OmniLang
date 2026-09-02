import express from 'express';
import User from '../models/User.js';
import { checkAndAwardAchievements, getOrCreateDailyStatus } from './auth.js';
import { callOllama } from '../utils/ollama.js';

const router = express.Router();
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || '';

const LEVEL_INSTRUCTIONS = {
    A1: 'Use ONLY simple present tense. Max 80 words. Very simple subject + verb + object sentences. Topics: family, colors, food, greetings, daily routine. No complex grammar.',
    A2: 'Use present and simple past tense (Perfekt). Max 120 words. Simple connected sentences with "und", "aber", "weil". Topics: travel, hobbies, weather, shopping.',
    B1: 'Use present, past, and future tense. Max 160 words. Include some subordinate clauses. Express opinions and reasons. Topics: work, environment, culture.',
    B2: 'Use all tenses including Konjunktiv II. Max 200 words. Complex structures with relative clauses. Abstract topics: current events, argumentation, analysis.',
    C1: 'Use sophisticated academic and literary German. Rich vocabulary, idiomatic expressions, nominal style, participial constructions, and subtle rhetorical nuance. Max 260 words. Complex abstract or philosophical topics.'
};

// POST /api/reading/generate
router.post('/generate', async (req, res) => {
    try {
        const { userId, level, topic } = req.body;
        if (!userId || !level) {
            return res.status(400).json({ error: 'Missing required fields: userId, level' });
        }

        const user = await User.findOne({ userId });
        const targetModel = user?.selectedModel || DEFAULT_MODEL;

        const instructions = LEVEL_INSTRUCTIONS[level] || LEVEL_INSTRUCTIONS.A2;
        const storyTopic   = topic || 'ein interessanter Tag in Deutschland';

        const prompt = `Schreibe eine kurze Geschichte auf Deutsch über: "${storyTopic}".

Anweisungen: ${instructions}

Regeln:
- Schreibe NUR den Geschichtstext auf Deutsch
- Kein Titel, keine Einleitung, nur die Geschichte
- Natürliche, fließende Absätze
- Maximal 2-3 Absätze`;

        const result = await callOllama(targetModel, [{ role: 'user', content: prompt }]);
        const story = result.content?.trim() || '';
        if (!story)  throw new Error('Empty story from Ollama');

        // Award XP & track reading
        const todayStr = new Date().toISOString().split('T')[0];
        let targetUser = await User.findOne({ userId });
        if (targetUser) {
            targetUser.xp = (targetUser.xp || 0) + 10;
            targetUser.storiesRead = (targetUser.storiesRead || 0) + 1;
            targetUser.lastActiveAt = new Date();

            // Update daily module status
            const dailyStatus = getOrCreateDailyStatus(targetUser, todayStr);
            dailyStatus.readingCount = (dailyStatus.readingCount || 0) + 1;
            dailyStatus.readingCompleted = true;

            if (!targetUser.studyHistory) targetUser.studyHistory = [];
            let hist = targetUser.studyHistory.find(h => h.date === todayStr);
            if (hist) {
                hist.xp = (hist.xp || 0) + 10;
                hist.minutesSpent = (hist.minutesSpent || 0) + 3;
            } else {
                targetUser.studyHistory.push({
                    date: todayStr,
                    xp: 10,
                    wordsLearned: 0,
                    messagesSent: 0,
                    essaysGraded: 0,
                    minutesSpent: 3
                });
            }
            targetUser.markModified('dailyModuleStatus');
            targetUser.markModified('studyHistory');
            await checkAndAwardAchievements(targetUser);
            await targetUser.save();
        }

        res.json({ story, level, topic: storyTopic, xpEarned: 10 });

    } catch (err) {
        console.error('[reading] Error:', err.message);
        res.status(500).json({ error: 'Story generation failed: ' + err.message });
    }
});

// POST /api/reading/translate — translate a clicked German word
router.post('/translate', async (req, res) => {
    try {
        const { word, context, userId } = req.body;
        if (!word) return res.status(400).json({ error: 'Missing word' });

        const user = userId ? await User.findOne({ userId }) : null;
        const targetModel = user?.selectedModel || DEFAULT_MODEL;

        const prompt = `Translate the German word "${word}" to English.
${context ? `Context sentence: "${context}"` : ''}

Reply in this EXACT format (no other text):
Translation: <English meaning>
Type: <verb / noun / adjective / adverb / other>
Example: <short German example sentence using the word>`;

        const result = await callOllama(targetModel, [{ role: 'user', content: prompt }]);
        const raw = result.content?.trim() || '';
        const translation = (raw.match(/Translation:\s*(.+)/i) || [])[1]?.trim() || word;
        const type        = (raw.match(/Type:\s*(.+)/i)        || [])[1]?.trim() || 'word';
        const example     = (raw.match(/Example:\s*(.+)/i)     || [])[1]?.trim() || '';

        res.json({ word, translation, type, example });

    } catch (err) {
        console.error('[reading] Translate error:', err.message);
        res.status(500).json({ error: 'Translation failed: ' + err.message });
    }
});

export default router;
