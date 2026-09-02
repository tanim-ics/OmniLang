import mongoose from 'mongoose';

// Stores user-added vocabulary items (from reading or manual add).
// Uses the Leitner SRS system: srsStage 1-5, per CLAUDE.md specification.
const vocabularySchema = new mongoose.Schema({
    userId:         { type: String, required: true, index: true },
    word:           { type: String, required: true, trim: true },
    translation:    { type: String, default: '' },
    example:        { type: String, default: '' },
    level:          { type: String, enum: ['A1', 'A2', 'B1', 'B2', 'C1'], default: 'A2' },
    // Leitner progression index — integer scale 1 through 5 (per CLAUDE.md)
    srsStage:       { type: Number, default: 1, min: 1, max: 5 },
    nextReviewDate: { type: Date,   default: Date.now },
    lastReviewedAt: { type: Date },
    correctCount:   { type: Number, default: 0 },
    incorrectCount: { type: Number, default: 0 },
    addedFrom:      { type: String, enum: ['reading', 'manual'], default: 'manual' },
    sourceText:     { type: String, default: '' }
}, { timestamps: true });

// Efficient SRS query index
vocabularySchema.index({ userId: 1, nextReviewDate: 1 });

export default mongoose.model('Vocabulary', vocabularySchema);
