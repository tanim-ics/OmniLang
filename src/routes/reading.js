import express from 'express';
import User from '../models/User.js';
import VocabBank from '../models/VocabBank.js';
import { callOllamaJSON, TASK } from '../utils/ollama.js';
import { awardActivity } from '../utils/game.js';

const router = express.Router();
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || '';

const LEVEL_INSTRUCTIONS = {
    A1: 'Use ONLY Präsens. 60-90 words. Very short main clauses (subject + verb + object). Everyday words: family, food, home, shopping, public transport. No subordinate clauses.',
    A2: 'Use Präsens and Perfekt. 90-130 words. Short connected sentences with und, aber, weil, dann. Topics: travel, hobbies, weather, work routines.',
    B1: 'Use Präsens, Perfekt, Präteritum and Futur. 130-180 words. Some subordinate clauses (dass, obwohl, wenn). Include opinions and reasons.',
    B2: 'Use all tenses including Konjunktiv II and Passiv. 180-230 words. Relative clauses and varied connectors. Abstract or societal topics.',
    C1: 'Sophisticated literary German with idioms, nominal style and participial constructions. 220-280 words. Nuanced, abstract topic.'
};

const STORY_SCHEMA = {
    type: 'object',
    properties: {
        title: { type: 'string' },
        story: { type: 'string' },
        questions: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    question: { type: 'string' },
                    options:  { type: 'array', items: { type: 'string' } },
                    answer:   { type: 'integer' }
                },
                required: ['question', 'options', 'answer']
            }
        }
    },
    required: ['title', 'story', 'questions']
};

const WORD_SCHEMA = {
    type: 'object',
    properties: {
        lemma:       { type: 'string' },
        article:     { type: 'string' },
        translation: { type: 'string' },
        type:        { type: 'string', enum: ['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'phrase', 'other'] },
        example:     { type: 'string' }
    },
    required: ['lemma', 'article', 'translation', 'type', 'example']
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

        const { json } = await callOllamaJSON(targetModel, [
            {
                role: 'system',
                content: `You write graded readers for German learners at CEFR ${level}.
Level rules: ${instructions}
Write natural, grammatically perfect German with a small story arc and named characters. 2-3 paragraphs separated by a blank line.
Then write exactly 3 multiple-choice comprehension questions IN GERMAN at the same level, each with 3 short options; "answer" is the 0-based index of the correct option. Exactly ONE option is true according to the story; the other two must be clearly FALSE according to the story (not merely unmentioned, and not also true). Vary the position of the correct answer.`
            },
            { role: 'user', content: `Thema: "${storyTopic}"` }
        ], STORY_SCHEMA, { options: TASK.story });

        const story = String(json.story || '').trim();
        if (!story) throw new Error('Empty story from Ollama');
        const questions = (Array.isArray(json.questions) ? json.questions : [])
            .filter(q => q.question && Array.isArray(q.options) && q.options.length >= 2
                && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length)
            .slice(0, 3)
            .map(q => ({ question: String(q.question), options: q.options.slice(0, 4).map(String), answer: q.answer }));

        let progress = null;
        if (user) {
            user.storiesRead = (user.storiesRead || 0) + 1;
            progress = await awardActivity(user, 'story_read');
            await user.save();
        }

        res.json({
            title: String(json.title || '').trim(),
            story,
            questions,
            level,
            topic: storyTopic,
            xpEarned: progress?.xpGained || 0,
            progress
        });

    } catch (err) {
        console.error('[reading] Error:', err.message);
        res.status(500).json({ error: 'Story generation failed: ' + err.message });
    }
});

// POST /api/reading/quiz — reward comprehension answers (client checks, server caps the reward)
router.post('/quiz', async (req, res) => {
    try {
        const { userId, correct = 0, total = 0 } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });
        const right = Math.max(0, Math.min(3, Number(correct) || 0));
        const user = await User.findOne({ userId });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const bonus = right === 3 && Number(total) === 3 ? [{ label: 'Perfektes Quiz', xp: 5 }] : [];
        const progress = await awardActivity(user, 'story_quiz', { xp: right * 3, bonus });
        await user.save();
        res.json({ success: true, xpEarned: progress.xpGained, progress });
    } catch (err) {
        console.error('[reading] Quiz error:', err.message);
        res.status(500).json({ error: 'Could not save quiz result: ' + err.message });
    }
});

// ---- Word lookup ----
// Always contextual LLM translation: the 15k bank's auto-generated glosses are too noisy
// (e.g. "geben = will be") to serve as an in-context dictionary.
const translationCache = new Map();

// Small models leak neighbouring words into the lemma ("früh aufstehen"): keep the one real headword.
function cleanLemma(lemma, type, word) {
    const parts = String(lemma || word).replace(/^(der|die|das)\s+/i, '').trim().split(/\s+/);
    if (parts.length === 1 || type === 'phrase') return parts.join(' ');
    if (type === 'noun') return parts.find(p => /^\p{Lu}/u.test(p)) || parts[parts.length - 1];
    return parts[parts.length - 1];
}

// Gender from the 15k bank: its article+noun pairs are reliable even where glosses are not.
async function bankArticle(lemma) {
    const re = new RegExp(`^(der|die|das) ${lemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    const hit = await VocabBank.findOne({ word: re }).select('word').lean();
    return hit ? hit.word.split(' ')[0] : '';
}

// POST /api/reading/translate — translate a clicked German word in its sentence (cached)
router.post('/translate', async (req, res) => {
    try {
        const { word, context, userId } = req.body;
        if (!word) return res.status(400).json({ error: 'Missing word' });

        const key = `${word.toLowerCase()}|${(context || '').slice(0, 120)}`;
        if (translationCache.has(key)) return res.json(translationCache.get(key));

        let entry;
        {
            const user = userId ? await User.findOne({ userId }) : null;
            const targetModel = user?.selectedModel || DEFAULT_MODEL;
            const { json } = await callOllamaJSON(targetModel, [
                {
                    role: 'system',
                    content: `You are a precise German-English dictionary. Given an inflected German word and the sentence it appears in, return its dictionary entry.
- "lemma": ONE word, the dictionary form — infinitive for verbs, nominative singular for nouns, base form for adjectives.
  SEPARABLE VERBS: if the sentence contains the verb's detached prefix later in the clause, the lemma includes it.
  Examples: "stand" in "Er stand früh auf" -> "aufstehen"; "rufe" in "Ich rufe dich an" -> "anrufen"; "kauft" in "Sie kauft Brot ein" -> "einkaufen".
- "article": REQUIRED for every noun: "der", "die" or "das" (e.g. Bahnhof -> "der", Zeit -> "die", Haus -> "das"). "" for non-nouns.
- "translation": English meaning of THIS WORD ONLY (never include neighbouring words), as used in this sentence, 1-3 words. Verbs as "to …", nouns without "the".
- "example": one short, simple German sentence using the lemma.`
                },
                { role: 'user', content: `Word: "${word}"\nSentence: "${context || word}"` }
            ], WORD_SCHEMA, { options: TASK.translate });
            const type = json.type || 'other';
            const lemma = cleanLemma(json.lemma, type, word);
            let article = ['der', 'die', 'das'].includes(String(json.article).toLowerCase()) ? String(json.article).toLowerCase() : '';
            if (type === 'noun') article = (await bankArticle(lemma)) || article;
            entry = {
                lemma,
                article: type === 'noun' ? article : '',
                translation: String(json.translation || '').trim().replace(/^the\s+/i, '') || word,
                type,
                example: String(json.example || '').trim(),
                source: 'ai'
            };
        }

        const payload = {
            word,
            ...entry,
            // Deck entry: nouns keep their article so gender is learned with the word
            deckWord: entry.article ? `${entry.article} ${entry.lemma}` : entry.lemma
        };
        translationCache.set(key, payload);
        if (translationCache.size > 2000) translationCache.delete(translationCache.keys().next().value);
        res.json(payload);

    } catch (err) {
        console.error('[reading] Translate error:', err.message);
        res.status(500).json({ error: 'Translation failed: ' + err.message });
    }
});

export default router;
