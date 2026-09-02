import { ensureOllamaRunning, isOllamaReachable } from './ollamaManager.js';

const OLLAMA_TAGS_ENDPOINT = 'http://localhost:11434/api/tags';
const OLLAMA_CHAT_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434/api/chat';

/**
 * Fetch all model names currently installed in Ollama.
 */
export async function getInstalledModels() {
    try {
        const res = await fetch(OLLAMA_TAGS_ENDPOINT, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
            const data = await res.json();
            return (data.models || []).map(m => m.name);
        }
    } catch (_) {}
    return [];
}

/**
 * Call Ollama with automatic model discovery, daemon recovery, and fallback.
 */
export async function callOllama(preferredModel, messages, options = {}) {
    const reachable = await isOllamaReachable();
    if (!reachable) {
        console.log('⚡ Ollama unreachable, attempting auto-restart...');
        await ensureOllamaRunning();
    }

    // Discover installed models dynamically from Ollama
    const installed = await getInstalledModels();

    let modelsToTry = [];
    if (installed.length > 0) {
        if (preferredModel && installed.includes(preferredModel)) {
            modelsToTry.push(preferredModel);
        }
        if (process.env.OLLAMA_MODEL && installed.includes(process.env.OLLAMA_MODEL) && !modelsToTry.includes(process.env.OLLAMA_MODEL)) {
            modelsToTry.push(process.env.OLLAMA_MODEL);
        }
        // Add any remaining installed models as fallbacks
        installed.forEach(m => {
            if (!modelsToTry.includes(m)) modelsToTry.push(m);
        });
    } else {
        modelsToTry = [preferredModel, process.env.OLLAMA_MODEL, 'qwen3.5:9b'].filter(Boolean);
    }

    let lastError = null;

    for (const model of modelsToTry) {
        try {
            const body = {
                model,
                messages,
                stream: false,
                think: false,
                options: {
                    num_predict: 512,
                    temperature: 0.7,
                    ...(options.options || {})
                },
                ...options
            };
            delete body.options?.options;

            const response = await fetch(OLLAMA_CHAT_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(120000)
            });

            if (response.ok) {
                const data = await response.json();
                let rawContent = data.message?.content || '';

                // If content is empty because reasoning model stopped mid-thinking
                if (!rawContent && data.message?.thinking) {
                    const thinking = data.message.thinking;
                    const matches = Array.from(thinking.matchAll(/"([^"]{15,})"/g)).map(m => m[1]);
                    const cleanMatches = matches.filter(m => !m.includes('Thinking') && !m.includes('Correction:') && !m.startsWith('Option '));
                    if (cleanMatches.length > 0) {
                        rawContent = cleanMatches[cleanMatches.length - 1];
                    } else {
                        const cleanLines = thinking.split('\n')
                            .map(l => l.trim())
                            .filter(l => l.length > 10 && !l.startsWith('*') && !l.startsWith('#') && !l.startsWith('-') && !l.startsWith('Thinking') && !l.endsWith(':') && !l.startsWith('.)'));
                        rawContent = cleanLines[cleanLines.length - 1] || '';
                    }
                }

                if (rawContent) {
                    const cleanContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                    return { data, modelUsed: model, content: cleanContent || rawContent };
                }
            } else {
                const errJson = await response.json().catch(() => ({}));
                console.warn(`[ollama] Model "${model}" returned status ${response.status}:`, errJson.error || '');
                lastError = new Error(errJson.error || `HTTP ${response.status}`);
            }
        } catch (err) {
            console.warn(`[ollama] Call to model "${model}" failed:`, err.message);
            lastError = err;
        }
    }

    throw lastError || new Error('No compatible Ollama models found. Please check Ollama tags.');
}
