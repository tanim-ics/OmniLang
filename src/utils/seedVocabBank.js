import mongoose from 'mongoose';
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import VocabBank from '../models/VocabBank.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BANK_DATA_PATH = join(__dirname, '../data/vocabBank15k.json');

const META_COLLECTION = 'appmeta';
const META_ID = 'vocabBank';

/**
 * Seeds the VocabBank collection from src/data/vocabBank15k.json.
 * The file's SHA-1 is stored as a version marker, so an edited data file
 * replaces the collection on the next start. `force` reseeds regardless.
 */
export async function seedVocabBank({ force = false, log = console.log } = {}) {
    if (!existsSync(BANK_DATA_PATH)) {
        log('⚠️ VocabBank data file missing, skipping seed');
        return { seeded: false };
    }
    const raw = readFileSync(BANK_DATA_PATH, 'utf-8');
    const version = createHash('sha1').update(raw).digest('hex');
    const meta = mongoose.connection.db.collection(META_COLLECTION);
    const current = await meta.findOne({ _id: META_ID });
    const count = await VocabBank.countDocuments();

    if (!force && current?.version === version && count > 0) {
        log(`✓ Vocabulary Bank ready in MongoDB (${count} words)`);
        return { seeded: false, count };
    }

    const words = JSON.parse(raw);
    log(`⏳ Seeding Vocabulary Bank into MongoDB (${words.length} words, replacing ${count})...`);
    await VocabBank.deleteMany({});
    const batchSize = 2500;
    for (let i = 0; i < words.length; i += batchSize) {
        await VocabBank.insertMany(words.slice(i, i + batchSize), { ordered: false });
    }
    const newCount = await VocabBank.countDocuments();
    await meta.updateOne(
        { _id: META_ID },
        { $set: { version, count: newCount, seededAt: new Date() } },
        { upsert: true }
    );
    log(`✓ Vocabulary Bank ready in MongoDB (${newCount} words, version ${version.slice(0, 8)})`);
    return { seeded: true, count: newCount };
}
