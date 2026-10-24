import { ensureOllamaRunning, isOllamaReachable, getOllamaTagsEndpoint, getOllamaChatEndpoint } from './ollamaManager.js';

const TIMEOUT_MS  = Number(process.env.OLLAMA_TIMEOUT_MS) || 120000;
const KEEP_ALIVE  = process.env.OLLAMA_KEEP_ALIVE || '1h';
const NUM_CTX     = Number(process.env.OLLAMA_NUM_CTX) || 4096;
const MODEL_TTL   = 30000;
const NON_CHAT    = /embed|nomic|bge|minilm|rerank|whisper/i;

// Task presets: low temperature where we need facts/JSON, warmer for conversation & stories.
export const TASK = {
    chat:      { temperature: 0.6, num_predict: 320 },
    grade:     { temperature: 0.15, num_predict: 1400 },
    translate: { temperature: 0, num_predict: 200 },
    story:     { temperature: 0.8, num_predict: 900 },
    vocab:     { temperature: 0.7, num_predict: 1600 },
    coach:     { temperature: 0.5, num_predict: 600 }
};

let modelCache = { at: 0, models: [] };

// ---- Foreground priority ----
// Ollama serves one request at a time by default, so a background job (the coach's daily plan)
// would make a learner's story or chat wait behind it. Background calls only start when no
// learner-facing call is running, and are aborted (then retried) the moment one arrives.
let foregroundActive = 0;
const backgroundJobs = new Set();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForIdle() {
    while (foregroundActive > 0) await sleep(500);
}

/**
 * Fetch all model names currently installed in Ollama (cached for 30 s).
 */
export async function getInstalledModels({ fresh = false } = {}) {
    if (!fresh && Date.now() - modelCache.at < MODEL_TTL && modelCache.models.length) {
        return modelCache.models;
    }
    try {
        const res = await fetch(getOllamaTagsEndpoint(), { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
            const data = await res.json();
            modelCache = { at: Date.now(), models: (data.models || []).map(m => m.name) };
            return modelCache.models;
        }
    } catch (_) {}
    return [];
}

function resolveModels(preferredModel, installed) {
    const wanted = [preferredModel, process.env.OLLAMA_MODEL].filter(Boolean);
    if (!installed.length) return [...new Set([...wanted, 'mistral-nemo:12b'])];

    // "mistral-nemo" should match "mistral-nemo:latest"
    const match = name => installed.find(m => m === name || m === `${name}:latest`);
    const ordered = wanted.map(match).filter(Boolean);
    // One fallback at most: trying every installed model serially can stall a request for minutes.
    const fallback = installed.find(m => !NON_CHAT.test(m) && !ordered.includes(m));
    if (fallback) ordered.push(fallback);
    return [...new Set(ordered)];
}

function extractContent(data) {
    let raw = data.message?.content || '';
    // Reasoning models occasionally stop inside their thinking block — salvage the last quoted answer.
    if (!raw && data.message?.thinking) {
        const quotes = Array.from(data.message.thinking.matchAll(/"([^"]{15,})"/g)).map(m => m[1]);
        raw = quotes[quotes.length - 1] || '';
    }
    return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * Call Ollama /api/chat with daemon recovery and a single fallback model.
 * @param {string} preferredModel
 * @param {Array}  messages  [{ role, content }]
 * @param {object} options   { options: {temperature,…}, format: 'json' | JSON schema }
 */
export async function callOllama(preferredModel, messages, options = {}) {
    const { background = false, ...rest } = options;
    if (!background) {
        foregroundActive++;
        backgroundJobs.forEach(job => job.abort('preempted'));
        try {
            return await runOllama(preferredModel, messages, rest, null);
        } finally {
            foregroundActive--;
        }
    }
    for (let attempt = 0; attempt < 6; attempt++) {
        await waitForIdle();
        const job = new AbortController();
        backgroundJobs.add(job);
        try {
            return await runOllama(preferredModel, messages, rest, job.signal);
        } catch (err) {
            if (job.signal.aborted && job.signal.reason === 'preempted') { await sleep(3000); continue; }
            throw err;
        } finally {
            backgroundJobs.delete(job);
        }
    }
    throw new Error('Background request kept being preempted');
}

async function runOllama(preferredModel, messages, options, abortSignal) {
    if (!(await isOllamaReachable())) {
        console.log('⚡ Ollama unreachable, attempting auto-restart...');
        await ensureOllamaRunning();
    }

    const modelsToTry = resolveModels(preferredModel, await getInstalledModels());
    const { options: modelOptions = {}, ...rest } = options;
    let lastError = null;

    for (const model of modelsToTry) {
        try {
            const body = {
                model,
                messages,
                stream: false,
                think: false,
                keep_alive: KEEP_ALIVE,
                options: { num_ctx: NUM_CTX, num_predict: 512, temperature: 0.7, ...modelOptions },
                ...rest
            };
            const started = Date.now();
            const response = await fetch(getOllamaChatEndpoint(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS)
            });

            if (response.ok) {
                const data = await response.json();
                const content = extractContent(data);
                if (content) {
                    if (process.env.OLLAMA_DEBUG) {
                        console.log(`[ollama] ${model} ${Date.now() - started}ms, ${data.eval_count || '?'} tokens`);
                    }
                    return { data, modelUsed: model, content };
                }
                lastError = new Error(`Model "${model}" returned an empty answer`);
            } else {
                const errJson = await response.json().catch(() => ({}));
                console.warn(`[ollama] Model "${model}" returned status ${response.status}:`, errJson.error || '');
                lastError = new Error(errJson.error || `HTTP ${response.status}`);
            }
        } catch (err) {
            if (abortSignal?.aborted) throw err; // preempted — let the caller retry, don't try fallbacks
            console.warn(`[ollama] Call to model "${model}" failed:`, err.message);
            lastError = err;
        }
    }

    throw lastError || new Error('No compatible Ollama models found. Run: ollama pull mistral-nemo:12b');
}

function parseJsonLoose(text) {
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(clean); } catch (_) {}
    const m = clean.match(/[[{][\s\S]*[\]}]/);
    if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
    return null;
}

/**
 * Structured output: constrains the model to a JSON schema (Ollama ≥ 0.5) and parses the result.
 * Retries once with a repair instruction if the model still produces invalid JSON.
 */
export async function callOllamaJSON(preferredModel, messages, schema, options = {}) {
    let result = await callOllama(preferredModel, messages, { ...options, format: schema || 'json' });
    let parsed = parseJsonLoose(result.content);
    if (parsed === null) {
        result = await callOllama(preferredModel, [
            ...messages,
            { role: 'assistant', content: result.content },
            { role: 'user', content: 'That was not valid JSON. Reply again with ONLY the JSON object, nothing else.' }
        ], { ...options, format: schema || 'json' });
        parsed = parseJsonLoose(result.content);
    }
    if (parsed === null) throw new Error('Model did not return valid JSON');
    return { ...result, json: parsed };
}
