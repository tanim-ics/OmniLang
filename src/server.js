import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { readFileSync, existsSync } from 'fs';
import VocabBank        from './models/VocabBank.js';
import authRouter       from './routes/auth.js';
import chatRouter       from './routes/chat.js';
import vocabularyRouter from './routes/vocabulary.js';
import readingRouter    from './routes/reading.js';
import essayRouter      from './routes/essay.js';
import coachRouter      from './routes/coach.js';
import settingsRouter   from './routes/settings.js';
import { ensureOllamaRunning, preloadModel } from './utils/ollamaManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app       = express();
const PORT      = process.env.PORT      || 5001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/tanim_german';
const ACTIVE_MODEL = process.env.OLLAMA_MODEL || 'mistral-nemo:12b';

const allowedOrigins = process.env.OLLAMA_ORIGINS || '*';
app.use(cors({ origin: allowedOrigins === '*' ? '*' : allowedOrigins.split(',') }));
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// Routes
app.use('/api/auth',       authRouter);
app.use('/api/chat',       chatRouter);
app.use('/api/vocabulary', vocabularyRouter);
app.use('/api/reading',    readingRouter);
app.use('/api/essay',      essayRouter);
app.use('/api/coach',      coachRouter);
app.use('/api/settings',   settingsRouter);

app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        port: PORT,
        activeModel: process.env.OLLAMA_MODEL || ACTIVE_MODEL,
        timestamp: new Date().toISOString(),
        mongoStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

function shutdown(server, signal) {
    console.log(`\n[${signal}] Shutting down gracefully…`);
    server.close(() => {
        mongoose.connection.close(false).then(() => {
            console.log('✓ Connections closed');
            process.exit(0);
        });
    });
    setTimeout(() => process.exit(1), 5000).unref();
}

mongoose
    .connect(MONGO_URI)
    .then(async () => {
        console.log('✓ MongoDB connected successfully');

        // Auto-seed 15,000-word Vocabulary Bank into MongoDB if needed
        try {
            const count = await VocabBank.countDocuments();
            if (count < 15000) {
                const dataPath = join(__dirname, 'data/vocabBank15k.json');
                if (existsSync(dataPath)) {
                    console.log(`⏳ Seeding 15,000-word Vocabulary Bank into MongoDB (current: ${count})...`);
                    const words = JSON.parse(readFileSync(dataPath, 'utf-8'));
                    const batchSize = 2500;
                    for (let i = 0; i < words.length; i += batchSize) {
                        const chunk = words.slice(i, i + batchSize);
                        await VocabBank.insertMany(chunk, { ordered: false }).catch(() => {});
                    }
                    const newCount = await VocabBank.countDocuments();
                    console.log(`✓ 15,000-word Vocabulary Bank ready in MongoDB (${newCount} words)!`);
                }
            } else {
                console.log(`✓ 15,000-word Vocabulary Bank ready in MongoDB (${count} words)`);
            }
        } catch (err) {
            console.error('Warning: VocabBank seeding notice:', err.message);
        }

        // 1. Ensure Ollama server daemon is running
        await ensureOllamaRunning();

        // 2. Pre-warm the configured active model into memory
        preloadModel(ACTIVE_MODEL).catch(() => {});

        const server = app.listen(PORT, () =>
            console.log(`✓ OmniLang German Learning Platform running → http://localhost:${PORT}`)
        );
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`✗ Port ${PORT} in use. Kill the old process (lsof -ti:${PORT} | xargs kill) or change PORT in .env`);
            } else {
                console.error('✗ Server error:', err.message);
            }
            process.exit(1);
        });
        process.on('SIGINT',  () => shutdown(server, 'SIGINT'));
        process.on('SIGTERM', () => shutdown(server, 'SIGTERM'));
        process.once('SIGUSR2', () => {
            server.close(() => {
                mongoose.connection.close(false).then(() => process.kill(process.pid, 'SIGUSR2'));
            });
        });
    })
    .catch(err => {
        console.error('✗ MongoDB connection failed:', err.message);
        process.exit(1);
    });
