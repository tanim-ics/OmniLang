import mongoose from 'mongoose';

const vocabBankSchema = new mongoose.Schema({
    word:        { type: String, required: true, unique: true, trim: true },
    translation: { type: String, required: true, trim: true },
    level:       { type: String, required: true, enum: ['A1', 'A2', 'B1'], index: true },
    type:        { type: String, default: 'word', enum: ['noun', 'verb', 'adjective', 'adverb', 'phrase', 'preposition', 'conjunction', 'word'], index: true },
    example:     { type: String, default: '' },
    exampleEn:   { type: String, default: '' },
    topic:       { type: String, default: 'General', index: true }
}, { timestamps: true });

// Compound index for level filtering and word lookups
vocabBankSchema.index({ level: 1, word: 1 });
// Text index for fast search queries
vocabBankSchema.index({ word: 'text', translation: 'text' });

export default mongoose.model('VocabBank', vocabBankSchema);
