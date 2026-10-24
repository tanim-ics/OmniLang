#!/usr/bin/env node
/**
 * Force-reseed the VocabBank collection from src/data/vocabBank15k.json.
 * Usage: npm run reseed-bank
 * (The server also reseeds by itself on start whenever the data file changes.)
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { seedVocabBank } from '../src/utils/seedVocabBank.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/tanim_german';

try {
    await mongoose.connect(MONGO_URI);
    await seedVocabBank({ force: true });
} catch (err) {
    console.error('✗ Reseed failed:', err.message);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect();
}
