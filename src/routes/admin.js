import express from 'express';
import User from '../models/User.js';
import Vocabulary from '../models/Vocabulary.js';
import Conversation from '../models/Conversation.js';

const router = express.Router();

// ---- Admin secret middleware ----
// All admin routes require the X-Admin-Secret header matching ADMIN_SECRET in .env
function requireAdmin(req, res, next) {
    const secret = process.env.ADMIN_SECRET;
    if (!secret) {
        return res.status(503).json({ error: 'Admin API not enabled. Set ADMIN_SECRET in .env first.' });
    }
    if (req.headers['x-admin-secret'] !== secret) {
        return res.status(401).json({ error: 'Unauthorized. Invalid admin secret.' });
    }
    next();
}

router.use(requireAdmin);

// GET /api/admin/users — list all users (summary)
router.get('/users', async (_req, res) => {
    try {
        const users = await User.find({})
            .select('userId username nickname email authProvider currentLevel isVerified streak xp selectedModel createdAt lastActiveAt')
            .sort({ createdAt: -1 })
            .lean();

        res.json({
            total: users.length,
            users: users.map(u => ({
                userId:       u.userId,
                display:      `@${u.nickname || u.username}`,
                email:        u.email || '(none)',
                provider:     u.authProvider,
                level:        u.currentLevel,
                verified:     u.isVerified,
                xp:           u.xp,
                streak:       u.streak,
                model:        u.selectedModel || '(none)',
                joined:       u.createdAt,
                lastSeen:     u.lastActiveAt
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

// DELETE /api/admin/user/:query — delete user and all their data
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

        const userId = user.userId;

        // Cascade delete related data
        const [vocabDel, convDel] = await Promise.allSettled([
            Vocabulary.deleteMany({ userId }),
            Conversation.deleteMany({ userId })
        ]);
        await User.deleteOne({ _id: user._id });

        res.json({
            success: true,
            message: `User @${user.nickname || user.username} (${userId}) deleted`,
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

// POST /api/admin/user/:query/reset-password — force-set a user's password
router.post('/user/:query/reset-password', async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword) return res.status(400).json({ error: 'newPassword is required' });

        // Import hashPassword helper dynamically to avoid circular deps
        const { scryptSync, randomBytes } = await import('crypto');
        const salt = randomBytes(16).toString('hex');
        const hash = scryptSync(newPassword, salt, 64).toString('hex');

        const q = req.params.query.trim();
        const user = await User.findOneAndUpdate(
            { $or: [{ userId: q }, { email: q.toLowerCase() }, { nickname: q.replace(/^@/, '') }] },
            { $set: { passwordHash: hash, passwordSalt: salt, isVerified: true } },
            { new: true }
        );
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, message: `Password updated for @${user.nickname || user.username}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/user/:query/grant-xp — add XP to a user (testing/reward)
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
