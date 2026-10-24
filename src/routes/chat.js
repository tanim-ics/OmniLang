import express from 'express';
import Conversation from '../models/Conversation.js';
import User        from '../models/User.js';
import { callOllama, TASK } from '../utils/ollama.js';
import { proofread } from '../utils/proofread.js';
import { awardActivity } from '../utils/game.js';

const router = express.Router();
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || '';

// ---- Tutor prompt ----
const LEVEL_STYLE = {
    A1: 'Very short main clauses, present tense only, the 500 most common words.',
    A2: 'Short sentences, Präsens and Perfekt, simple connectors (und, aber, weil, dann).',
    B1: 'Natural everyday German, subordinate clauses (dass, obwohl, wenn), Präteritum of common verbs.',
    B2: 'Fluent German with Konjunktiv II, passive voice and varied connectors.',
    C1: 'Sophisticated, idiomatic German with nominal style and nuanced vocabulary.'
};

function buildSystemPrompt(level, { topic = '' } = {}) {
    return `Du bist Lukas, ein herzlicher, geduldiger Deutschlehrer und Gesprächspartner für eine Person auf CEFR-Niveau ${level}.
Sprachniveau deiner Antwort: ${LEVEL_STYLE[level] || LEVEL_STYLE.A2}
${topic ? `Die Person beantwortet gerade diese Frage: "${topic}"\n` : ''}Regeln:
- Antworte NUR auf Deutsch, in höchstens 3 kurzen Sätzen.
- Reagiere konkret und natürlich auf den Inhalt der letzten Nachricht, wie ein echter Freund.
- Frag NIE nach etwas, das die Person gerade schon erzählt hat; frag nach einem neuen Detail (Wer? Warum? Wie war es?).
- Korrigiere KEINE Fehler (das macht ein anderes System) und erwähne keine Grammatik.
- Beende deine Antwort mit genau EINER passenden Anschlussfrage.`;
}

// Keep at most 3 sentences, as the spec requires (small models drift).
function capSentences(text, max = 3) {
    const parts = text.match(/[^.!?]+[.!?]+["»“]?|[^.!?]+$/g) || [text];
    return parts.slice(0, max).join(' ').replace(/\s+/g, ' ').trim();
}

/** Ask the tutor and return { reply, correction } where reply carries the [Correction: …] prefix. */
async function askTutor(model, level, history, message, ctx) {
    const messages = [
        { role: 'system', content: buildSystemPrompt(level, ctx) },
        ...history.slice(-8).map(m => ({
            role: m.sender === 'user' ? 'user' : 'assistant',
            // Strip earlier correction prefixes so the model doesn't imitate them.
            content: m.content.replace(/^\[Correction:[\s\S]*?\]\s*/i, '')
        })),
        { role: 'user', content: message }
    ];

    // Independent calls — Ollama runs them concurrently when OLLAMA_NUM_PARALLEL > 1.
    const [chat, correction] = await Promise.all([
        callOllama(model, messages, { options: TASK.chat }),
        proofread(model, level, message, ctx.speaking)
    ]);

    let reply = capSentences(chat.content.replace(/^\[Correction:[\s\S]*?\]\s*/i, '').trim());
    if (!reply || reply.length < 4) reply = 'Das klingt spannend! Erzähl mir bitte mehr darüber. Was denkst du dazu?';

    if (correction) {
        const why = correction.explanation ? `${correction.explanation} ` : '';
        reply = `[Correction: ${why}→ „${correction.corrected}“] ${reply}`;
    }
    return { reply, correction };
}

// GET /api/chat/sessions — fetch all conversation sessions for user
router.get('/sessions', async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const sessions = await Conversation.find({ userId })
            .sort({ updatedAt: -1 })
            .limit(50)
            .select('_id level title ended summary messages createdAt updatedAt')
            .lean();

        const formatted = sessions.map(s => {
            const msgs = s.messages || [];
            const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1].content.replace(/^\[Correction:[\s\S]*?\]\s*/i, '') : '';
            const firstUserMsg = msgs.find(m => m.sender === 'user');
            let derivedTitle = s.title;
            if (!derivedTitle || derivedTitle === 'Neues Gespräch') {
                if (firstUserMsg && firstUserMsg.content) {
                    derivedTitle = firstUserMsg.content.slice(0, 32) + (firstUserMsg.content.length > 32 ? '…' : '');
                } else {
                    derivedTitle = 'Gespräch (' + (s.level || 'A2') + ')';
                }
            }

            return {
                id: s._id.toString(),
                level: s.level || 'A2',
                title: derivedTitle,
                ended: !!s.ended,
                summary: s.summary || '',
                messageCount: msgs.length,
                lastMessageSnippet: lastMsg ? (lastMsg.slice(0, 70) + (lastMsg.length > 70 ? '…' : '')) : 'Noch keine Nachrichten',
                createdAt: s.createdAt,
                updatedAt: s.updatedAt
            };
        });

        res.json({ sessions: formatted });
    } catch (err) {
        console.error('[chat/sessions] Error:', err.message);
        res.status(500).json({ error: 'Failed to load sessions: ' + err.message });
    }
});

// GET /api/chat/session/:id — fetch full conversation messages
router.get('/session/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.query;
        const session = await Conversation.findOne({ _id: id, userId }).lean();
        if (!session) return res.status(404).json({ error: 'Conversation session not found' });
        res.json({
            session: {
                id: session._id.toString(),
                level: session.level,
                title: session.title || 'Gespräch',
                ended: !!session.ended,
                summary: session.summary || '',
                messages: session.messages || [],
                createdAt: session.createdAt,
                updatedAt: session.updatedAt
            }
        });
    } catch (err) {
        console.error('[chat/session/:id] Error:', err.message);
        res.status(500).json({ error: 'Failed to load session: ' + err.message });
    }
});

// POST /api/chat/new-session — explicitly start a brand new conversation
router.post('/new-session', async (req, res) => {
    try {
        const { userId, level } = req.body;
        if (!userId || !level) return res.status(400).json({ error: 'Missing userId or level' });

        const session = await Conversation.create({
            userId,
            level,
            title: 'Neues Gespräch',
            ended: false,
            messages: []
        });

        res.json({
            session: {
                id: session._id.toString(),
                level: session.level,
                title: session.title,
                ended: false,
                messages: []
            }
        });
    } catch (err) {
        console.error('[chat/new-session] Error:', err.message);
        res.status(500).json({ error: 'Failed to create new session: ' + err.message });
    }
});

// POST /api/chat — send a conversational message
router.post('/', async (req, res) => {
    try {
        const { message, userId, level, conversationId, isSpeaking, speakingPrompt } = req.body;

        if (!message || !userId || !level) {
            return res.status(400).json({ error: 'Missing required fields: message, userId, level' });
        }

        // Upsert user, update level if changed
        let user = await User.findOne({ userId });
        if (!user) {
            user = await User.create({ userId, currentLevel: level, username: 'Learner' });
        } else if (user.currentLevel !== level) {
            user.currentLevel = level;
            user.lastActiveAt = new Date();
        }

        const targetModel = user.selectedModel || DEFAULT_MODEL;

        // Resolve conversation: specified ID, or latest unended conversation, or create a new one
        let conversation = null;
        if (isSpeaking) {
            // speaking drills don't touch chat threads
        } else if (conversationId) {
            conversation = await Conversation.findOne({ _id: conversationId, userId });
            if (conversation && conversation.ended) {
                // If the specified conversation was already ended, start a fresh one
                conversation = null;
            }
        }

        if (!conversation && !isSpeaking) {
            conversation = await Conversation.findOne({
                userId,
                level,
                ended: { $ne: true }
            }).sort({ updatedAt: -1 });
        }

        if (isSpeaking) {
            // no thread
        } else if (!conversation) {
            conversation = await Conversation.create({
                userId,
                level,
                title: message.slice(0, 32) + (message.length > 32 ? '…' : ''),
                ended: false,
                messages: []
            });
        } else if (!conversation.title || conversation.title === 'Neues Gespräch') {
            // Set dynamic title from first user message
            conversation.title = message.slice(0, 32) + (message.length > 32 ? '…' : '');
        }

        const speaking = !!isSpeaking;
        const { reply: aiReply, correction } = await askTutor(
            targetModel, level, speaking ? [] : conversation.messages, message, { speaking, topic: speakingPrompt }
        );

        // Speaking drills are single-turn; only typed chat is kept as a conversation thread.
        if (!speaking) {
            conversation.messages.push({ sender: 'user', content: message });
            conversation.messages.push({ sender: 'ai',   content: aiReply });
            await conversation.save();
        }

        if (correction) {
            if (!user.recentMistakes) user.recentMistakes = [];
            user.recentMistakes.push({
                error: correction.original,
                fix: correction.corrected,
                rule: correction.explanation || 'Chat error',
                source: speaking ? 'speaking' : 'chat',
                timestamp: new Date()
            });
            if (user.recentMistakes.length > 25) user.recentMistakes = user.recentMistakes.slice(-25);
        }

        user.totalMessages = (user.totalMessages || 0) + 1;
        const bonus = correction ? [] : [{ label: 'Fehlerfrei!', xp: 2 }];
        const progress = await awardActivity(user, speaking ? 'speaking_turn' : 'chat_message', { bonus });
        await user.save();

        res.json({
            reply: aiReply,
            correction,
            conversationId: conversation?._id.toString() || null,
            title: conversation?.title || '',
            ended: conversation?.ended || false,
            xpEarned: progress.xpGained,
            progress
        });

    } catch (err) {
        console.error('[chat] Error:', err.message);
        res.status(500).json({ error: 'AI service error: ' + err.message });
    }
});

// POST /api/chat/end — gracefully end the current conversation with Lukas's summary & farewell
router.post('/end', async (req, res) => {
    try {
        const { conversationId, userId } = req.body;
        if (!conversationId || !userId) {
            return res.status(400).json({ error: 'Missing required fields: conversationId, userId' });
        }

        const conversation = await Conversation.findOne({ _id: conversationId, userId });
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation session not found' });
        }

        const userMessages = conversation.messages.filter(m => m.sender === 'user');
        const userMsgCount = userMessages.length;
        const correctionsCount = conversation.messages.filter(m => m.sender === 'ai' && m.content.includes('[Correction:')).length;

        if (!conversation.ended) {
            conversation.ended = true;

            // Lukas's level-calibrated German closing message
            const farewell = `Vielen Dank für das tolle Gespräch! 🎓 Du hast in dieser Sitzung ${userMsgCount} Nachrichten auf Deutsch geschrieben. Jedes Gespräch stärkt deine Sprachgewandtheit. Mach weiter so und bis zum nächsten Mal! 🇩🇪✨`;

            conversation.messages.push({
                sender: 'ai',
                content: farewell
            });

            // Set final summary
            conversation.summary = `Abgeschlossen: ${userMsgCount} Nachrichten, ${correctionsCount} Korrekturen geübt.`;
            await conversation.save();

            let progress = null;
            const user = await User.findOne({ userId });
            if (user && userMsgCount > 0) {
                progress = await awardActivity(user, 'chat_completed');
                await user.save();
            }

            return res.json({
                success: true,
                farewell,
                conversationId: conversation._id.toString(),
                stats: {
                    userMessages: userMsgCount,
                    totalMessages: conversation.messages.length,
                    correctionsCount,
                    xpEarned: progress ? progress.xpGained : 0,
                    level: conversation.level
                },
                progress
            });
        } else {
            return res.json({
                success: true,
                alreadyEnded: true,
                conversationId: conversation._id.toString(),
                stats: {
                    userMessages: userMsgCount,
                    totalMessages: conversation.messages.length,
                    correctionsCount,
                    xpEarned: 0,
                    level: conversation.level
                }
            });
        }
    } catch (err) {
        console.error('[chat/end] Error:', err.message);
        res.status(500).json({ error: 'Failed to end conversation: ' + err.message });
    }
});

// POST /api/chat/speaking-turn — legacy endpoint; speaking turns are now rewarded in POST /api/chat
router.post('/speaking-turn', (_req, res) => res.json({ success: true, xpEarned: 0 }));

// DELETE /api/chat/session/:id — delete a specific conversation session
router.delete('/session/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        await Conversation.deleteOne({ _id: id, userId });
        res.json({ success: true, deletedId: id });
    } catch (err) {
        console.error('[chat/session/delete] Error:', err.message);
        res.status(500).json({ error: 'Failed to delete session: ' + err.message });
    }
});

// DELETE /api/chat/reset — clear all conversation history for a user + level
router.delete('/reset', async (req, res) => {
    try {
        const { userId, level } = req.body;
        if (!userId || !level) {
            return res.status(400).json({ error: 'Missing required fields: userId, level' });
        }

        await Conversation.deleteMany({ userId, level });
        res.json({ success: true });

    } catch (err) {
        console.error('[chat] Reset error:', err.message);
        res.status(500).json({ error: 'Failed to reset conversation' });
    }
});

export default router;
