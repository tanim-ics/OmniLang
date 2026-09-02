import express from 'express';
import User from '../models/User.js';
import Vocabulary from '../models/Vocabulary.js';
import Conversation from '../models/Conversation.js';

const router = express.Router();

// ---- Flexible Admin Authentication Middleware ----
// Accepts either:
// 1. Header 'X-Admin-Secret' matching ADMIN_SECRET in .env
// 2. Header 'X-User-Id' (or query userId) for an account with role 'admin' or 'superadmin'
async function requireAdmin(req, res, next) {
    const secret = process.env.ADMIN_SECRET;
    const headerSecret = req.headers['x-admin-secret'];

    // Path 1: Valid secret key
    if (secret && headerSecret && headerSecret === secret) {
        req.adminCaller = { role: 'superadmin', name: 'CLI / System Token' };
        return next();
    }

    // Path 2: User session authentication via X-User-Id or Authorization header
    const userIdHeader = req.headers['x-user-id'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    if (userIdHeader) {
        try {
            const caller = await User.findOne({ userId: userIdHeader });
            if (caller && (caller.role === 'admin' || caller.role === 'superadmin')) {
                req.adminCaller = caller;
                return next();
            }
        } catch (err) {
            console.warn('[admin] Auth check error:', err.message);
        }
    }

    return res.status(403).json({
        error: 'Access denied. Administrative privileges required.',
        code: 'FORBIDDEN'
    });
}

router.use(requireAdmin);

// GET /api/admin/me — verify caller identity and role
router.get('/me', async (req, res) => {
    res.json({
        authenticated: true,
        caller: {
            userId:   req.adminCaller.userId || 'system',
            nickname: req.adminCaller.nickname || 'System',
            role:     req.adminCaller.role || 'superadmin'
        }
    });
});

// GET /api/admin/stats — SaaS KPI metrics for executive overview
router.get('/stats', async (_req, res) => {
    try {
        const now = Date.now();
        const past24h = new Date(now - 24 * 60 * 60 * 1000);
        const past7d  = new Date(now - 7 * 24 * 60 * 60 * 1000);

        const [
            totalUsers,
            active24h,
            active7d,
            verifiedCount,
            adminCount,
            aggregates
        ] = await Promise.all([
            User.countDocuments({}),
            User.countDocuments({ lastActiveAt: { $gte: past24h } }),
            User.countDocuments({ lastActiveAt: { $gte: past7d } }),
            User.countDocuments({ isVerified: true }),
            User.countDocuments({ role: { $in: ['admin', 'superadmin'] } }),
            User.aggregate([
                {
                    $group: {
                        _id: null,
                        totalXp:       { $sum: '$xp' },
                        totalMessages: { $sum: '$totalMessages' },
                        totalEssays:   { $sum: '$essaysGraded' },
                        totalWords:    { $sum: '$totalWordsLearned' }
                    }
                }
            ])
        ]);

        const totals = aggregates[0] || { totalXp: 0, totalMessages: 0, totalEssays: 0, totalWords: 0 };

        // Level distribution
        const levelDistribution = await User.aggregate([
            { $group: { _id: '$currentLevel', count: { $sum: 1 } } }
        ]);

        // Provider distribution
        const providerDistribution = await User.aggregate([
            { $group: { _id: '$authProvider', count: { $sum: 1 } } }
        ]);

        const mem = process.memoryUsage();

        res.json({
            users: {
                total: totalUsers,
                active24h,
                active7d,
                verified: verifiedCount,
                unverified: Math.max(0, totalUsers - verifiedCount),
                admins: adminCount,
                verifiedRate: totalUsers > 0 ? Math.round((verifiedCount / totalUsers) * 100) : 100
            },
            learning: {
                totalXp: totals.totalXp || 0,
                totalMessages: totals.totalMessages || 0,
                totalEssays: totals.totalEssays || 0,
                totalWordsLearned: totals.totalWords || 0
            },
            distributions: {
                levels: levelDistribution.reduce((acc, curr) => ({ ...acc, [curr._id || 'A2']: curr.count }), {}),
                providers: providerDistribution.reduce((acc, curr) => ({ ...acc, [curr._id || 'local']: curr.count }), {})
            },
            system: {
                activeModel: process.env.OLLAMA_MODEL || '(not selected)',
                nodeVersion: process.version,
                uptimeSeconds: Math.floor(process.uptime()),
                memoryRssMb: Math.round(mem.rss / 1024 / 1024),
                memoryHeapMb: Math.round(mem.heapUsed / 1024 / 1024)
            }
        });
    } catch (err) {
        console.error('[admin] Stats error:', err.message);
        res.status(500).json({ error: 'Could not compute stats: ' + err.message });
    }
});

// GET /api/admin/users — list all users with sanitized fields (ZERO PASSWORDS)
router.get('/users', async (_req, res) => {
    try {
        const users = await User.find({})
            .select('userId username nickname email authProvider role currentLevel avatar isVerified streak xp totalWordsLearned totalMessages essaysGraded selectedModel createdAt lastActiveAt')
            .sort({ createdAt: -1 })
            .lean();

        res.json({
            total: users.length,
            users: users.map(u => ({
                userId:            u.userId,
                username:          u.username || 'Learner',
                nickname:          u.nickname ? `@${u.nickname.replace(/^@/, '')}` : `@${u.username || 'user'}`,
                rawNickname:       (u.nickname || u.username || 'user').replace(/^@/, ''),
                email:             u.email || '—',
                authProvider:      u.authProvider || 'local',
                role:              u.role || 'user',
                currentLevel:      u.currentLevel || 'A2',
                avatar:            u.avatar || '🇩🇪',
                isVerified:        Boolean(u.isVerified),
                streak:            u.streak || 0,
                xp:                u.xp || 0,
                totalWordsLearned: u.totalWordsLearned || 0,
                totalMessages:     u.totalMessages || 0,
                essaysGraded:      u.essaysGraded || 0,
                selectedModel:     u.selectedModel || '—',
                createdAt:         u.createdAt,
                lastActiveAt:      u.lastActiveAt
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/user/:query — find user by userId, email, or @nickname
router.get('/user/:query', async (req, res) => {
    try {
        const q = req.params.query.trim();
        const user = await User.findOne({
            $or: [
                { userId: q },
                { email: q.toLowerCase() },
                { nickname: q.replace(/^@/, '') }
            ]
        }).select('-passwordHash -passwordSalt -verificationCode -passwordResetCode');

        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/admin/user/:query — delete user and cascade data
router.delete('/user/:query', async (req, res) => {
    try {
        const q = req.params.query.trim();
        const user = await User.findOne({
            $or: [
                { userId: q },
                { email: q.toLowerCase() },
                { nickname: q.replace(/^@/, '') }
            ]
        });

        if (!user) return res.status(404).json({ error: 'User not found' });

        // Guard 1: Cannot delete superadmin account
        const cleanNick = (user.nickname || '').toLowerCase().replace(/^@/, '');
        if (cleanNick === 'tanim' || user.email === 'tanim.barca@gmail.com' || user.role === 'superadmin') {
            return res.status(403).json({ error: 'Protection rule: The Super Admin account cannot be deleted.' });
        }

        // Guard 2: Cannot delete oneself
        if (req.adminCaller?.userId && req.adminCaller.userId === user.userId) {
            return res.status(400).json({ error: 'You cannot delete your own active administrator account.' });
        }

        const targetUserId = user.userId;

        // Cascade delete user history, vocab, and conversations
        const [vocabDel, convDel] = await Promise.allSettled([
            Vocabulary.deleteMany({ userId: targetUserId }),
            Conversation.deleteMany({ userId: targetUserId })
        ]);
        await User.deleteOne({ _id: user._id });

        res.json({
            success: true,
            message: `User @${user.nickname || user.username} (${targetUserId}) permanently deleted`,
            deleted: {
                user: 1,
                vocabulary: vocabDel.value?.deletedCount ?? 0,
                conversations: convDel.value?.deletedCount ?? 0
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/user/:query/role — update user role (promote/demote)
router.post('/user/:query/role', async (req, res) => {
    try {
        const { role } = req.body;
        if (!['user', 'admin', 'superadmin'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role. Allowed roles: user, admin, superadmin' });
        }

        // Only superadmin can assign admin/superadmin roles
        if (req.adminCaller.role !== 'superadmin') {
            return res.status(403).json({ error: 'Only a Super Admin can change user roles.' });
        }

        const q = req.params.query.trim();
        const user = await User.findOne({
            $or: [{ userId: q }, { email: q.toLowerCase() }, { nickname: q.replace(/^@/, '') }]
        });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Cannot demote the primary superadmin tanim
        const cleanNick = (user.nickname || '').toLowerCase().replace(/^@/, '');
        if ((cleanNick === 'tanim' || user.email === 'tanim.barca@gmail.com') && role !== 'superadmin') {
            return res.status(403).json({ error: 'Cannot demote the primary Super Admin (@tanim).' });
        }

        user.role = role;
        await user.save();

        res.json({
            success: true,
            message: `Role for @${user.nickname || user.username} updated to ${role}`,
            user: { userId: user.userId, nickname: user.nickname, role: user.role }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/user/:query/verify — force-verify a user's email
router.post('/user/:query/verify', async (req, res) => {
    try {
        const q = req.params.query.trim();
        const user = await User.findOneAndUpdate(
            { $or: [{ userId: q }, { email: q.toLowerCase() }, { nickname: q.replace(/^@/, '') }] },
            { $set: { isVerified: true, verificationCode: undefined, verificationExpiry: undefined } },
            { new: true }
        );
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, message: `@${user.nickname || user.username} is now verified` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/user/:query/reset-password — force-reset a user's password (by admin/superadmin)
router.post('/user/:query/reset-password', async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        }

        const q = req.params.query.trim();
        const user = await User.findOne({
            $or: [{ userId: q }, { email: q.toLowerCase() }, { nickname: q.replace(/^@/, '') }]
        });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Non-superadmin cannot reset superadmin's password
        const cleanNick = (user.nickname || '').toLowerCase().replace(/^@/, '');
        if ((cleanNick === 'tanim' || user.role === 'superadmin') && req.adminCaller.role !== 'superadmin') {
            return res.status(403).json({ error: 'Only a Super Admin can reset the Super Admin password.' });
        }

        const { scryptSync, randomBytes } = await import('crypto');
        const salt = randomBytes(16).toString('hex');
        const hash = scryptSync(newPassword, salt, 64).toString('hex');

        user.passwordHash = hash;
        user.passwordSalt = salt;
        user.passwordResetCode = undefined;
        user.passwordResetExpiry = undefined;
        user.isVerified = true;
        await user.save();

        res.json({
            success: true,
            message: `Password successfully updated for @${user.nickname || user.username}`
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/user/:query/grant-xp — grant XP to a user
router.post('/user/:query/grant-xp', async (req, res) => {
    try {
        const { amount = 100 } = req.body;
        const q = req.params.query.trim();
        const user = await User.findOneAndUpdate(
            { $or: [{ userId: q }, { email: q.toLowerCase() }, { nickname: q.replace(/^@/, '') }] },
            { $inc: { xp: Number(amount) } },
            { new: true }
        );
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, message: `Granted ${amount} XP to @${user.nickname || user.username}. Total: ${user.xp} XP` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
