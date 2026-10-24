// =========================================================
// OmniLang Game Engine — single source of truth for XP, player
// levels, streaks, daily quests and achievement unlocks.
// Every route that rewards the learner calls awardActivity() and
// returns its `progress` snapshot so the client can animate it.
// =========================================================
import { checkAndAwardAchievements, getOrCreateDailyStatus } from '../routes/auth.js';

// ---- Local calendar helpers (UTC dates flip at the wrong hour outside GMT) ----
export function localDateStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function daysBetween(fromStr, toStr) {
    if (!fromStr || !toStr) return Infinity;
    const [y1, m1, d1] = fromStr.split('-').map(Number);
    const [y2, m2, d2] = toStr.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// ---- Player level curve: total XP needed to reach level L ----
// L2 = 75, L3 = 200, L5 = 600, L10 = 2 475, L20 = 10 975
export function xpForLevel(level) {
    const n = Math.max(0, level - 1);
    return 50 * n + 25 * n * n;
}

const LEVEL_TITLES = [
    { from: 1,  title: 'Sprach-Neuling',        icon: '🌱' },
    { from: 3,  title: 'Wort-Entdecker',        icon: '🧭' },
    { from: 5,  title: 'Satz-Baumeister',       icon: '🔨' },
    { from: 8,  title: 'Konversations-Pionier', icon: '🎙️' },
    { from: 11, title: 'Grammatik-Meister',     icon: '📜' },
    { from: 15, title: 'Schwarzwald-Gelehrter', icon: '🌲' },
    { from: 20, title: 'Goethe-Gefährte',       icon: '🏛️' },
    { from: 30, title: 'Sprachlegende',         icon: '👑' }
];

export function levelInfo(xp = 0) {
    let level = 1;
    while (xp >= xpForLevel(level + 1)) level++;
    const floor = xpForLevel(level);
    const ceil  = xpForLevel(level + 1);
    const band  = [...LEVEL_TITLES].reverse().find(t => level >= t.from) || LEVEL_TITLES[0];
    return {
        level,
        title: band.title,
        icon: band.icon,
        xpIntoLevel: xp - floor,
        xpForNext: ceil - floor,
        pct: Math.round(((xp - floor) / (ceil - floor)) * 100)
    };
}

// ---- Activity reward table ----
// quest: which daily quest the activity counts toward, and the count that completes it.
const ACTIVITIES = {
    vocab_correct:  { xp: 2,  label: 'Karte gewusst',      quest: 'vocab',    target: 10, minutes: 0.5, words: 1 },
    vocab_wrong:    { xp: 1,  label: 'Karte geübt',        quest: 'vocab',    target: 10, minutes: 0.5 },
    word_added:     { xp: 3,  label: 'Neues Wort',          minutes: 0.5, words: 1 },
    chat_message:   { xp: 3,  label: 'Nachricht',           quest: 'chat',     target: 5,  minutes: 1, messages: 1 },
    chat_perfect:   { xp: 2,  label: 'Fehlerfrei!' },
    speaking_turn:  { xp: 5,  label: 'Gesprochen',          quest: 'speaking', target: 3,  minutes: 1, messages: 1 },
    chat_completed: { xp: 10, label: 'Gespräch beendet' },
    essay_graded:   { xp: 0,  label: 'Aufsatz bewertet',    quest: 'writing',  target: 1,  minutes: 5, essays: 1 },
    story_read:     { xp: 10, label: 'Geschichte gelesen',  quest: 'reading',  target: 1,  minutes: 3 },
    story_quiz:     { xp: 0,  label: 'Quiz',                minutes: 1 }
};

export const QUEST_TARGETS = Object.fromEntries(
    Object.values(ACTIVITIES).filter(a => a.quest).map(a => [a.quest, a.target])
);
const QUEST_IDS = ['vocab', 'chat', 'speaking', 'writing', 'reading'];
const QUEST_XP = 10;
const ALL_QUESTS_XP = 50;
const COMBO_STEP = 5;      // every 5 correct in a row…
const COMBO_BONUS_MAX = 3; // …adds +1 XP, capped at +3

/**
 * Keep the streak honest without extending it. Called on login/profile load:
 * if a day was missed, burn a streak freeze or reset to 0.
 */
export function refreshStreak(user, today = localDateStr()) {
    const gap = daysBetween(user.lastStudyDate, today);
    if (gap <= 1) return false;
    if (gap === 2 && (user.streakFreezes || 0) > 0) {
        user.streakFreezes -= 1;
        // Pretend yesterday was studied so today's practice continues the chain.
        const y = new Date(); y.setDate(y.getDate() - 1);
        user.lastStudyDate = localDateStr(y);
        return true;
    }
    if (user.lastStudyDate) user.streak = 0;
    return false;
}

function extendStreak(user, today) {
    const gap = daysBetween(user.lastStudyDate, today);
    if (gap === 0) return false;
    refreshStreak(user, today);
    const gapAfter = daysBetween(user.lastStudyDate, today);
    user.streak = gapAfter === 1 ? (user.streak || 0) + 1 : 1;
    user.lastStudyDate = today;
    // Every 7-day milestone earns a streak freeze (max 2 banked).
    if (user.streak % 7 === 0) user.streakFreezes = Math.min(2, (user.streakFreezes || 0) + 1);
    return true;
}

/**
 * Award an activity to a user document (mutates, does not save).
 * @param {object} opts { xp: override base xp, combo: current correct streak, bonus: [{label, xp}] }
 * @returns progress snapshot for the client
 */
export async function awardActivity(user, activity, opts = {}) {
    const spec = ACTIVITIES[activity];
    if (!spec) throw new Error(`Unknown activity "${activity}"`);

    const today = localDateStr();
    const before = levelInfo(user.xp || 0);
    const breakdown = [];

    const baseXp = opts.xp ?? spec.xp;
    if (baseXp > 0) breakdown.push({ label: spec.label, xp: baseXp });
    if (opts.combo && opts.combo >= COMBO_STEP) {
        const comboXp = Math.min(COMBO_BONUS_MAX, Math.floor(opts.combo / COMBO_STEP));
        breakdown.push({ label: `Combo ×${opts.combo}`, xp: comboXp });
    }
    (opts.bonus || []).forEach(b => b.xp > 0 && breakdown.push(b));

    // Streak
    const streakExtended = extendStreak(user, today);

    // Daily quests
    const daily = getOrCreateDailyStatus(user, today);
    const questsCompleted = [];
    if (spec.quest) {
        const countKey = `${spec.quest}Count`;
        const doneKey  = `${spec.quest}Completed`;
        daily[countKey] = (daily[countKey] || 0) + 1;
        if (!daily[doneKey] && daily[countKey] >= spec.target) {
            daily[doneKey] = true;
            questsCompleted.push(spec.quest);
            breakdown.push({ label: 'Quest erfüllt', xp: QUEST_XP });
        }
    }
    let allQuestsDone = false;
    if (!daily.allCompletedBonusAwarded && QUEST_IDS.every(q => daily[`${q}Completed`])) {
        daily.allCompletedBonusAwarded = true;
        allQuestsDone = true;
        breakdown.push({ label: 'Alle Quests!', xp: ALL_QUESTS_XP });
    }

    const gained = breakdown.reduce((s, b) => s + b.xp, 0);
    user.xp = (user.xp || 0) + gained;
    user.lastActiveAt = new Date();

    // Study history (drives heatmap + charts)
    if (!user.studyHistory) user.studyHistory = [];
    let hist = user.studyHistory.find(h => h.date === today);
    if (!hist) {
        user.studyHistory.push({ date: today, xp: 0, wordsLearned: 0, messagesSent: 0, essaysGraded: 0, minutesSpent: 0 });
        hist = user.studyHistory[user.studyHistory.length - 1];
    }
    hist.xp += gained;
    hist.wordsLearned += spec.words || 0;
    hist.messagesSent += spec.messages || 0;
    hist.essaysGraded += spec.essays || 0;
    hist.minutesSpent = Math.round(((hist.minutesSpent || 0) + (spec.minutes || 0)) * 10) / 10;
    if (user.studyHistory.length > 400) user.studyHistory = user.studyHistory.slice(-400);
    if (user.dailyModuleStatus?.length > 30) user.dailyModuleStatus = user.dailyModuleStatus.slice(-30);

    // Achievements (they grant their own bonus XP)
    const known = new Set((user.achievements || []).map(a => a.id));
    const xpBeforeAch = user.xp;
    await checkAndAwardAchievements(user);
    const unlocked = (user.achievements || []).filter(a => !known.has(a.id)).map(a => ({
        id: a.id, title: a.title, description: a.description, icon: a.icon, tier: a.tier, xpReward: a.xpReward
    }));

    user.markModified('dailyModuleStatus');
    user.markModified('studyHistory');

    const after = levelInfo(user.xp);
    return {
        xp: user.xp,
        xpGained: gained + (user.xp - xpBeforeAch),
        breakdown,
        level: after,
        levelUp: after.level > before.level,
        achievements: unlocked,
        questsCompleted,
        allQuestsDone,
        streak: user.streak || 0,
        streakExtended,
        streakFreezes: user.streakFreezes || 0,
        totalWordsLearned: user.totalWordsLearned || 0,
        todayXp: hist.xp,
        dailyGoalXp: user.dailyGoalXp || 30
    };
}
