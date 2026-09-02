import express from 'express';
import { randomBytes } from 'crypto';
import User from '../models/User.js';
import Vocabulary from '../models/Vocabulary.js';

const router = express.Router();

// Helper: get or create today's daily module status
export function getOrCreateDailyStatus(user, dateStr = new Date().toISOString().split('T')[0]) {
    if (!user.dailyModuleStatus) user.dailyModuleStatus = [];
    let todayStatus = user.dailyModuleStatus.find(s => s.date === dateStr);
    if (!todayStatus) {
        todayStatus = {
            date: dateStr,
            vocabCompleted: false,
            vocabCount: 0,
            chatCompleted: false,
            chatCount: 0,
            speakingCompleted: false,
            speakingCount: 0,
            writingCompleted: false,
            writingCount: 0,
            readingCompleted: false,
            readingCount: 0,
            allCompletedBonusAwarded: false
        };
        user.dailyModuleStatus.push(todayStatus);
    }
    return todayStatus;
}

// Helper to award achievements
export async function checkAndAwardAchievements(user) {
    const awards = [
        { id: 'first_login',  title: 'Willkommen!',       description: 'Started your German journey', icon: '🇩🇪', condition: () => true },
        { id: 'first_word',   title: 'Wortschatz Starter', description: 'Learned your first vocabulary word', icon: '🌱', condition: () => (user.totalWordsLearned || 0) >= 1 },
        { id: 'vocab_10',     title: 'Word Collector',     description: 'Learned 10+ German words', icon: '📚', condition: () => (user.totalWordsLearned || 0) >= 10 },
        { id: 'vocab_25',     title: 'Lexicon Master',     description: 'Learned 25+ German words', icon: '🧠', condition: () => (user.totalWordsLearned || 0) >= 25 },
        { id: 'first_chat',   title: 'Plaudertasche',      description: 'Sent your first message to Lukas', icon: '💬', condition: () => (user.totalMessages || 0) >= 1 },
        { id: 'chat_15',      title: 'German Speaker',     description: 'Exchanged 15+ messages with AI', icon: '🎙️', condition: () => (user.totalMessages || 0) >= 15 },
        { id: 'first_essay',  title: 'Schriftsteller',     description: 'Submitted your first German essay for grading', icon: '✍️', condition: () => (user.essaysGraded || 0) >= 1 },
        { id: 'streak_3',     title: 'Disziplin',          description: 'Maintained a 3-day study streak', icon: '🔥', condition: () => (user.streak || 0) >= 3 },
        { id: 'streak_7',     title: 'Feuer und Flamme',   description: 'Reached a 7-day study streak', icon: '⚡', condition: () => (user.streak || 0) >= 7 },
        { id: 'xp_100',       title: 'XP Pioneer',         description: 'Earned over 100 XP', icon: '🏆', condition: () => (user.xp || 0) >= 100 },
        { id: 'xp_500',       title: 'Master Scholar',     description: 'Earned over 500 XP', icon: '👑', condition: () => (user.xp || 0) >= 500 },
        { id: 'daily_all',    title: 'Daily Champion',     description: 'Completed all 5 practice modules in a single day', icon: '⭐', condition: () => (user.dailyModuleStatus || []).some(d => d.vocabCompleted && d.chatCompleted && d.writingCompleted && d.readingCompleted) }
    ];

    let updated = false;
    const existingIds = new Set((user.achievements || []).map(a => a.id));

    for (const award of awards) {
        if (!existingIds.has(award.id) && award.condition()) {
            user.achievements.push({
                id: award.id,
                title: award.title,
                description: award.description,
                icon: award.icon,
                unlockedAt: new Date()
            });
            updated = true;
        }
    }

    return updated;
}

// GET /api/auth/daily-status/:userId — get time-synced daily status for all modules
router.get('/daily-status/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        let user = await User.findOne({ userId });
        if (!user) {
            user = await User.create({ userId, username: 'Learner', currentLevel: 'A2' });
        }

        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const dailyStatus = getOrCreateDailyStatus(user, todayStr);

        // Calculate exact time to midnight reset
        const midnight = new Date(now);
        midnight.setHours(24, 0, 0, 0);
        const msUntilReset = Math.max(0, midnight - now);
        const hoursUntilReset = Math.floor(msUntilReset / (1000 * 60 * 60));
        const minsUntilReset  = Math.floor((msUntilReset % (1000 * 60 * 60)) / (1000 * 60));
        const secsUntilReset  = Math.floor((msUntilReset % (1000 * 60)) / 1000);
        const resetsInFormatted = `${hoursUntilReset}h ${minsUntilReset}m ${secsUntilReset}s`;

        // Check due vocabulary count in MongoDB
        const dueVocabCount = await Vocabulary.countDocuments({
            userId,
            nextReviewDate: { $lte: now }
        });

        const modules = {
            vocab: {
                id: 'vocab',
                name: 'Vocabulary SRS',
                due: !dailyStatus.vocabCompleted,
                completed: dailyStatus.vocabCompleted,
                current: dailyStatus.vocabCount || 0,
                target: 5,
                unit: 'cards',
                badge: dailyStatus.vocabCompleted ? '✓ Completed Today' : `${dueVocabCount > 0 ? dueVocabCount : 5} Cards Due`,
                statusType: dailyStatus.vocabCompleted ? 'completed' : 'due',
                icon: 'fa-layer-group'
            },
            chat: {
                id: 'chat',
                name: 'AI Conversation',
                due: !dailyStatus.chatCompleted,
                completed: dailyStatus.chatCompleted,
                current: dailyStatus.chatCount || 0,
                target: 3,
                unit: 'messages',
                badge: dailyStatus.chatCompleted ? '✓ Completed Today' : `Daily Chat Due (${dailyStatus.chatCount || 0}/3)`,
                statusType: dailyStatus.chatCompleted ? 'completed' : 'due',
                icon: 'fa-comments'
            },
            speaking: {
                id: 'speaking',
                name: 'Speaking Mode',
                due: !dailyStatus.speakingCompleted,
                completed: dailyStatus.speakingCompleted,
                current: dailyStatus.speakingCount || 0,
                target: 2,
                unit: 'turns',
                badge: dailyStatus.speakingCompleted ? '✓ Completed Today' : `Speaking Due (${dailyStatus.speakingCount || 0}/2)`,
                statusType: dailyStatus.speakingCompleted ? 'completed' : 'due',
                icon: 'fa-microphone-lines'
            },
            writing: {
                id: 'writing',
                name: 'Writing & Essay',
                due: !dailyStatus.writingCompleted,
                completed: dailyStatus.writingCompleted,
                current: dailyStatus.writingCount || 0,
                target: 1,
                unit: 'essay',
                badge: dailyStatus.writingCompleted ? '✓ Graded Today' : 'Daily Essay Due',
                statusType: dailyStatus.writingCompleted ? 'completed' : 'due',
                icon: 'fa-pen-nib'
            },
            reading: {
                id: 'reading',
                name: 'Graded Reading',
                due: !dailyStatus.readingCompleted,
                completed: dailyStatus.readingCompleted,
                current: dailyStatus.readingCount || 0,
                target: 1,
                unit: 'story',
                badge: dailyStatus.readingCompleted ? '✓ Read Today' : 'Daily Story Due',
                statusType: dailyStatus.readingCompleted ? 'completed' : 'due',
                icon: 'fa-book-open'
            }
        };

        const totalModules = 5;
        const completedModules = Object.values(modules).filter(m => m.completed).length;
        const dueModules = totalModules - completedModules;
        const allCompleted = completedModules === totalModules;

        // Check if all completed today for bonus XP
        let bonusAwarded = false;
        if (allCompleted && !dailyStatus.allCompletedBonusAwarded) {
            dailyStatus.allCompletedBonusAwarded = true;
            user.xp = (user.xp || 0) + 50;
            bonusAwarded = true;
            await checkAndAwardAchievements(user);
            await user.save();
        }

        res.json({
            today: todayStr,
            currentTimestamp: now.toISOString(),
            timeFormatted: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            dateFormatted: now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
            resetsIn: resetsInFormatted,
            secondsUntilReset: Math.floor(msUntilReset / 1000),
            modules,
            summary: {
                total: totalModules,
                completedCount: completedModules,
                dueCount: dueModules,
                completionPct: Math.round((completedModules / totalModules) * 100),
                allDone: allCompleted,
                bonusAwarded
            }
        });
    } catch (err) {
        console.error('[auth] Daily status error:', err.message);
        res.status(500).json({ error: 'Failed to get daily status: ' + err.message });
    }
});

// POST /api/auth/login — find or create user by username
router.post('/login', async (req, res) => {
    try {
        const { username, level, avatar } = req.body;
        if (!username || !username.trim()) {
            return res.status(400).json({ error: 'Username is required' });
        }

        const validLevels = ['A1', 'A2', 'B1', 'B2', 'C1'];
        const userLevel   = validLevels.includes(level) ? level : 'A2';
        const cleanName   = username.trim().slice(0, 30);

        let user = await User.findOne({
            username: { $regex: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        });

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        if (!user) {
            const userId = 'u_' + randomBytes(6).toString('hex');
            user = new User({
                userId,
                username: cleanName,
                currentLevel: userLevel,
                avatar: avatar || '🇩🇪',
                streak: 1,
                lastActiveAt: today,
                xp: 0,
                dailyGoalMinutes: 15,
                dailyGoalXp: 30,
                selectedModel: process.env.OLLAMA_MODEL || 'mistral-nemo:12b',
                theme: 'dark-glass',
                studyHistory: [{ date: todayStr, xp: 0, wordsLearned: 0, messagesSent: 0, essaysGraded: 0, minutesSpent: 0 }],
                progressByLevel: {
                    A1: { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 },
                    A2: { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 },
                    B1: { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 },
                    B2: { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 },
                    C1: { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 }
                }
            });
            await checkAndAwardAchievements(user);
            await user.save();
        } else {
            // Update streak if active on a new day
            const lastActive = user.lastActiveAt ? new Date(user.lastActiveAt) : new Date();
            const diffDays   = Math.floor((today - lastActive) / (1000 * 60 * 60 * 24));

            if (diffDays === 1) {
                user.streak = (user.streak || 0) + 1;
            } else if (diffDays > 1) {
                user.streak = 1; // Reset streak if missed days
            }

            user.lastActiveAt = today;
            if (level && validLevels.includes(level)) user.currentLevel = level;
            if (avatar) user.avatar = avatar;

            await checkAndAwardAchievements(user);
            await user.save();
        }

        res.json({
            userId:            user.userId,
            username:          user.username,
            currentLevel:      user.currentLevel,
            streak:            user.streak,
            xp:                user.xp,
            totalWordsLearned: user.totalWordsLearned || 0,
            totalMessages:     user.totalMessages || 0,
            essaysGraded:      user.essaysGraded || 0,
            avatar:            user.avatar || '🇩🇪',
            theme:             user.theme || 'dark-glass',
            dailyGoalMinutes:  user.dailyGoalMinutes || 15,
            dailyGoalXp:       user.dailyGoalXp || 30,
            selectedModel:     user.selectedModel || process.env.OLLAMA_MODEL || 'mistral-nemo:12b'
        });

    } catch (err) {
        console.error('[auth] Login error:', err.message);
        res.status(500).json({ error: 'Login failed: ' + err.message });
    }
});

// GET /api/auth/profile/:userId — load complete user profile & analytics
router.get('/profile/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        let user = await User.findOne({ userId });

        if (!user) {
            user = new User({
                userId,
                username: 'Learner',
                currentLevel: 'A2',
                streak: 1,
                xp: 0,
                avatar: '🇩🇪',
                theme: 'dark-glass',
                selectedModel: process.env.OLLAMA_MODEL || 'mistral-nemo:12b'
            });
            await checkAndAwardAchievements(user);
            await user.save();
        }

        res.json({
            userId:            user.userId,
            username:          user.username,
            currentLevel:      user.currentLevel,
            streak:            user.streak || 1,
            xp:                user.xp || 0,
            totalWordsLearned: user.totalWordsLearned || 0,
            totalMessages:     user.totalMessages || 0,
            essaysGraded:      user.essaysGraded || 0,
            averageEssayScore: user.averageEssayScore || 0,
            storiesRead:       user.storiesRead || 0,
            avatar:            user.avatar || '🇩🇪',
            dailyGoalMinutes:  user.dailyGoalMinutes || 15,
            dailyGoalXp:       user.dailyGoalXp || 30,
            selectedModel:     user.selectedModel || process.env.OLLAMA_MODEL || 'mistral-nemo:12b',
            theme:             user.theme || 'dark-glass',
            ttsVoice:          user.ttsVoice || 'de-DE',
            ttsRate:           user.ttsRate || 0.95,
            progressByLevel:   user.progressByLevel || {
                A1: { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 },
                A2: { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 },
                B1: { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 },
                B2: { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 },
                C1: { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 }
            },
            srsProgress:       user.srsProgress || [],
            studyHistory:      user.studyHistory || [],
            recentMistakes:    user.recentMistakes || [],
            achievements:      user.achievements || [],
            createdAt:         user.createdAt
        });

    } catch (err) {
        console.error('[auth] Profile fetch error:', err.message);
        res.status(500).json({ error: 'Failed to load profile: ' + err.message });
    }
});

// POST /api/auth/set-level — instantly switch active CEFR level
router.post('/set-level', async (req, res) => {
    try {
        const { userId, level } = req.body;
        const validLevels = ['A1', 'A2', 'B1', 'B2', 'C1'];
        if (!userId || !validLevels.includes(level)) {
            return res.status(400).json({ error: 'Valid userId and level (A1, A2, B1, B2, C1) required' });
        }

        const user = await User.findOneAndUpdate(
            { userId },
            { $set: { currentLevel: level } },
            { new: true }
        );
        if (!user) return res.status(404).json({ error: 'User not found' });

        res.json({ success: true, currentLevel: user.currentLevel });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/reset-daily-modules — reset today's practice completion status
router.post('/reset-daily-modules', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const todayStr = new Date().toISOString().split('T')[0];
        const user = await User.findOne({ userId });
        if (user) {
            user.dailyModuleStatus = (user.dailyModuleStatus || []).filter(s => s.date !== todayStr);
            user.markModified('dailyModuleStatus');
            await user.save();
        }

        res.json({ success: true, message: "Today's practice modules reset to due" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/settings/update — update user preferences
router.post('/settings/update', async (req, res) => {
    try {
        const { userId, username, avatar, currentLevel, dailyGoalMinutes, dailyGoalXp, selectedModel, theme, ttsVoice, ttsRate } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const updateFields = {};
        if (username)          updateFields.username = username.trim();
        if (avatar)            updateFields.avatar = avatar;
        if (currentLevel)      updateFields.currentLevel = currentLevel;
        if (dailyGoalMinutes)  updateFields.dailyGoalMinutes = Number(dailyGoalMinutes);
        if (dailyGoalXp)       updateFields.dailyGoalXp = Number(dailyGoalXp);
        if (selectedModel)     updateFields.selectedModel = selectedModel;
        if (theme)             updateFields.theme = theme;
        if (ttsVoice)          updateFields.ttsVoice = ttsVoice;
        if (ttsRate)           updateFields.ttsRate = Number(ttsRate);

        const user = await User.findOneAndUpdate(
            { userId },
            { $set: updateFields },
            { new: true }
        );

        if (!user) return res.status(404).json({ error: 'User not found' });

        res.json({
            success: true,
            user: {
                userId:            user.userId,
                username:          user.username,
                currentLevel:      user.currentLevel,
                avatar:            user.avatar,
                dailyGoalMinutes:  user.dailyGoalMinutes,
                dailyGoalXp:       user.dailyGoalXp,
                selectedModel:     user.selectedModel,
                theme:             user.theme,
                ttsVoice:          user.ttsVoice,
                ttsRate:           user.ttsRate,
                streak:            user.streak,
                xp:                user.xp
            }
        });

    } catch (err) {
        console.error('[auth] Settings update error:', err.message);
        res.status(500).json({ error: 'Failed to update settings: ' + err.message });
    }
});

// POST /api/auth/reset-progress — reset XP and progress for user
router.post('/reset-progress', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const user = await User.findOneAndUpdate(
            { userId },
            {
                $set: {
                    xp: 0,
                    streak: 1,
                    totalWordsLearned: 0,
                    totalMessages: 0,
                    essaysGraded: 0,
                    averageEssayScore: 0,
                    storiesRead: 0,
                    srsProgress: [],
                    recentMistakes: [],
                    achievements: [],
                    dailyModuleStatus: [],
                    studyHistory: [{ date: new Date().toISOString().split('T')[0], xp: 0, wordsLearned: 0, messagesSent: 0, essaysGraded: 0, minutesSpent: 0 }],
                    progressByLevel: {
                        A1: { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 },
                        A2: { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 },
                        B1: { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 },
                        B2: { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 },
                        C1: { wordsLearned: 0, sessionsCount: 0, writingScore: 0, readingCount: 0 }
                    }
                }
            },
            { new: true }
        );

        if (!user) return res.status(404).json({ error: 'User not found' });
        await checkAndAwardAchievements(user);
        await user.save();

        res.json({ success: true, message: 'Progress has been reset' });

    } catch (err) {
        console.error('[auth] Reset error:', err.message);
        res.status(500).json({ error: 'Failed to reset progress: ' + err.message });
    }
});

export default router;
