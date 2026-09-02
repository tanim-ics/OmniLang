import mongoose from 'mongoose';

const srsProgressSchema = new mongoose.Schema({
    wordId:      { type: String, required: true },
    srsStage:    { type: Number, default: 1, min: 1, max: 5 },
    interval:    { type: Number, default: 1 },
    easeFactor:  { type: Number, default: 2.5 },
    dueDate:     { type: Date,   default: Date.now },
    repetitions: { type: Number, default: 0 }
}, { _id: false });

const levelProgressSchema = new mongoose.Schema({
    wordsLearned:  { type: Number, default: 0 },
    sessionsCount: { type: Number, default: 0 },
    writingScore:  { type: Number, default: 0 },
    readingCount:  { type: Number, default: 0 }
}, { _id: false });

const studyHistorySchema = new mongoose.Schema({
    date:          { type: String, required: true }, // Format: YYYY-MM-DD
    xp:            { type: Number, default: 0 },
    wordsLearned:  { type: Number, default: 0 },
    messagesSent:  { type: Number, default: 0 },
    essaysGraded:  { type: Number, default: 0 },
    minutesSpent:  { type: Number, default: 0 }
}, { _id: false });

const mistakeSchema = new mongoose.Schema({
    error:     { type: String, required: true },
    fix:       { type: String, default: '' },
    rule:      { type: String, default: '' },
    source:    { type: String, enum: ['essay', 'chat', 'speaking'], default: 'essay' },
    timestamp: { type: Date,   default: Date.now }
}, { _id: false });

const achievementSchema = new mongoose.Schema({
    id:          { type: String, required: true },
    title:       { type: String, required: true },
    description: { type: String, required: true },
    icon:        { type: String, required: true },
    tier:        { type: String, enum: ['bronze', 'silver', 'gold', 'diamond'], default: 'bronze' },
    category:    { type: String, default: 'general' },
    xpReward:    { type: Number, default: 25 },
    unlockedAt:  { type: Date,   default: Date.now }
}, { _id: false });

const dailyModuleStatusSchema = new mongoose.Schema({
    date:                     { type: String, required: true }, // Format: YYYY-MM-DD
    vocabCompleted:           { type: Boolean, default: false },
    vocabCount:               { type: Number,  default: 0 },
    chatCompleted:            { type: Boolean, default: false },
    chatCount:                { type: Number,  default: 0 },
    speakingCompleted:        { type: Boolean, default: false },
    speakingCount:            { type: Number,  default: 0 },
    writingCompleted:         { type: Boolean, default: false },
    writingCount:             { type: Number,  default: 0 },
    readingCompleted:         { type: Boolean, default: false },
    readingCount:             { type: Number,  default: 0 },
    allCompletedBonusAwarded: { type: Boolean, default: false }
}, { _id: false });

const userSchema = new mongoose.Schema({
    userId:       { type: String, required: true, unique: true, index: true },
    username:     { type: String, default: 'Learner', trim: true },
    nickname:     { type: String, trim: true, default: '' },
    email:        { type: String, trim: true, lowercase: true, sparse: true, index: true },
    passwordHash: { type: String, select: false },
    passwordSalt: { type: String, select: false },
    authProvider: { type: String, enum: ['local', 'google', 'apple'], default: 'local' },
    role:         { type: String, enum: ['user', 'admin', 'superadmin'], default: 'user', index: true },
    // Email verification
    isVerified:          { type: Boolean, default: false },
    verificationCode:    { type: String, select: false },
    verificationExpiry:  { type: Date, select: false },
    // Password reset
    passwordResetCode:   { type: String, select: false },
    passwordResetExpiry: { type: Date, select: false },
    currentLevel: {
        type: String,
        enum: ['A1', 'A2', 'B1', 'B2', 'C1'],
        default: 'A2',
        required: true
    },
    avatar:            { type: String, default: '🇩🇪' },
    streak:            { type: Number, default: 0 },
    lastActiveAt:      { type: Date,   default: Date.now },
    xp:                { type: Number, default: 0 },
    totalWordsLearned: { type: Number, default: 0 },
    totalMessages:     { type: Number, default: 0 },
    essaysGraded:      { type: Number, default: 0 },
    averageEssayScore: { type: Number, default: 0 },
    storiesRead:       { type: Number, default: 0 },
    
    // User Settings & Preferences
    dailyGoalMinutes:  { type: Number, default: 15 },
    dailyGoalXp:       { type: Number, default: 30 },
    selectedModel:     { type: String, default: '' },
    theme:             { type: String, default: 'dark-glass' },
    ttsVoice:          { type: String, default: 'de-DE' },
    ttsRate:           { type: Number, default: 0.95 },

    completedModules:  [{ type: String }],
    progressByLevel: {
        A1: { type: levelProgressSchema, default: () => ({}) },
        A2: { type: levelProgressSchema, default: () => ({}) },
        B1: { type: levelProgressSchema, default: () => ({}) },
        B2: { type: levelProgressSchema, default: () => ({}) },
        C1: { type: levelProgressSchema, default: () => ({}) }
    },
    srsProgress:   [srsProgressSchema],
    studyHistory:  [studyHistorySchema],
    recentMistakes:   [mistakeSchema],
    achievements:     [achievementSchema],
    dailyModuleStatus:[dailyModuleStatusSchema]
}, { timestamps: true });

export default mongoose.model('User', userSchema);
