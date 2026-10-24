import { callOllamaJSON } from './ollama.js';

// Proofreading is a separate, temperature-0 pass: asking one prompt to both chat and judge
// made the model skip real mistakes (measured 16/16 vs. missed word-order errors).
function buildProofreadPrompt(level, speaking) {
    return `You are a meticulous German proofreader for a CEFR ${level} learner.
Rewrite the learner's message with every real German mistake fixed: word order (verb in 2nd position in main clauses, verb at the end after weil/dass/wenn/ob), verb forms and auxiliaries (haben/sein), cases after prepositions, articles and gender, subject-verb agreement, spelling${speaking ? '' : ' and noun capitalisation'}.
Change NOTHING else: keep their words, meaning and style. If the message is already correct, copy it EXACTLY.
Grammatical word-order variants are NOT mistakes: "Das Wetter ist heute schön" and "Heute ist das Wetter schön" are both correct, so never move words in a sentence whose verb is already second.
Ignore a missing final period.${speaking ? '\nThe message is a speech-to-text transcript: ignore punctuation and capitalisation entirely.' : ''}
"fixes": one entry per mistake: "wrong" = the exact wrong words, "right" = the corrected words, "rule" = the grammar rule in max 8 English words. Empty list if correct.`;
}

const PROOF_SCHEMA = {
    type: 'object',
    properties: {
        corrected: { type: 'string' },
        fixes: {
            type: 'array',
            items: {
                type: 'object',
                properties: { wrong: { type: 'string' }, right: { type: 'string' }, rule: { type: 'string' } },
                required: ['wrong', 'right', 'rule']
            }
        }
    },
    required: ['corrected', 'fixes']
};

// Compare ignoring punctuation/whitespace; case matters for typed text (noun capitalisation).
const normalize = (t, ignoreCase) => {
    const s = (t || '').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
    return ignoreCase ? s.toLowerCase() : s.charAt(0).toLowerCase() + s.slice(1);
};

export async function proofread(model, level, message, speaking) {
    try {
        const { json } = await callOllamaJSON(model, [
            { role: 'system', content: buildProofreadPrompt(level, speaking) },
            { role: 'user', content: message }
        ], PROOF_SCHEMA, { options: { temperature: 0, num_predict: 300 } });
        const corrected = String(json.corrected || '').trim();
        if (!corrected || normalize(corrected, speaking) === normalize(message, speaking)) return null;
        const fixes = (Array.isArray(json.fixes) ? json.fixes : [])
            .map(f => ({ wrong: String(f.wrong || '').trim(), right: String(f.right || '').trim(), rule: String(f.rule || '').trim() }))
            .filter(f => f.wrong && f.right && f.wrong !== f.right)
            // Speech transcripts have no reliable casing/punctuation — drop fixes that only change those.
            .filter(f => !speaking || normalize(f.wrong, true) !== normalize(f.right, true))
            .filter(f => !speaking || !/capitali[sz]|punctuat|großschreib/i.test(f.rule))
            .slice(0, 4);
        return { original: message, corrected, fixes, explanation: fixes.map(f => f.rule).filter(Boolean).join('; ') };
    } catch (err) {
        console.warn('[chat] proofread skipped:', err.message);
        return null;
    }
}


// Split German prose into sentences (keeps the terminal punctuation).
export function splitSentences(text) {
    return (text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["»“]?|[^.!?]+$/g) || [])
        .map(t => t.trim()).filter(t => t.length > 1);
}

/** Proofread every sentence with bounded concurrency; returns per-sentence results in order. */
export async function proofreadText(model, level, text, concurrency = 3) {
    const sentences = splitSentences(text).slice(0, 40);
    const results = new Array(sentences.length);
    let next = 0;
    const worker = async () => {
        while (next < sentences.length) {
            const i = next++;
            results[i] = { sentence: sentences[i], correction: await proofread(model, level, sentences[i], false) };
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, sentences.length) }, worker));
    return results;
}
