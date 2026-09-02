#!/usr/bin/env node
/**
 * OmniLang Developer Admin CLI
 * ─────────────────────────────
 * Usage:
 *   node scripts/admin.mjs list
 *   node scripts/admin.mjs find <email|@nickname|userId>
 *   node scripts/admin.mjs delete <email|@nickname|userId>
 *   node scripts/admin.mjs verify <email|@nickname|userId>
 *   node scripts/admin.mjs setpw <email|@nickname|userId> <newPassword>
 *   node scripts/admin.mjs grantxp <email|@nickname|userId> [amount]
 *
 * Requires ADMIN_SECRET to be set in .env (and matching --secret flag or env).
 */

import 'dotenv/config';
import mongoose from 'mongoose';

// ---- Colors ----
const C = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    red:    '\x1b[31m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
    cyan:   '\x1b[36m',
    dim:    '\x1b[2m',
    magenta:'\x1b[35m',
};
const c = (color, str) => `${C[color]}${str}${C.reset}`;

// ---- Minimal User model (inline to avoid ESM circular issues) ----
const userSchema = new mongoose.Schema({
    userId:       String,
    username:     String,
    nickname:     String,
    email:        String,
    authProvider: String,
    isVerified:   Boolean,
    currentLevel: String,
    xp:           Number,
    streak:       Number,
    selectedModel:String,
    passwordHash: { type: String, select: false },
    passwordSalt: { type: String, select: false },
    totalMessages:Number,
    essaysGraded: Number,
    createdAt:    Date,
    lastActiveAt: Date,
}, { timestamps: true });
const User = mongoose.models.User || mongoose.model('User', userSchema);

const vocabSchema = new mongoose.Schema({ userId: String });
const Vocabulary = mongoose.models.Vocabulary || mongoose.model('Vocabulary', vocabSchema);

const convSchema = new mongoose.Schema({ userId: String });
const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', convSchema);

// ---- Query helper ----
async function findUser(query) {
    const q = query.trim();
    return User.findOne({
        $or: [
            { userId: q },
            { email: q.toLowerCase() },
            { nickname: q.replace(/^@/, '') }
        ]
    }).select('+passwordHash +passwordSalt');
}

// ---- Commands ----
async function cmdList() {
    const users = await User.find({})
        .sort({ createdAt: -1 })
        .select('userId nickname username email authProvider currentLevel isVerified xp streak selectedModel createdAt lastActiveAt');

    console.log(`\n${c('bold', 'OmniLang Users')} ${c('dim', `(${users.length} total)`)}\n`);
    console.log(c('dim', '─'.repeat(100)));

    const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);

    console.log(c('bold',
        pad('Handle', 20) + pad('Email', 28) + pad('Provider', 10) +
        pad('Level', 7) + pad('XP', 7) + pad('✓', 4) + pad('Model', 20) + 'Joined'
    ));
    console.log(c('dim', '─'.repeat(100)));

    for (const u of users) {
        const handle   = `@${u.nickname || u.username}`;
        const verified = u.isVerified ? c('green', '✓') : c('yellow', '✗');
        const joined   = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '?';
        console.log(
            c('cyan', pad(handle, 20)) +
            pad(u.email || '—', 28) +
            pad(u.authProvider || 'local', 10) +
            pad(u.currentLevel || 'A2', 7) +
            pad(u.xp ?? 0, 7) +
            verified + '   ' +
            c('dim', pad(u.selectedModel || '(none)', 20)) +
            c('dim', joined)
        );
    }
    console.log(c('dim', '─'.repeat(100)) + '\n');
}

async function cmdFind(query) {
    const user = await findUser(query);
    if (!user) { console.log(c('red', `  ✗ No user found for: ${query}`)); return; }

    console.log(`\n${c('bold', '── User Profile ─────────────────────────────')}`);
    const fields = [
        ['userId',     user.userId],
        ['Handle',     `@${user.nickname || user.username}`],
        ['Username',   user.username],
        ['Email',      user.email || '(none)'],
        ['Provider',   user.authProvider],
        ['Verified',   user.isVerified ? c('green','✓ Yes') : c('yellow','✗ No')],
        ['Level',      user.currentLevel],
        ['XP',         user.xp ?? 0],
        ['Streak',     `${user.streak ?? 0} days`],
        ['Model',      user.selectedModel || '(none)'],
        ['Messages',   user.totalMessages ?? 0],
        ['Essays',     user.essaysGraded ?? 0],
        ['Joined',     user.createdAt ? new Date(user.createdAt).toLocaleString() : '?'],
        ['Last seen',  user.lastActiveAt ? new Date(user.lastActiveAt).toLocaleString() : '?'],
    ];
    for (const [k, v] of fields) {
        console.log(`  ${c('cyan', k.padEnd(12))} ${v}`);
    }
    console.log();
}

async function cmdDelete(query) {
    const user = await findUser(query);
    if (!user) { console.log(c('red', `  ✗ No user found for: ${query}`)); return; }

    const handle = `@${user.nickname || user.username}`;
    console.log(`\n  ${c('yellow', '⚠️  About to permanently delete:')} ${c('bold', handle)} (${user.email || user.userId})`);
    console.log(c('dim', '  Press Ctrl+C within 3 seconds to abort…\n'));

    await new Promise(r => setTimeout(r, 3000));

    const [v, c2] = await Promise.allSettled([
        Vocabulary.deleteMany({ userId: user.userId }),
        Conversation.deleteMany({ userId: user.userId }),
    ]);
    await User.deleteOne({ _id: user._id });

    console.log(c('green', `\n  ✓ Deleted ${handle}`));
    console.log(c('dim', `    Vocabulary entries:  ${v.value?.deletedCount ?? 0}`));
    console.log(c('dim', `    Conversations:       ${c2.value?.deletedCount ?? 0}\n`));
}

async function cmdVerify(query) {
    const user = await findUser(query);
    if (!user) { console.log(c('red', `  ✗ No user found for: ${query}`)); return; }

    user.isVerified = true;
    user.verificationCode = undefined;
    user.verificationExpiry = undefined;
    await user.save();

    console.log(c('green', `\n  ✓ @${user.nickname || user.username} is now verified\n`));
}

async function cmdSetPassword(query, newPassword) {
    if (!newPassword) { console.log(c('red', '  ✗ newPassword argument is required')); return; }

    const { scryptSync, randomBytes } = await import('crypto');
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(newPassword, salt, 64).toString('hex');

    const user = await findUser(query);
    if (!user) { console.log(c('red', `  ✗ No user found for: ${query}`)); return; }

    user.passwordHash = hash;
    user.passwordSalt = salt;
    user.isVerified   = true;
    await user.save();

    console.log(c('green', `\n  ✓ Password updated for @${user.nickname || user.username}\n`));
}

async function cmdGrantXp(query, amount = 100) {
    const user = await findUser(query);
    if (!user) { console.log(c('red', `  ✗ No user found for: ${query}`)); return; }

    user.xp = (user.xp || 0) + Number(amount);
    await user.save();

    console.log(c('green', `\n  ✓ Granted ${amount} XP to @${user.nickname || user.username}. Total: ${user.xp} XP\n`));
}

// ---- Main ----
const [,, cmd, arg1, arg2] = process.argv;

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/tanim_german';

function printHelp() {
    console.log(`
${c('bold', '🛠  OmniLang Admin CLI')}

${c('cyan', 'Usage:')}
  node scripts/admin.mjs ${c('yellow', 'list')}
  node scripts/admin.mjs ${c('yellow', 'find')}    <email | @nickname | userId>
  node scripts/admin.mjs ${c('yellow', 'delete')}  <email | @nickname | userId>
  node scripts/admin.mjs ${c('yellow', 'verify')}  <email | @nickname | userId>
  node scripts/admin.mjs ${c('yellow', 'setpw')}   <email | @nickname | userId> <newPassword>
  node scripts/admin.mjs ${c('yellow', 'grantxp')} <email | @nickname | userId> [amount=100]

${c('dim', 'Examples:')}
  node scripts/admin.mjs list
  node scripts/admin.mjs find tanim.barca@gmail.com
  node scripts/admin.mjs delete @tanim
  node scripts/admin.mjs verify u_abc123
  node scripts/admin.mjs setpw @tanim NewPass@2025
  node scripts/admin.mjs grantxp @tanim 500
`);
}

if (!cmd || cmd === 'help') {
    printHelp();
    process.exit(0);
}

(async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log(c('dim', `  Connected to MongoDB: ${MONGO_URI}`));

        switch (cmd) {
            case 'list':    await cmdList();                   break;
            case 'find':    await cmdFind(arg1);               break;
            case 'delete':  await cmdDelete(arg1);             break;
            case 'verify':  await cmdVerify(arg1);             break;
            case 'setpw':   await cmdSetPassword(arg1, arg2);  break;
            case 'grantxp': await cmdGrantXp(arg1, arg2);     break;
            default:
                console.log(c('red', `  ✗ Unknown command: ${cmd}`));
                printHelp();
        }
    } catch (err) {
        console.error(c('red', `\n  ✗ Error: ${err.message}\n`));
    } finally {
        await mongoose.disconnect();
    }
})();
