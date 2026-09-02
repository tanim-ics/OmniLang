import express from 'express';
import User from '../models/User.js';
import { updateEnvModel, preloadModel, isOllamaReachable, ensureOllamaRunning } from '../utils/ollamaManager.js';

const router = express.Router();
const OLLAMA_TAGS_ENDPOINT = 'http://localhost:11434/api/tags';
const OLLAMA_CHAT_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434/api/chat';

// GET /api/settings/models — list all available models installed in local Ollama
router.get('/models', async (_req, res) => {
    try {
        const reachable = await isOllamaReachable();
        if (!reachable) {
            await ensureOllamaRunning();
        }

        const response = await fetch(OLLAMA_TAGS_ENDPOINT, { signal: AbortSignal.timeout(3000) });
        if (!response.ok) {
            return res.json({
                models: [
                    { name: 'mistral-nemo:12b', size: '12.2B', details: { family: 'llama' } },
                    { name: 'qwen3.5:9b', size: '9.7B', details: { family: 'qwen35' } },
                    { name: 'llama3.2:3b', size: '3.2B', details: { family: 'llama' } }
                ],
                connected: false,
                currentDefault: process.env.OLLAMA_MODEL || 'mistral-nemo:12b'
            });
        }

        const data = await response.json();
        const models = (data.models || []).map(m => ({
            name: m.name,
            size: m.details?.parameter_size || `${(m.size / (1024 * 1024 * 1024)).toFixed(1)} GB`,
            family: m.details?.family || 'llm',
            quantization: m.details?.quantization_level || 'standard',
            modifiedAt: m.modified_at
        }));

        res.json({
            models,
            connected: true,
            currentDefault: process.env.OLLAMA_MODEL || 'mistral-nemo:12b'
        });

    } catch (err) {
        console.warn('[settings] Ollama tags query failed:', err.message);
        res.json({
            models: [
                { name: 'mistral-nemo:12b', size: '12.2B', family: 'llama' },
                { name: 'qwen3.5:9b', size: '9.7B', family: 'qwen35' },
                { name: 'llama3.2:3b', size: '3.2B', family: 'llama' }
            ],
            connected: false,
            error: err.message,
            currentDefault: process.env.OLLAMA_MODEL || 'mistral-nemo:12b'
        });
    }
});

// POST /api/settings/set-model — dynamically change the active model from GUI
router.post('/set-model', async (req, res) => {
    try {
        const { model, userId } = req.body;
        if (!model) return res.status(400).json({ error: 'Model name is required' });

        const start = Date.now();

        // 1. Update runtime & .env
        updateEnvModel(model);

        // 2. Update user profile in MongoDB if userId provided
        if (userId) {
            await User.findOneAndUpdate({ userId }, { $set: { selectedModel: model } });
        }

        // 3. Pre-warm / load model in background (non-blocking)
        preloadModel(model).catch(() => {});

        const elapsed = Date.now() - start;

        res.json({
            success: true,
            model,
            latencyMs: elapsed,
            message: `Active model switched to ${model}`
        });

    } catch (err) {
        console.error('[settings] Set model error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to switch model: ' + err.message });
    }
});

// POST /api/settings/test-model — test prompt against a specific model
router.post('/test-model', async (req, res) => {
    try {
        const { model } = req.body;
        const testModel = model || process.env.OLLAMA_MODEL || 'mistral-nemo:12b';
        const start = Date.now();

        const response = await fetch(OLLAMA_CHAT_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: testModel,
                messages: [{ role: 'user', content: 'Say "Bereit!" in one word.' }],
                stream: false
            }),
            signal: AbortSignal.timeout(20000)
        });

        const elapsed = Date.now() - start;
        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            return res.status(500).json({
                success: false,
                error: errBody.error || `Model test failed with status ${response.status}`
            });
        }

        const data = await response.json();
        const reply = data.message?.content?.trim() || 'OK';

        res.json({
            success: true,
            model: testModel,
            latencyMs: elapsed,
            reply
        });

    } catch (err) {
        res.status(500).json({ success: false, error: 'Ollama test error: ' + err.message });
    }
});

export default router;
