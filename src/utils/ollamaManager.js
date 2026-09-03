import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = join(__dirname, '../../.env');

/**
 * Resolve the base URL of the configured Ollama instance.
 * Supports:
 * - Localhost: http://localhost:11434
 * - Docker: http://host.docker.internal:11434
 * - Remote host/IP: http://192.168.1.50:11434
 */
export function getOllamaBaseUrl() {
    const ep = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434/api/chat';
    try {
        const url = new URL(ep);
        return `${url.protocol}//${url.host}`;
    } catch {
        return 'http://localhost:11434';
    }
}

export function getOllamaTagsEndpoint() {
    return `${getOllamaBaseUrl()}/api/tags`;
}

export function getOllamaGenerateEndpoint() {
    return `${getOllamaBaseUrl()}/api/generate`;
}

export function getOllamaChatEndpoint() {
    return process.env.OLLAMA_ENDPOINT || `${getOllamaBaseUrl()}/api/chat`;
}

/**
 * Locate the ollama executable across standard and local system paths.
 */
function findOllamaBinary() {
    if (process.env.OLLAMA_BIN && existsSync(process.env.OLLAMA_BIN)) {
        return process.env.OLLAMA_BIN;
    }
    const candidates = [
        '/usr/local/bin/ollama',
        '/usr/bin/ollama',
        '/bin/ollama',
        '/snap/bin/ollama',
        join(process.env.HOME || '', 'bin/ollama'),
        join(process.env.HOME || '', '.local/bin/ollama')
    ];
    for (const c of candidates) {
        if (existsSync(c)) return c;
    }
    return 'ollama';
}

/**
 * Check if Ollama daemon is reachable.
 */
export async function isOllamaReachable() {
    try {
        const res = await fetch(getOllamaTagsEndpoint(), { signal: AbortSignal.timeout(2500) });
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Ensure Ollama server daemon is running.
 * - When running in Docker or with a remote host: checks connectivity without attempting local spawn.
 * - When running natively on the host: safely spawns `ollama serve` if not yet running.
 */
export async function ensureOllamaRunning() {
    const baseUrl = getOllamaBaseUrl();
    const reachable = await isOllamaReachable();
    if (reachable) {
        console.log(`✓ Ollama service is reachable on ${baseUrl}`);
        return true;
    }

    // Determine if running inside a Docker container or using a remote/virtual host
    let isLocalhost = true;
    try {
        const hostname = new URL(baseUrl).hostname;
        isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    } catch {
        isLocalhost = false;
    }

    const isContainer = process.env.IS_DOCKER === 'true' || existsSync('/.dockerenv') || !isLocalhost;

    if (isContainer) {
        console.warn(`ℹ️  Running in container/remote mode. Ollama host is "${baseUrl}".`);
        console.warn('   Ensure Ollama is active on your host machine (http://localhost:11434).');
        return false;
    }

    console.log('⚡ Starting Ollama GPU server in background...');
    try {
        const ollamaBin = findOllamaBinary();

        const systemPath = [
            '/usr/local/bin',
            '/usr/bin',
            '/bin',
            '/usr/local/sbin',
            '/usr/sbin',
            '/sbin',
            '/snap/bin',
            process.env.PATH || ''
        ].filter(Boolean).join(':');

        const gpuEnv = {
            ...process.env,
            PATH: systemPath,
            CUDA_VISIBLE_DEVICES: '0',
            OLLAMA_FLASH_ATTENTION: '1',
            OLLAMA_NUM_PARALLEL: '1',
            OLLAMA_ORIGINS: '*',
            OLLAMA_KEEP_ALIVE: '24h'
        };

        let spawnError = null;
        const proc = spawn(ollamaBin, ['serve'], {
            detached: true,
            stdio: 'ignore',
            env: gpuEnv
        });

        // CRITICAL: Catch error event on ChildProcess to prevent uncaughtException (spawn ENOENT)
        proc.on('error', (err) => {
            spawnError = err;
            console.warn(`⚠️ Could not auto-start Ollama daemon (${err.code || err.message}).`);
            console.warn('  OmniLang web server will run, but Ollama features require Ollama to be started manually (`ollama serve`).');
        });

        proc.unref();

        // Wait up to 6 seconds for Ollama to boot
        for (let i = 0; i < 6; i++) {
            if (spawnError) break;
            await new Promise(r => setTimeout(r, 1000));
            if (await isOllamaReachable()) {
                console.log(`✓ Ollama GPU service successfully started on ${baseUrl}`);
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
        const res = await fetch(getOllamaGenerateEndpoint(), {
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
