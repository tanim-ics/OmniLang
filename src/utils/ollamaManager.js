import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = join(__dirname, '../../.env');

const OLLAMA_TAGS_ENDPOINT = 'http://localhost:11434/api/tags';
const OLLAMA_GENERATE_ENDPOINT = 'http://localhost:11434/api/generate';

/**
 * Check if Ollama daemon is reachable.
 */
export async function isOllamaReachable() {
    try {
        const res = await fetch(OLLAMA_TAGS_ENDPOINT, { signal: AbortSignal.timeout(2000) });
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Ensure Ollama server daemon is running. If not, spawn it in background.
 */
export async function ensureOllamaRunning() {
    const reachable = await isOllamaReachable();
    if (reachable) {
        console.log('✓ Ollama service is already running on http://localhost:11434');
        return true;
    }

    console.log('⚡ Starting Ollama GPU server in background...');
    try {
        const gpuEnv = {
            ...process.env,
            CUDA_VISIBLE_DEVICES: '0',
            OLLAMA_FLASH_ATTENTION: '1',
            OLLAMA_NUM_PARALLEL: '1',
            OLLAMA_ORIGINS: '*',
            OLLAMA_KEEP_ALIVE: '24h'
        };

        const proc = spawn('ollama', ['serve'], {
            detached: true,
            stdio: 'ignore',
            env: gpuEnv
        });
        proc.unref();

        // Wait up to 10 seconds for Ollama to boot
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 1000));
            if (await isOllamaReachable()) {
                console.log('✓ Ollama GPU service successfully started');
                return true;
            }
        }
    } catch (err) {
        console.warn('⚠️ Could not auto-spawn ollama serve:', err.message);
    }
    return false;
}

/**
 * Preload and warm up an LLM model into GPU VRAM.
 */
export async function preloadModel(modelName) {
    if (!modelName) return;
    try {
        console.log(`⏳ Pre-warming model "${modelName}" into GPU VRAM...`);
        const res = await fetch(OLLAMA_GENERATE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelName,
                keep_alive: '24h' // Keep resident in GPU VRAM
            }),
            signal: AbortSignal.timeout(30000)
        });

        if (res.ok) {
            console.log(`✓ Model "${modelName}" is loaded in GPU VRAM & ready!`);
            return true;
        } else {
            const err = await res.json().catch(() => ({}));
            console.warn(`⚠️ Could not pre-warm model "${modelName}":`, err.error || res.statusText);
            return false;
        }
    } catch (err) {
        console.warn(`⚠️ Model "${modelName}" pre-warm timed out or failed:`, err.message);
        return false;
    }
}

/**
 * Switch the global default model in process.env and save to .env file.
 */
export function updateEnvModel(modelName) {
    if (!modelName) return;
    process.env.OLLAMA_MODEL = modelName;

    try {
        if (existsSync(ENV_PATH)) {
            let content = readFileSync(ENV_PATH, 'utf8');
            if (/^OLLAMA_MODEL=.*$/m.test(content)) {
                content = content.replace(/^OLLAMA_MODEL=.*$/m, `OLLAMA_MODEL=${modelName}`);
            } else {
                content += `\nOLLAMA_MODEL=${modelName}\n`;
            }
            writeFileSync(ENV_PATH, content, 'utf8');
            console.log(`✓ Saved OLLAMA_MODEL=${modelName} to .env`);
        }
    } catch (err) {
        console.warn('⚠️ Could not write to .env:', err.message);
    }
}
