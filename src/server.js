import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import authRouter       from './routes/auth.js';
import chatRouter       from './routes/chat.js';
import vocabularyRouter from './routes/vocabulary.js';
import readingRouter    from './routes/reading.js';
import essayRouter      from './routes/essay.js';
import coachRouter      from './routes/coach.js';
import settingsRouter   from './routes/settings.js';
import adminRouter      from './routes/admin.js';
import { ensureOllamaRunning, preloadModel } from './utils/ollamaManager.js';
import { seedVocabBank } from './utils/seedVocabBank.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app       = express();
const PORT      = process.env.PORT      || 5001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/tanim_german';
const ACTIVE_MODEL = process.env.OLLAMA_MODEL || '';

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
app.use('/api/admin',      adminRouter);

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

        // Seed the Vocabulary Bank; reseeds automatically when src/data/vocabBank15k.json changes
        try {
            await seedVocabBank();
        } catch (err) {
            console.error('Warning: VocabBank seeding notice:', err.message);
        }

        // 1. Ensure Ollama server daemon is running (graceful fallback if not installed)
        await ensureOllamaRunning().catch(err => console.warn('⚠️ Ollama check notice:', err.message));

        // 2. Pre-warm the configured active model into memory (only if a model is set)
        if (ACTIVE_MODEL) {
            preloadModel(ACTIVE_MODEL).catch(() => {});
        } else {
            console.log('ℹ️  No default Ollama model configured — select one via the app onboarding or set OLLAMA_MODEL in .env');
        }

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
