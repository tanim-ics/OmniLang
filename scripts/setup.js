import fs from 'fs';
import path from 'path';
import net from 'net';
import http from 'http';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const colors = {
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    bold: '\x1b[1m',
    reset: '\x1b[0m'
};

function log(msg, color = '') {
    console.log(`${color}${msg}${colors.reset}`);
}

async function runSetup() {
    log('\n========================================================', colors.cyan);
    log('  OmniLang — Environment Doctor & System Diagnostics', colors.cyan + colors.bold);
    log('========================================================\n', colors.cyan);

    let allHealthy = true;

    // 1. Check Node.js version
    const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
    if (nodeMajor >= 18) {
        log(`✓ Node.js runtime: ${process.version} (supported)`, colors.green);
    } else {
        log(`⚠️ Node.js runtime ${process.version} detected. Node.js 18+ is recommended.`, colors.yellow);
        allHealthy = false;
    }

    // 2. Check .env configuration
    const envPath = path.join(rootDir, '.env');
    const envExamplePath = path.join(rootDir, '.env.example');

    if (!fs.existsSync(envPath)) {
        if (fs.existsSync(envExamplePath)) {
            fs.copyFileSync(envExamplePath, envPath);
            log('✓ Created .env configuration from .env.example', colors.green);
        } else {
            const defaultEnv = `PORT=5001\nMONGO_URI=mongodb://127.0.0.1:27017/tanim_german\nOLLAMA_ENDPOINT=http://localhost:11434/api/chat\nOLLAMA_MODEL=\nCUDA_VISIBLE_DEVICES=0\nOLLAMA_FLASH_ATTENTION=1\nOLLAMA_NUM_PARALLEL=1\nOLLAMA_KEEP_ALIVE=24h\nOLLAMA_ORIGINS=*\n`;
            fs.writeFileSync(envPath, defaultEnv);
            log('✓ Generated default .env file', colors.green);
        }
    } else {
        log('✓ Configuration file (.env) found', colors.green);
    }

    // 3. Check 15k Vocab dataset
    const datasetPath = path.join(rootDir, 'src/data/vocabBank15k.json');
    if (fs.existsSync(datasetPath)) {
        const stats = fs.statSync(datasetPath);
        log(`✓ 15,000-Word CEFR vocabulary dataset ready (${(stats.size / 1024 / 1024).toFixed(2)} MB)`, colors.green);
    } else {
        log('⚠️ src/data/vocabBank15k.json not found! Generating dataset now...', colors.yellow);
        try {
            execSync('python3 scripts/build_vocab_bank_15k.py', { cwd: rootDir, stdio: 'inherit' });
            log('✓ 15k Vocabulary dataset generated successfully', colors.green);
        } catch (e) {
            log('❌ Could not generate vocab dataset: ' + e.message, colors.red);
            allHealthy = false;
        }
    }

    // 4. Check MongoDB
    log('\nChecking MongoDB database connection on port 27017...', colors.cyan);
    const mongoOk = await testPort('127.0.0.1', 27017);
    if (mongoOk) {
        log('✓ MongoDB is online and accepting connections', colors.green);
    } else {
        log('⚠️ MongoDB is not responding on 127.0.0.1:27017', colors.yellow);
        log('  OmniLang can start it automatically if you run: ./setup.sh', colors.cyan);
        log('  Or run manually:', colors.yellow);
        log('    mongod --dbpath ~/.omnilang/data/db --port 27017', colors.bold);
        log('    or: docker compose up -d mongo', colors.bold);
        allHealthy = false;
    }

    // 5. Check Ollama
    log('\nChecking Ollama local AI service on port 11434...', colors.cyan);
    const ollamaOk = await testHttp('http://127.0.0.1:11434/api/tags');
    if (ollamaOk) {
        log('✓ Ollama service is online', colors.green);
        try {
            const tagsRes = await fetchJson('http://127.0.0.1:11434/api/tags');
            const models = (tagsRes.models || []).map(m => m.name);
            log(`  Available local models: ${models.join(', ') || 'none'}`, colors.cyan);

            let configuredModel = '';
            if (fs.existsSync(envPath)) {
                const envContent = fs.readFileSync(envPath, 'utf8');
                const match = envContent.match(/^OLLAMA_MODEL=(.*)$/m);
                if (match && match[1]) configuredModel = match[1].trim().replace(/['"]/g, '');
            }

            if (models.length === 0) {
                log('\n  ⚠️  No models found in Ollama. OmniLang works with any Ollama-compatible model.', colors.yellow);
                log('  Choose one that fits your hardware and run:\n', colors.cyan);
                log('    ollama pull mistral-nemo:12b   (7.1 GB — high quality)', colors.bold);
                log('    ollama pull qwen2.5:7b         (4.7 GB — fast & capable)', colors.bold);
                log('    ollama pull llama3.2:3b        (2.0 GB — lightweight)', colors.bold);
                log('    ollama pull gemma3:4b          (3.3 GB — Google)', colors.bold);
                log('\n  Or select a model from the in-app onboarding after launch.', colors.cyan);
                allHealthy = false;
            } else if (configuredModel) {
                const hasConfigured = models.some(m => m.startsWith(configuredModel.split(':')[0]));
                if (hasConfigured) {
                    log(`✓ Configured model "${configuredModel}" is installed and ready`, colors.green);
                } else {
                    log(`ℹ️  Configured model "${configuredModel}" not found, but "${models[0]}" is available.`, colors.cyan);
                }
            } else {
                log(`✓ Local models available: ${models.join(', ')}`, colors.green);
                log('  Select your model from the in-app onboarding after launch.', colors.cyan);
            }
        } catch (_) {}
    } else {
        log('⚠️ Ollama service is not running on port 11434', colors.yellow);
        log('  Run: ollama serve', colors.bold);
        allHealthy = false;
    }

    log('\n========================================================', colors.cyan);
    if (allHealthy) {
        log('  ✓ System ready! Launch OmniLang:', colors.green + colors.bold);
        log('    npm start           (Production)', colors.bold);
        log('    npm run dev         (Development hot-reload)', colors.bold);
        log('    docker compose up   (Containerized)', colors.bold);
        log('  Access in browser: http://localhost:5001', colors.cyan);
    } else {
        log('  Notice: Some prerequisites require attention.', colors.yellow + colors.bold);
        log('  Run the 1-command installer to resolve all issues automatically:', colors.cyan);
        log('    ./setup.sh', colors.bold);
    }
    log('========================================================\n', colors.cyan);
}

function testPort(host, port, timeout = 1500) {
    return new Promise(resolve => {
        const socket = new net.Socket();
        socket.setTimeout(timeout);
        socket.on('connect', () => { socket.destroy(); resolve(true); });
        socket.on('timeout', () => { socket.destroy(); resolve(false); });
        socket.on('error', () => { socket.destroy(); resolve(false); });
        socket.connect(port, host);
    });
}

function testHttp(url) {
    return new Promise(resolve => {
        const req = http.get(url, { timeout: 1500 }, res => {
            resolve(res.statusCode >= 200 && res.statusCode < 400);
        });
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.on('error', () => resolve(false));
    });
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

runSetup();
