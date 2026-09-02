import express from 'express';
import Conversation from '../models/Conversation.js';
import User        from '../models/User.js';
import { checkAndAwardAchievements, getOrCreateDailyStatus } from './auth.js';
import { callOllama } from '../utils/ollama.js';

const router = express.Router();
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

// ---- System prompt builder ----
function buildSystemPrompt(level) {
    return `You are Lukas, an expert German language teacher and friendly conversation partner for a CEFR ${level} student. You MUST follow these rules in every response:
1. Reply in clear, grammatically correct German at exactly ${level} CEFR complexity — use simple sentences and familiar vocabulary appropriate for the level. Do NOT use complex subordinate clauses, subjunctive, or future perfect if the level is A1 or A2.
2. Keep your entire reply to a maximum of 3 sentences.
3. CRITICAL: If the user made any grammar, spelling, or word-choice error in their message, you MUST begin your reply with a correction at the very top in this exact format: [Correction: <brief English explanation of the error and the correct German form>]. Then continue the conversation normally.
4. End with a natural follow-up question to keep the dialogue going.`;
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
            const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1].content : '';
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
        const { message, userId, level, conversationId, isSpeaking } = req.body;

        if (!message || !userId || !level) {
            return res.status(400).json({ error: 'Missing required fields: message, userId, level' });
        }

        const todayStr = new Date().toISOString().split('T')[0];

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
        if (conversationId) {
            conversation = await Conversation.findOne({ _id: conversationId, userId });
            if (conversation && conversation.ended) {
                // If the specified conversation was already ended, start a fresh one
                conversation = null;
            }
        }

        if (!conversation) {
            conversation = await Conversation.findOne({
                userId,
                level,
                ended: { $ne: true }
            }).sort({ updatedAt: -1 });
        }

        if (!conversation) {
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

        // Build full Ollama message history
        const ollamaMessages = [
            { role: 'system', content: buildSystemPrompt(level) },
            ...conversation.messages.slice(-8).map(m => ({
                role:    m.sender === 'user' ? 'user' : 'assistant',
                content: m.content
            })),
            { role: 'user', content: message }
        ];

        const result = await callOllama(targetModel, ollamaMessages);
        let aiReply = (result.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        if (!aiReply || aiReply.length < 4 || aiReply.startsWith('.)') || aiReply.startsWith('Option ')) {
            aiReply = 'Das klingt spannend! Erzähl mir bitte mehr darüber. Was denkst du dazu?';
        }

        // Persist both turns to MongoDB
        conversation.messages.push({ sender: 'user', content: message  });
        conversation.messages.push({ sender: 'ai',   content: aiReply  });
        await conversation.save();

        // Check if there was a correction
        const corrMatch = aiReply.match(/^\[Correction:\s*([\s\S]*?)\]/i);
        if (corrMatch) {
            if (!user.recentMistakes) user.recentMistakes = [];
            user.recentMistakes.push({
                error: message,
                fix: corrMatch[1].trim(),
                rule: 'Chat error',
                source: isSpeaking ? 'speaking' : 'chat',
                timestamp: new Date()
            });
            if (user.recentMistakes.length > 25) user.recentMistakes = user.recentMistakes.slice(-25);
        }

        // Update stats & XP
        user.totalMessages = (user.totalMessages || 0) + 1;
        user.xp = (user.xp || 0) + 3;
        user.lastActiveAt = new Date();

        // Update daily module status
        const dailyStatus = getOrCreateDailyStatus(user, todayStr);
        if (isSpeaking) {
            dailyStatus.speakingCount = (dailyStatus.speakingCount || 0) + 1;
            if (dailyStatus.speakingCount >= 2) dailyStatus.speakingCompleted = true;
        } else {
            dailyStatus.chatCount = (dailyStatus.chatCount || 0) + 1;
            if (dailyStatus.chatCount >= 3) dailyStatus.chatCompleted = true;
        }

        // Update study history
        if (!user.studyHistory) user.studyHistory = [];
        let hist = user.studyHistory.find(h => h.date === todayStr);
        if (hist) {
            hist.messagesSent = (hist.messagesSent || 0) + 1;
            hist.xp = (hist.xp || 0) + 3;
            hist.minutesSpent = (hist.minutesSpent || 0) + 1;
        } else {
            user.studyHistory.push({
                date: todayStr,
                xp: 3,
                wordsLearned: 0,
                messagesSent: 1,
                essaysGraded: 0,
                minutesSpent: 1
            });
        }

        user.markModified('dailyModuleStatus');
        user.markModified('studyHistory');
        await checkAndAwardAchievements(user);
        await user.save();

        res.json({
            reply: aiReply,
            conversationId: conversation._id.toString(),
            title: conversation.title,
            ended: conversation.ended,
            xpEarned: 3
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

            // Award 10 completion XP to user
            let user = await User.findOne({ userId });
            if (user) {
                user.xp = (user.xp || 0) + 10;
                user.lastActiveAt = new Date();
                await checkAndAwardAchievements(user);
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
                    xpEarned: 10,
                    level: conversation.level
                }
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

// POST /api/chat/speaking-turn — track completed speaking session
router.post('/speaking-turn', async (req, res) => {
    try {
        const { userId, level, minutes } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const todayStr = new Date().toISOString().split('T')[0];
        let user = await User.findOne({ userId });
        if (user) {
            const dailyStatus = getOrCreateDailyStatus(user, todayStr);
            dailyStatus.speakingCount = (dailyStatus.speakingCount || 0) + 1;
            dailyStatus.speakingCompleted = true;
            user.xp = (user.xp || 0) + 5;
            user.lastActiveAt = new Date();
            await checkAndAwardAchievements(user);
            await user.save();
        }

        res.json({ success: true, xpEarned: 5 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
