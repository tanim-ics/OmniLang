#!/usr/bin/env node

/**
 * Docker Pre-flight Check for OmniLang
 * ────────────────────────────────────
 * Verifies that:
 * 1. Ollama is installed and running on the host machine.
 * 2. At least one LLM model is already pulled and ready.
 *
 * If checks pass, exits with 0 allowing `docker compose up -d` to proceed.
 * If checks fail, notifies the user with clear instructions and exits with 1.
 */

import { existsSync } from 'fs';
import { join } from 'path';

const C = {
    reset:   '\x1b[0m',
    bold:    '\x1b[1m',
    red:     '\x1b[31m',
    green:   '\x1b[32m',
    yellow:  '\x1b[33m',
    cyan:    '\x1b[36m',
    dim:     '\x1b[2m',
    bgRed:   '\x1b[41m\x1b[37m'
};

const OLLAMA_TAGS_URL = 'http://127.0.0.1:11434/api/tags';

function banner(text) {
    console.log(`\n${C.bold}${C.cyan}─── ${text} ──────────────────────────────────────────${C.reset}\n`);
}

function checkBinaryInstalled() {
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
    return null;
}

async function runPreflight() {
    banner('🐳 OmniLang Docker Pre-Flight Validation');

    // Step 1: Check if binary exists on host
    const binaryPath = checkBinaryInstalled();
    if (binaryPath) {
        console.log(`  ${C.green}✓${C.reset} Ollama binary detected: ${C.dim}${binaryPath}${C.reset}`);
    } else {
        console.log(`  ${C.yellow}ℹ${C.reset} Ollama binary not found in standard paths (checking HTTP service)...`);
    }

    // Step 2: Check if Ollama daemon is reachable on port 11434
    let reachable = false;
    let data = null;

    if (!process.argv.includes('--simulate-offline')) {
        try {
            const res = await fetch(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(3000) });
            if (res.ok) {
                reachable = true;
                data = await res.json();
                if (process.argv.includes('--simulate-empty')) {
                    data.models = [];
                }
            }
        } catch (err) {
            reachable = false;
        }
    }

    if (!reachable) {
        console.error(`\n${C.bold}${C.red}  ✗ OLLAMA IS NOT REACHABLE ON HOST (http://localhost:11434)${C.reset}\n`);
        console.log(`  To run OmniLang in Docker, Ollama must be running on your host machine to supply GPU acceleration.\n`);

        if (!binaryPath) {
            console.log(`  ${C.bold}1. Install Ollama on your host:${C.reset}`);
            console.log(`     ${C.cyan}curl -fsSL https://ollama.com/install.sh | sh${C.reset}`);
            console.log(`     or download from: ${C.cyan}https://ollama.com${C.reset}\n`);
        }

        console.log(`  ${C.bold}2. Start the Ollama service on your host:${C.reset}`);
        console.log(`     ${C.cyan}ollama serve${C.reset}\n`);

        console.log(`  ${C.bold}3. Once started, re-run:${C.reset}`);
        console.log(`     ${C.cyan}npm run docker:up${C.reset} or ${C.cyan}docker compose up -d${C.reset}\n`);

        process.exit(1);
    }

    console.log(`  ${C.green}✓${C.reset} Ollama host service is active on http://127.0.0.1:11434`);

    // Step 3: Check for pulled models
    const models = data?.models || [];
    if (models.length === 0) {
        console.error(`\n${C.bold}${C.red}  ✗ NO AI MODELS FOUND IN OLLAMA${C.reset}\n`);
        console.log(`  OmniLang requires ${C.bold}at least one AI model${C.reset} pulled on your host before starting Docker.\n`);
        console.log(`  Please pull a model on your host by running ${C.bold}one${C.reset} of the following commands:\n`);
        console.log(`  ${C.cyan}ollama pull mistral-nemo:12b${C.reset}  ${C.dim}(Recommended: 12B multilingual model for 8GB+ VRAM)${C.reset}`);
        console.log(`  ${C.cyan}ollama pull qwen2.5:7b${C.reset}        ${C.dim}(Fast & accurate for 6GB+ VRAM)${C.reset}`);
        console.log(`  ${C.cyan}ollama pull llama3.2:3b${C.reset}       ${C.dim}(Ultra-lightweight for 4GB VRAM)${C.reset}\n`);
        console.log(`  After pulling your desired model, re-run:`);
        console.log(`  ${C.cyan}npm run docker:up${C.reset}\n`);

        process.exit(1);
    }

    // Step 4: Display detected models
    console.log(`  ${C.green}✓${C.reset} Detected ${C.bold}${models.length}${C.reset} ready model${models.length > 1 ? 's' : ''} on host:`);
    for (const m of models) {
        const sizeGb = (m.size / (1024 * 1024 * 1024)).toFixed(1);
        console.log(`    ${C.cyan}•${C.reset} ${C.bold}${m.name}${C.reset} ${C.dim}(${sizeGb} GB)${C.reset}`);
    }

    console.log(`\n  ${C.green}🎉 All pre-flight checks passed! Launching Docker containers...${C.reset}\n`);
    process.exit(0);
}

runPreflight().catch(err => {
    console.error(`\n  ✗ Pre-flight error: ${err.message}\n`);
    process.exit(1);
});
