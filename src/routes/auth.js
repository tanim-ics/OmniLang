import express from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import User from '../models/User.js';
import Vocabulary from '../models/Vocabulary.js';

// ---- OTP email sender (nodemailer when SMTP configured; console fallback for local dev) ----
async function sendOtpEmail(toEmail, otp, nickname, purpose = 'verification') {
    const isReset  = purpose === 'password reset';
    const subject  = isReset ? 'OmniLang — Password Reset Code' : 'OmniLang — Email Verification Code';
    const headline = isReset ? '🔑 Reset your password' : '✅ Verify your email';
    const body     = isReset
        ? 'You requested a password reset. Enter this code to set a new password:'
        : 'Thanks for signing up! Enter this code to activate your account:';

    const smtpHost = process.env.SMTP_HOST;
    if (smtpHost && process.env.SMTP_USER && process.env.SMTP_PASS) {
        try {
            const nodemailer = await import('nodemailer');
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT) || 587,
                secure: false,
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            });
            await transporter.sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to: toEmail,
                subject,
                html: `
                    <div style="font-family:sans-serif;max-width:460px;margin:auto;padding:2rem;background:#0b0f19;color:#f8fafc;border-radius:16px;">
                        <h2 style="color:#6366f1;">🌐 OmniLang</h2>
                        <h3 style="color:#f8fafc;">${headline}</h3>
                        <p>Hi <strong>@${nickname}</strong>,</p>
                        <p>${body}</p>
                        <div style="font-size:2.5rem;font-weight:900;letter-spacing:0.4rem;color:#06b6d4;padding:1rem 0;">${otp}</div>
                        <p style="color:#94a3b8;">This code expires in <strong>15 minutes</strong>. Do not share it with anyone.</p>
                    </div>`
            });
            return true;
        } catch (err) {
            console.warn('[auth] SMTP send failed, falling back to console:', err.message);
        }
    }
    // Local dev fallback — print to console
    const label = isReset ? 'PASSWORD RESET CODE' : 'OTP CODE';
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📧  ${label} for ${toEmail} (@${nickname}): ${otp}`);
    console.log(`${'='.repeat(60)}\n`);
    return true;
}

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

// Helper to award achievements with tiers and bonus XP
export async function checkAndAwardAchievements(user) {
    const awards = [
        // General & Onboarding
        { id: 'first_login',  title: 'Willkommen!',             description: 'Begann die Reise in die deutsche Sprache', icon: '🇩🇪', tier: 'bronze', category: 'general', xpReward: 25, condition: () => true },
        { id: 'daily_all',    title: 'Tages-Champion',           description: 'Alle 4 Lernmodule an einem einzigen Tag gemeistert', icon: '⭐', tier: 'gold', category: 'general', xpReward: 150, condition: () => (user.dailyModuleStatus || []).some(d => d.vocabCompleted && d.chatCompleted && d.writingCompleted && d.readingCompleted) },
        
        // Vocabulary & SRS
        { id: 'first_word',   title: 'Wortschatz Starter',       description: 'Dein allererstes deutsches Wort gelernt', icon: '🌱', tier: 'bronze', category: 'vocab', xpReward: 25, condition: () => (user.totalWordsLearned || 0) >= 1 },
        { id: 'vocab_10',     title: 'Wortsammler',             description: '10+ Vokabeln im Langzeitgedächtnis verankert', icon: '📚', tier: 'bronze', category: 'vocab', xpReward: 50, condition: () => (user.totalWordsLearned || 0) >= 10 },
        { id: 'vocab_25',     title: 'Wortschatz-Kenner',       description: '25+ Wörter aktiv im Leitner-System', icon: '🧠', tier: 'silver', category: 'vocab', xpReward: 75, condition: () => (user.totalWordsLearned || 0) >= 25 },
        { id: 'vocab_50',     title: 'Lexikon-Meister',         description: '50+ Wörter gemeistert — starker Wortschatz!', icon: '🏛️', tier: 'gold', category: 'vocab', xpReward: 125, condition: () => (user.totalWordsLearned || 0) >= 50 },
        { id: 'vocab_100',    title: 'Sprach-Bibliothekar',     description: '100+ Wörter gelernt — wahrer Wortschatz-Gigant!', icon: '👑', tier: 'diamond', category: 'vocab', xpReward: 250, condition: () => (user.totalWordsLearned || 0) >= 100 },

        // Conversation & AI Immersion
        { id: 'first_chat',   title: 'Plaudertasche',            description: 'Die erste Nachricht mit Lukas gewechselt', icon: '💬', tier: 'bronze', category: 'chat', xpReward: 25, condition: () => (user.totalMessages || 0) >= 1 },
        { id: 'chat_15',      title: 'Deutscher Redner',         description: '15+ Gesprächsrunden mit der KI geführt', icon: '🎙️', tier: 'silver', category: 'chat', xpReward: 75, condition: () => (user.totalMessages || 0) >= 15 },
        { id: 'chat_50',      title: 'Lukas’ Bester Freund',     description: '50+ Nachrichten — fließende Dialogbereitschaft!', icon: '🗣️', tier: 'gold', category: 'chat', xpReward: 150, condition: () => (user.totalMessages || 0) >= 50 },
        { id: 'chat_100',     title: 'Sprachgenie im Dialog',    description: '100+ Nachrichten — meisterhafte Gesprächsführung!', icon: '⚡', tier: 'diamond', category: 'chat', xpReward: 300, condition: () => (user.totalMessages || 0) >= 100 },

        // Writing & Essays
        { id: 'first_essay',  title: 'Der Schriftsteller',       description: 'Deinen ersten deutschen Aufsatz zur Bewertung eingereicht', icon: '✍️', tier: 'bronze', category: 'writing', xpReward: 30, condition: () => (user.essaysGraded || 0) >= 1 },
        { id: 'essay_3',      title: 'Goethe-Lehrling',          description: '3+ Aufsätze mit Feedback analysiert und verbessert', icon: '📜', tier: 'silver', category: 'writing', xpReward: 80, condition: () => (user.essaysGraded || 0) >= 3 },
        { id: 'essay_high',   title: 'Goldene Feder',           description: 'Einen Aufsatz mit 85+ Punkten absolviert', icon: '🖋️', tier: 'gold', category: 'writing', xpReward: 150, condition: () => (user.averageEssayScore || 0) >= 85 && (user.essaysGraded || 0) >= 1 },

        // Graded Reading
        { id: 'first_story',  title: 'Lesefuchs',               description: 'Deine erste interaktive Geschichte gelesen', icon: '📖', tier: 'bronze', category: 'reading', xpReward: 25, condition: () => (user.storiesRead || 0) >= 1 },
        { id: 'stories_5',    title: 'Bücherwurm',              description: '5+ CEFR-Geschichten aufmerksam durchgearbeitet', icon: '🦉', tier: 'silver', category: 'reading', xpReward: 75, condition: () => (user.storiesRead || 0) >= 5 },

        // Streaks & Dedication
        { id: 'streak_3',     title: 'Eiserne Disziplin',        description: '3 Tage in Folge ohne Unterbrechung Deutsch geübt', icon: '🔥', tier: 'bronze', category: 'streak', xpReward: 40, condition: () => (user.streak || 0) >= 3 },
        { id: 'streak_7',     title: 'Feuer und Flamme',         description: '7-Tage-Streak! Eine ganze Woche voller Leidenschaft', icon: '🌋', tier: 'silver', category: 'streak', xpReward: 100, condition: () => (user.streak || 0) >= 7 },
        { id: 'streak_14',    title: 'Unaufhaltsam',             description: '14-Tage-Streak! Wahre Meisterschaft durch Gewohnheit', icon: '☄️', tier: 'gold', category: 'streak', xpReward: 200, condition: () => (user.streak || 0) >= 14 },

        // XP Milestones
        { id: 'xp_100',       title: 'XP-Pionier',              description: 'Erreiche 100 Erfahrungspunkte (XP)', icon: '🏆', tier: 'bronze', category: 'xp', xpReward: 25, condition: () => (user.xp || 0) >= 100 },
        { id: 'xp_500',       title: 'Großer Gelehrter',        description: 'Erreiche 500 Erfahrungspunkte (XP)', icon: '🎖️', tier: 'silver', category: 'xp', xpReward: 75, condition: () => (user.xp || 0) >= 500 },
        { id: 'xp_1000',      title: 'Titan der Sprache',       description: 'Über 1.000 XP angehäuft — Legendenstatus!', icon: '🌌', tier: 'diamond', category: 'xp', xpReward: 250, condition: () => (user.xp || 0) >= 1000 }
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
                tier: award.tier,
                category: award.category,
                xpReward: award.xpReward,
                unlockedAt: new Date()
            });
            // Award bonus XP
            user.xp = (user.xp || 0) + award.xpReward;
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

// ---- Cryptographic Password Security Helpers ----
function hashPassword(password, salt = randomBytes(16).toString('hex')) {
    const hash = scryptSync(password, salt, 64).toString('hex');
    return { hash, salt };
}

function verifyPassword(password, storedHash, storedSalt) {
    if (!password || !storedHash || !storedSalt) return false;
    try {
        const computedHash = scryptSync(password, storedSalt, 64).toString('hex');
        const hashBuffer = Buffer.from(storedHash, 'hex');
        const computedBuffer = Buffer.from(computedHash, 'hex');
        if (hashBuffer.length !== computedBuffer.length) return false;
        return timingSafeEqual(hashBuffer, computedBuffer);
    } catch {
        return false;
    }
}

function formatUserPayload(user, token = null) {
    const cleanNick = user.nickname || user.username || 'Learner';
    return {
        userId:            user.userId,
        username:          user.username || 'Learner',
        nickname:          cleanNick.startsWith('@') ? cleanNick : `@${cleanNick}`,
        email:             user.email || '',
        authProvider:      user.authProvider || 'local',
        currentLevel:      user.currentLevel || 'A2',
        streak:            user.streak || 1,
        xp:                user.xp || 0,
        totalWordsLearned: user.totalWordsLearned || 0,
        totalMessages:     user.totalMessages || 0,
        essaysGraded:      user.essaysGraded || 0,
        averageEssayScore: user.averageEssayScore || 0,
        storiesRead:       user.storiesRead || 0,
        avatar:            user.avatar || '🇩🇪',
        theme:             user.theme || 'dark-glass',
        dailyGoalMinutes:  user.dailyGoalMinutes || 15,
        dailyGoalXp:       user.dailyGoalXp || 30,
        selectedModel:     user.selectedModel || process.env.OLLAMA_MODEL || '',
        token:             token || ('tk_' + randomBytes(24).toString('hex'))
    };
}

// POST /api/auth/register — Email & Password Registration
router.post('/register', async (req, res) => {
    try {
        const { email, password, username, nickname, level, avatar } = req.body;

        if (!email || !email.trim()) {
            return res.status(400).json({ error: 'Valid email address is required' });
        }
        const cleanEmail = email.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanEmail)) {
            return res.status(400).json({ error: 'Please enter a valid email format' });
        }

        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long' });
        }
        if (!/[A-Z]/.test(password)) {
            return res.status(400).json({ error: 'Password must contain at least one uppercase letter' });
        }
        if (!/[^A-Za-z0-9]/.test(password)) {
            return res.status(400).json({ error: 'Password must contain at least one special character (e.g. ! @ # $ %)' });
        }

        // Check if email already registered
        const existing = await User.findOne({ email: cleanEmail });
        if (existing) {
            return res.status(409).json({ error: 'This email is already registered. Please sign in instead.' });
        }

        const validLevels = ['A1', 'A2', 'B1', 'B2', 'C1'];
        const userLevel   = validLevels.includes(level) ? level : 'A2';
        const cleanNick   = (nickname || cleanEmail.split('@')[0] || 'Learner').trim().replace(/^@/, '').slice(0, 30);
        const cleanName   = (username || cleanNick).trim().slice(0, 30);

        const { hash, salt } = hashPassword(password);
        const userId = 'u_' + randomBytes(6).toString('hex');
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        // Generate 6-digit OTP for email verification
        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        const user = new User({
            userId,
            username: cleanName,
            nickname: cleanNick,
            email: cleanEmail,
            passwordHash: hash,
            passwordSalt: salt,
            authProvider: 'local',
            isVerified: false,
            verificationCode: otp,
            verificationExpiry: otpExpiry,
            currentLevel: userLevel,
            avatar: avatar || '🇩🇪',
            streak: 1,
            lastActiveAt: today,
            xp: 0,
            dailyGoalMinutes: 15,
            dailyGoalXp: 30,
            selectedModel: process.env.OLLAMA_MODEL || '',
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

        // Send OTP (email or console fallback)
        await sendOtpEmail(cleanEmail, otp, cleanNick);

        // Return userId & nickname for OTP screen (NOT full auth payload yet)
        res.status(201).json({
            requiresVerification: true,
            userId,
            nickname: `@${cleanNick}`,
            email: cleanEmail,
            message: 'Account created. Please check your email for the verification code.'
        });
    } catch (err) {
        console.error('[auth] Register error:', err.message);
        res.status(500).json({ error: 'Registration failed: ' + err.message });
    }
});

// POST /api/auth/verify-otp — Verify 6-digit email OTP and complete account activation
router.post('/verify-otp', async (req, res) => {
    try {
        const { userId, otp } = req.body;
        if (!userId || !otp) return res.status(400).json({ error: 'userId and otp are required' });

        const user = await User.findOne({ userId }).select('+verificationCode +verificationExpiry');
        if (!user) return res.status(404).json({ error: 'Account not found' });
        if (user.isVerified) return res.status(400).json({ error: 'Account already verified' });

        if (!user.verificationCode || user.verificationCode !== String(otp).trim()) {
            return res.status(400).json({ error: 'Invalid verification code. Please try again.' });
        }
        if (!user.verificationExpiry || new Date() > user.verificationExpiry) {
            return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
        }

        user.isVerified = true;
        user.verificationCode = undefined;
        user.verificationExpiry = undefined;
        await user.save();

        res.json({
            success: true,
            message: 'Email verified successfully!',
            ...formatUserPayload(user)
        });
    } catch (err) {
        console.error('[auth] OTP verify error:', err.message);
        res.status(500).json({ error: 'Verification failed: ' + err.message });
    }
});

// POST /api/auth/resend-otp — Resend verification OTP
router.post('/resend-otp', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        const user = await User.findOne({ userId });
        if (!user) return res.status(404).json({ error: 'Account not found' });
        if (user.isVerified) return res.status(400).json({ error: 'Account is already verified' });

        const otp = String(Math.floor(100000 + Math.random() * 900000));
        user.verificationCode = otp;
        user.verificationExpiry = new Date(Date.now() + 15 * 60 * 1000);
        await user.save();

        await sendOtpEmail(user.email, otp, user.nickname || user.username);
        res.json({ success: true, message: 'A new verification code has been sent to your email.' });
    } catch (err) {
        console.error('[auth] Resend OTP error:', err.message);
        res.status(500).json({ error: 'Could not resend code: ' + err.message });
    }
});

// POST /api/auth/forgot-password — Send password reset OTP
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !email.trim()) return res.status(400).json({ error: 'Email address is required' });
        const cleanEmail = email.trim().toLowerCase();

        const user = await User.findOne({ email: cleanEmail });
        // Always return success to prevent email enumeration
        if (!user) {
            return res.json({ success: true, message: 'If that email exists, a reset code has been sent.' });
        }
        if (user.authProvider !== 'local') {
            return res.status(400).json({ error: `This account uses ${user.authProvider} sign-in. Password reset is not applicable.` });
        }

        const otp = String(Math.floor(100000 + Math.random() * 900000));
        user.passwordResetCode    = otp;
        user.passwordResetExpiry  = new Date(Date.now() + 15 * 60 * 1000); // 15 min
        await user.save();

        await sendOtpEmail(cleanEmail, otp, user.nickname || user.username, 'password reset');

        res.json({ success: true, message: 'If that email exists, a reset code has been sent.' });
    } catch (err) {
        console.error('[auth] Forgot password error:', err.message);
        res.status(500).json({ error: 'Could not send reset code: ' + err.message });
    }
});

// POST /api/auth/reset-password — Verify reset OTP and set new password
router.post('/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        if (!email || !otp || !newPassword) {
            return res.status(400).json({ error: 'email, otp, and newPassword are required' });
        }

        // Password policy
        if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
        if (!/[A-Z]/.test(newPassword)) return res.status(400).json({ error: 'Password must contain at least one uppercase letter' });
        if (!/[^A-Za-z0-9]/.test(newPassword)) return res.status(400).json({ error: 'Password must contain at least one special character' });

        const user = await User.findOne({ email: email.trim().toLowerCase() })
            .select('+passwordResetCode +passwordResetExpiry');
        if (!user) return res.status(404).json({ error: 'Account not found' });

        if (!user.passwordResetCode || user.passwordResetCode !== String(otp).trim()) {
            return res.status(400).json({ error: 'Invalid reset code. Please try again.' });
        }
        if (!user.passwordResetExpiry || new Date() > user.passwordResetExpiry) {
            return res.status(400).json({ error: 'Reset code has expired. Please request a new one.' });
        }

        const { hash, salt } = hashPassword(newPassword);
        user.passwordHash        = hash;
        user.passwordSalt        = salt;
        user.passwordResetCode   = undefined;
        user.passwordResetExpiry = undefined;
        user.isVerified          = true; // Reset also verifies the account
        await user.save();

        res.json({ success: true, message: 'Password updated successfully. You can now sign in.' });
    } catch (err) {
        console.error('[auth] Reset password error:', err.message);
        res.status(500).json({ error: 'Password reset failed: ' + err.message });
    }
});

// POST /api/auth/login — Secure Sign-In (Email/Nickname + Password, or Guest)
router.post('/login', async (req, res) => {
    try {
        const { identifier, email, username, password, level, avatar } = req.body;
        const loginQuery = (identifier || email || username || '').trim();

        if (!loginQuery) {
            return res.status(400).json({ error: 'Email, nickname, or username is required' });
        }

        const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginQuery);
        let user;

        if (isEmail) {
            user = await User.findOne({ email: loginQuery.toLowerCase() }).select('+passwordHash +passwordSalt');
        } else {
            const rawNick = loginQuery.replace(/^@/, '').trim();
            user = await User.findOne({
                $or: [
                    { nickname: { $regex: new RegExp(`^@?${rawNick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
                    { username: { $regex: new RegExp(`^${rawNick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
                    { email: loginQuery.toLowerCase() }
                ]
            }).select('+passwordHash +passwordSalt');
        }

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        if (user) {
            // User exists — verify password if protected
            if (user.passwordHash) {
                if (!password) {
                    return res.status(401).json({ error: 'Password is required for this account' });
                }
                const isValid = verifyPassword(password, user.passwordHash, user.passwordSalt);
                if (!isValid) {
                    return res.status(401).json({ error: 'Invalid email or password' });
                }
                // Guard: require email verification for local accounts
                if (user.authProvider === 'local' && !user.isVerified) {
                    return res.status(403).json({
                        error: 'Please verify your email before signing in.',
                        requiresVerification: true,
                        userId: user.userId,
                        email: user.email
                    });
                }
            } else if (password) {
                // If existing account had no password, set it securely now
                const { hash, salt } = hashPassword(password);
                user.passwordHash = hash;
                user.passwordSalt = salt;
            }

            // Streak tracking
            const lastActive = user.lastActiveAt ? new Date(user.lastActiveAt) : new Date();
            const diffDays   = Math.floor((today - lastActive) / (1000 * 60 * 60 * 24));

            if (diffDays === 1) {
                user.streak = (user.streak || 0) + 1;
            } else if (diffDays > 1) {
                user.streak = 1;
            }

            user.lastActiveAt = today;
            if (avatar) user.avatar = avatar;
            await checkAndAwardAchievements(user);
            await user.save();

            return res.json(formatUserPayload(user));
        }

        // If user not found and password was provided, account doesn't exist
        if (password) {
            return res.status(404).json({ error: 'No account found with these credentials. Please create an account.' });
        }

        // Frictionless Guest Fallback: Create account without password
        const validLevels = ['A1', 'A2', 'B1', 'B2', 'C1'];
        const userLevel   = validLevels.includes(level) ? level : 'A2';
        const cleanName   = loginQuery.slice(0, 30);
        const cleanNick   = cleanName.replace(/^@/, '');
        const userId      = 'u_' + randomBytes(6).toString('hex');

        user = new User({
            userId,
            username: cleanName,
            nickname: cleanNick,
            authProvider: 'guest',
            currentLevel: userLevel,
            avatar: avatar || '🇩🇪',
            streak: 1,
            lastActiveAt: today,
            xp: 0,
            dailyGoalMinutes: 15,
            dailyGoalXp: 30,
            selectedModel: process.env.OLLAMA_MODEL || '',
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

        res.json(formatUserPayload(user));

    } catch (err) {
        console.error('[auth] Login error:', err.message);
        res.status(500).json({ error: 'Login failed: ' + err.message });
    }
});

// POST /api/auth/social-login — Instant Google / Apple ID Authentication
router.post('/social-login', async (req, res) => {
    try {
        const { provider, email, name, avatar } = req.body;
        const validProviders = ['google', 'apple'];
        const activeProvider = validProviders.includes(provider) ? provider : 'google';

        const cleanEmail = (email || '').trim().toLowerCase();
        let user;

        if (cleanEmail) {
            user = await User.findOne({ email: cleanEmail });
        }

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        if (!user) {
            const rawNick = (name || cleanEmail.split('@')[0] || (activeProvider === 'google' ? 'GoogleUser' : 'AppleUser')).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20);
            const cleanNick = rawNick || ('user_' + randomBytes(3).toString('hex'));
            const cleanName = name || (activeProvider === 'google' ? 'Google Scholar' : 'Apple Scholar');
            const userId = 'u_' + randomBytes(6).toString('hex');

            user = new User({
                userId,
                username: cleanName,
                nickname: cleanNick,
                email: cleanEmail || `${cleanNick}@${activeProvider}.local`,
                authProvider: activeProvider,
                currentLevel: 'A2',
                avatar: avatar || (activeProvider === 'apple' ? '🍎' : '🦅'),
                streak: 1,
                lastActiveAt: today,
                xp: 50, // Welcome bonus
                dailyGoalMinutes: 15,
                dailyGoalXp: 30,
                selectedModel: process.env.OLLAMA_MODEL || '',
                theme: 'dark-glass',
                studyHistory: [{ date: todayStr, xp: 50, wordsLearned: 0, messagesSent: 0, essaysGraded: 0, minutesSpent: 0 }],
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
            // Update activity & streak
            const lastActive = user.lastActiveAt ? new Date(user.lastActiveAt) : new Date();
            const diffDays   = Math.floor((today - lastActive) / (1000 * 60 * 60 * 24));
            if (diffDays === 1) user.streak = (user.streak || 0) + 1;
            else if (diffDays > 1) user.streak = 1;

            user.lastActiveAt = today;
            if (user.authProvider === 'guest') user.authProvider = activeProvider;
            await checkAndAwardAchievements(user);
            await user.save();
        }

        res.json(formatUserPayload(user));
    } catch (err) {
        console.error('[auth] Social login error:', err.message);
        res.status(500).json({ error: 'Social authentication failed: ' + err.message });
    }
});

// POST /api/auth/update-profile — Update username, nickname, level, avatar & settings
router.post('/update-profile', async (req, res) => {
    try {
        const { userId, username, nickname, currentLevel, avatar, theme, dailyGoalXp, dailyGoalMinutes, ttsRate } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const user = await User.findOne({ userId });
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (username) user.username = username.trim().slice(0, 30);
        if (nickname) user.nickname = nickname.trim().replace(/^@/, '').slice(0, 30);
        if (avatar) user.avatar = avatar;
        if (currentLevel && ['A1', 'A2', 'B1', 'B2', 'C1'].includes(currentLevel)) {
            user.currentLevel = currentLevel;
        }
        if (theme) user.theme = theme;
        if (dailyGoalXp) user.dailyGoalXp = Number(dailyGoalXp);
        if (dailyGoalMinutes) user.dailyGoalMinutes = Number(dailyGoalMinutes);
        if (ttsRate) user.ttsRate = Number(ttsRate);

        await user.save();
        res.json(formatUserPayload(user));
    } catch (err) {
        console.error('[auth] Update profile error:', err.message);
        res.status(500).json({ error: 'Could not update profile: ' + err.message });
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
                nickname: 'learner',
                currentLevel: 'A2',
                streak: 1,
                xp: 0,
                avatar: '🇩🇪',
                theme: 'dark-glass',
                selectedModel: process.env.OLLAMA_MODEL || ''
            });
            await checkAndAwardAchievements(user);
            await user.save();
        }

        const payload = formatUserPayload(user);
        res.json({
            ...payload,
            averageEssayScore: user.averageEssayScore || 0,
            storiesRead:       user.storiesRead || 0,
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
        const { userId, username, nickname, avatar, currentLevel, dailyGoalMinutes, dailyGoalXp, selectedModel, theme, ttsVoice, ttsRate } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const updateFields = {};
        if (username)          updateFields.username = username.trim();
        if (nickname)          updateFields.nickname = nickname.trim().replace(/^@/, '');
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

        const rawNick = user.nickname || user.username || 'Learner';
        res.json({
            success: true,
            user: {
                userId:            user.userId,
                username:          user.username,
                nickname:          rawNick.startsWith('@') ? rawNick : `@${rawNick}`,
                email:             user.email || '',
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
