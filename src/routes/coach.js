import express from 'express';
import User from '../models/User.js';
import Vocabulary from '../models/Vocabulary.js';
import { callOllama } from '../utils/ollama.js';

const router = express.Router();
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || '';

// Curated default daily recommendations
const FALLBACK_RECOMMENDATIONS = {
    A1: {
        focusTopic: 'Essential Daily Verbs & Word Order (SVO)',
        reasoning: 'At A1, mastering regular verb conjugations (kommen, wohnen, heißen) and the Verb-in-2nd-position rule builds the strongest foundation for speaking.',
        missions: [
            { id: 1, title: 'Review 5 Flashcards', module: 'vocab', actionText: 'Practice Vocab', xp: 10, hint: 'Focus on memorizing noun genders (der, die, das).' },
            { id: 2, title: 'Introduce Yourself in Chat', module: 'chat', starter: 'Hallo Lukas! Ich heiße [Name] und ich lerne Deutsch.', actionText: 'Chat with Lukas', xp: 15, hint: 'Tell Lukas where you live and what you like.' },
            { id: 3, title: 'Write 3 Sentences About Your Day', module: 'writing', prompt: 'Beschreibe deinen Tag: Was machst du morgens, mittags und abends?', actionText: 'Write Mini-Essay', xp: 20, hint: 'Keep sentences simple with subject + verb.' }
        ],
        proverb: { german: 'Übung macht den Meister.', english: 'Practice makes perfect.', literal: 'Practice makes the master.' },
        coachTip: 'Always learn German nouns with their definite article (der/die/das) and color-code them!'
    },
    A2: {
        focusTopic: 'Perfekt Tense (haben vs. sein) & Connectors (weil, aber)',
        reasoning: 'Moving from A1 to A2 requires speaking about past events comfortably using Perfekt and connecting ideas with "weil" (verb moves to the end!).',
        missions: [
            { id: 1, title: 'Clear Due Vocabulary Deck', module: 'vocab', actionText: 'Review Deck', xp: 10, hint: 'Strengthen verbs in Stage 1 & 2 Leitner boxes.' },
            { id: 2, title: 'Chat About Your Last Weekend', module: 'chat', starter: 'Hallo Lukas! Letztes Wochenende habe ich viel gemacht...', actionText: 'Discuss Weekend', xp: 15, hint: 'Practice using "Ich habe... gemacht" and "Ich bin... gefahren".' },
            { id: 3, title: 'Write a Short Paragraph with "weil"', module: 'writing', prompt: 'Warum lernst du Deutsch? Schreibe 3-4 Sätze mit "weil".', actionText: 'Write with "weil"', xp: 20, hint: 'Remember that the conjugated verb kicks to the end of the clause!' }
        ],
        proverb: { german: 'Aller Anfang ist schwer.', english: 'All beginnings are hard.', literal: 'Every beginning is heavy.' },
        coachTip: 'Verbs of movement and state change (gehen, fahren, aufstehen) use "sein" in Perfekt tense!'
    },
    B1: {
        focusTopic: 'Subordinate Clauses (Nebensätze) & Modal Verbs in Präteritum',
        reasoning: 'At B1, fluency depends on expressing nuanced opinions with "obwohl", "dass", "wenn", and using "wollte, konnte, musste" effortlessly.',
        missions: [
            { id: 1, title: 'Graded Reading Story Mining', module: 'reading', actionText: 'Read & Mine Words', xp: 15, hint: 'Read a B1 story and add 2 new unfamiliar words to your SRS.' },
            { id: 2, title: 'Debate a Topic with Lukas', module: 'chat', starter: 'Ich finde, dass Homeoffice viele Vorteile hat, weil...', actionText: 'Debate with Lukas', xp: 20, hint: 'Use expressions like "Meiner Meinung nach..." and "Einerseits... andererseits".' },
            { id: 3, title: 'Write an Opinion Essay', module: 'writing', prompt: 'Vor- und Nachteile von Social Media. Was denkst du darüber?', actionText: 'Grade Essay', xp: 25, hint: 'Structure into introduction, arguments, and personal conclusion.' }
        ],
        proverb: { german: 'Wer rastet, der rostet.', english: 'Use it or lose it.', literal: 'He who rests grows rusty.' },
        coachTip: 'Notice the difference between "wenn" (if/whenever) and "als" (one-time past event) in complex sentences.'
    },
    B2: {
        focusTopic: 'Konjunktiv II & Advanced Connectors (sowohl... als auch, je... desto)',
        reasoning: 'B2 proficiency requires hypothetical reasoning (hätte, wäre, würde), formal register, and varied sentence structures.',
        missions: [
            { id: 1, title: 'High-Level Vocabulary Drill', module: 'vocab', actionText: 'Master B2 Words', xp: 15, hint: 'Focus on abstract nouns with suffixes -heit, -keit, -ung.' },
            { id: 2, title: 'Discuss Hypothetical Scenarios', module: 'chat', starter: 'Wenn ich Bundeskanzler wäre, würde ich...', actionText: 'Speak in Konjunktiv II', xp: 20, hint: 'Formulate wishes, polite requests, and hypothetical conditions.' },
            { id: 3, title: 'Advanced Argumentative Essay', module: 'writing', prompt: 'Die Zukunft der künstlichen Intelligenz in der Bildung. Beurteile Chancen und Risiken.', actionText: 'Grade B2 Essay', xp: 30, hint: 'Incorporate passive voice and relative clauses for academic style.' }
        ],
        proverb: { german: 'Ohne Fleiß kein Preis.', english: 'No pain, no gain.', literal: 'Without diligence no prize.' },
        coachTip: 'Pay close attention to prepositions with Genitive (trotz, wegen, während) to sound truly native.'
    },
    C1: {
        focusTopic: 'Nominalstil, Partizipialkonstruktionen & Nuanced Rhetoric',
        reasoning: 'At C1 level, mastery involves transforming verbal phrases into sophisticated nominal expressions, understanding stylistic nuances, and using academic idioms effortlessly.',
        missions: [
            { id: 1, title: 'Academic Vocabulary Mastery', module: 'vocab', actionText: 'Master C1 Terms', xp: 20, hint: 'Master formal scientific & professional collocations (z.B. in Erwägung ziehen, zur Folge haben).' },
            { id: 2, title: 'Intellectual Discourse with Lukas', module: 'chat', starter: 'Angesichts der aktuellen geopolitischen und ökologischen Entwicklungen sollte man hinterfragen, ob...', actionText: 'Debate at C1 Level', xp: 25, hint: 'Use complex rhetorical connectors like "infolgedessen", "ungeachtet dessen", "gleichermaßen".' },
            { id: 3, title: 'C1 Analytic & Policy Essay', module: 'writing', prompt: 'Verfasse eine differenzierte Stellungnahme zum Spannungsfeld zwischen technologischem Fortschritt und Datenschutz.', actionText: 'Grade C1 Essay', xp: 35, hint: 'Employ advanced nominal style, passive substitutes (lässt sich machen, ist zu beachten), and modal particles.' }
        ],
        proverb: { german: 'Es ist noch kein Meister vom Himmel gefallen.', english: 'No one is born a master.', literal: 'No master has yet fallen from heaven.' },
        coachTip: 'At C1, nuance is everything. Notice how modal particles (ja, doch, eben, halt) subtly convey speaker attitude.'
    }
};

// GET /api/coach/recommendations
router.get('/recommendations', async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        let user = await User.findOne({ userId });
        if (!user) {
            user = await User.create({ userId, username: 'Learner', currentLevel: 'A2' });
        }

        const level = user.currentLevel || 'A2';
        const fallback = FALLBACK_RECOMMENDATIONS[level] || FALLBACK_RECOMMENDATIONS.A2;
        const targetModel = user.selectedModel || DEFAULT_MODEL;

        const recentErrors = (user.recentMistakes || []).slice(-5).map(m => m.error + (m.fix ? ` -> ${m.fix}` : '')).join('; ');
        const totalWords = user.totalWordsLearned || 0;
        const streak = user.streak || 0;
        const userAddedCount = await Vocabulary.countDocuments({ userId });

        const coachPrompt = `You are an elite German Language Learning Coach assessing a CEFR ${level} student.
Student Data:
- Current Level: ${level}
- Words Learned: ${totalWords}
- User Added Vocab: ${userAddedCount}
- Study Streak: ${streak} days
- Recent Mistakes logged: ${recentErrors || 'None recorded yet'}

Analyze this learner profile and create a targeted, high-impact study recommendation for today.
Respond ONLY with a valid JSON object in this EXACT structure:
{
  "focusTopic": "<Specific grammar/vocabulary focus area for ${level}, e.g. Dativ Prepositions>",
  "reasoning": "<1-2 sentences in English explaining why this specific topic is crucial for the learner right now>",
  "missions": [
    {
      "id": 1,
      "title": "<Short title for mission 1>",
      "module": "vocab",
      "actionText": "Practice Vocab",
      "xp": 10,
      "hint": "<Actionable tip for this mission>"
    },
    {
      "id": 2,
      "title": "<Short title for mission 2>",
      "module": "chat",
      "starter": "<German conversational sentence starter for Lukas>",
      "actionText": "Chat with Lukas",
      "xp": 15,
      "hint": "<Actionable tip for this mission>"
    },
    {
      "id": 3,
      "title": "<Short title for mission 3>",
      "module": "writing",
      "prompt": "<German writing prompt for the student to write an essay on>",
      "actionText": "Write Essay",
      "xp": 20,
      "hint": "<Actionable tip for this mission>"
    }
  ],
  "proverb": {
    "german": "<Famous German proverb or idiom>",
    "english": "<English translation/meaning>",
    "literal": "<Literal word-for-word translation>"
  },
  "coachTip": "<1 encouraging pedagogical tip in English for German learners at ${level}>"
}`;

        try {
            const result = await callOllama(targetModel, [{ role: 'user', content: coachPrompt }], { format: 'json' });
            let parsed = null;
            const cleanContent = (result.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            try {
                parsed = JSON.parse(cleanContent || '{}');
            } catch (e) {
                const match = cleanContent.match(/\{[\s\S]*\}/);
                if (match) parsed = JSON.parse(match[0]);
            }

            if (parsed && parsed.focusTopic && parsed.missions) {
                return res.json({
                    success: true,
                    source: 'ai',
                    modelUsed: result.modelUsed,
                    level,
                    recommendations: parsed
                });
            }
        } catch (llmErr) {
            console.warn('[coach] LLM generation error, using curated plan:', llmErr.message);
        }

        // Return curated fallback
        res.json({
            success: true,
            source: 'curated',
            modelUsed: targetModel,
            level,
            recommendations: fallback
        });

    } catch (err) {
        console.error('[coach] Error:', err.message);
        const fallback = FALLBACK_RECOMMENDATIONS.A2;
        res.json({
            success: true,
            source: 'fallback',
            level: 'A2',
            recommendations: fallback
        });
    }
});

// POST /api/coach/ask — ask coach for on-demand learning advice
router.post('/ask', async (req, res) => {
    try {
        const { question, userId, level } = req.body;
        if (!question) return res.status(400).json({ error: 'Missing question' });

        const userLevel = level || 'A2';
        const user = userId ? await User.findOne({ userId }) : null;
        const targetModel = user?.selectedModel || DEFAULT_MODEL;

        const coachSystem = `You are a supportive, insightful German Language Professor and Learning Coach for a CEFR ${userLevel} student.
Explain concepts clearly, give concrete examples with German & English translations, and keep explanations practical and encouraging.`;

        const result = await callOllama(targetModel, [
            { role: 'system', content: coachSystem },
            { role: 'user', content: question }
        ]);

        const advice = result.content || 'Keep practicing every day!';
        res.json({ advice, modelUsed: result.modelUsed });

    } catch (err) {
        console.error('[coach] Ask error:', err.message);
        res.status(500).json({ error: 'Coach is unavailable: ' + err.message });
    }
});

export default router;
