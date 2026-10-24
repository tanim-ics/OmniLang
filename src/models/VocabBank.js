import mongoose from 'mongoose';

const vocabBankSchema = new mongoose.Schema({
    word:        { type: String, required: true, unique: true, trim: true },
    translation: { type: String, required: true, trim: true },
    // A1-B1 follow the Goethe-Institut word lists; B2 holds everything beyond them ("B2+")
    level:       { type: String, required: true, enum: ['A1', 'A2', 'B1', 'B2'], index: true },
    type:        { type: String, default: 'word', enum: ['noun', 'verb', 'adjective', 'adverb', 'phrase', 'preposition', 'conjunction', 'word'], index: true },
    plural:      { type: String, default: '' },
    example:     { type: String, default: '' },
    exampleEn:   { type: String, default: '' },
    topic:       { type: String, default: 'General', index: true }
}, { timestamps: true });

// Compound index for level filtering and word lookups
vocabBankSchema.index({ level: 1, word: 1 });
// Text index for fast search queries
vocabBankSchema.index({ word: 'text', translation: 'text' });

export default mongoose.model('VocabBank', vocabBankSchema);
