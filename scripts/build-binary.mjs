// Builds a self-contained OmniLang executable for the platform it runs on.
//
//   npm run build:binary            → dist/omnilang-<os>-<arch>/ and a .zip / .tar.gz next to it
//
// How it works (Node "single executable application", SEA):
//   1. esbuild bundles src/server.js and its npm dependencies into one CommonJS file.
//      Each source file's `import.meta.url` is rewritten to point at where that file
//      would sit next to the executable, so `../public`, `data/vocabBank15k.json` and
//      `../../.env` keep resolving exactly as they do in a git checkout.
//   2. `node --experimental-sea-config` turns the bundle into a blob, and postject
//      injects it into a copy of the current `node` binary.
//   3. public/, src/data/ and .env.example are copied beside the executable.
//
// SEA cannot cross-compile, so CI runs this once per OS/arch (see .github/workflows/release.yml).
// MongoDB and Ollama are not bundled; the executable connects to them at runtime.

import { build } from 'esbuild';
import { execFileSync } from 'child_process';
import { cpSync, copyFileSync, mkdirSync, rmSync, writeFileSync, readFileSync, chmodSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT     = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg      = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const platform = { darwin: 'macos', win32: 'windows', linux: 'linux' }[process.platform] || process.platform;
const name     = `omnilang-${platform}-${process.arch}`;
const isWin    = process.platform === 'win32';
const exeName  = isWin ? 'omnilang.exe' : 'omnilang';

// Homebrew's node is a small launcher linked against libnode and has no SEA fuse.
if (statSync(process.execPath).size < 20 * 1024 * 1024) {
    console.error(`✗ ${process.execPath} is not a standalone Node.js binary (Homebrew?). Use the official build from nodejs.org or nvm.`);
    process.exit(1);
}

const BUILD = join(ROOT, 'build');
const OUT   = join(ROOT, 'dist', name);
rmSync(BUILD, { recursive: true, force: true });
rmSync(OUT,   { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });
mkdirSync(OUT,   { recursive: true });

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT });

// ── 1. Bundle ────────────────────────────────────────────────────────────────
// Replace import.meta.url in our own sources with "<executable dir>/<same relative path>".
const metaUrlPlugin = {
    name: 'exe-relative-import-meta-url',
    setup(b) {
        b.onLoad({ filter: /[\\/]src[\\/].*\.js$/ }, async (args) => {
            const rel  = relative(ROOT, args.path).split('\\').join('/');
            const code = readFileSync(args.path, 'utf8').replaceAll(
                'import.meta.url',
                `require('url').pathToFileURL(require('path').join(__OMNILANG_HOME, ${JSON.stringify(rel)})).href`
            );
            return { contents: code, loader: 'js' };
        });
    }
};

await build({
    entryPoints: [join(ROOT, 'src/server.js')],
    outfile: join(BUILD, 'omnilang.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    minify: false,
    legalComments: 'none',
    logLevel: 'warning',
    // Optional native/peer modules of the MongoDB driver and nodemailer. They are only
    // loaded inside try/catch, so leaving them out just disables those features.
    external: [
        'kerberos', 'snappy', '@mongodb-js/zstd', 'mongodb-client-encryption',
        '@aws-sdk/credential-providers', 'gcp-metadata', 'socks', 'aws4', 'nodemailer'
    ],
    // Runs before any bundled module: resolve the install folder and make it the cwd,
    // so dotenv finds the .env next to the executable even when launched by double-click.
    banner: {
        js: [
            "const __OMNILANG_HOME = require('path').dirname(process.execPath);",
            "try { if (require('node:sea').isSea()) process.chdir(__OMNILANG_HOME); } catch {}"
        ].join('\n')
    },
    plugins: [metaUrlPlugin]
});

// ── 2. Single executable ─────────────────────────────────────────────────────
writeFileSync(join(BUILD, 'sea-config.json'), JSON.stringify({
    main: 'build/omnilang.cjs',
    output: 'build/sea-prep.blob',
    disableExperimentalSEAWarning: true,
    useCodeCache: false
}, null, 2));
run(process.execPath, ['--experimental-sea-config', 'build/sea-config.json']);

const exe = join(OUT, exeName);
copyFileSync(process.execPath, exe);
chmodSync(exe, 0o755);

if (process.platform === 'darwin') run('codesign', ['--remove-signature', exe]);
const postjectArgs = [
    join(ROOT, 'node_modules/postject/dist/cli.js'), exe, 'NODE_SEA_BLOB', 'build/sea-prep.blob',
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
];
if (process.platform === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA');
run(process.execPath, postjectArgs);
// Apple Silicon refuses to run unsigned code; an ad-hoc signature is enough.
if (process.platform === 'darwin') run('codesign', ['--sign', '-', exe]);

// ── 3. Assets next to the executable ─────────────────────────────────────────
cpSync(join(ROOT, 'public'), join(OUT, 'public'), { recursive: true });
cpSync(join(ROOT, 'src/data'), join(OUT, 'src/data'), { recursive: true });
copyFileSync(join(ROOT, '.env.example'), join(OUT, '.env.example'));
writeFileSync(join(OUT, 'README.txt'), [
    `OmniLang ${pkg.version} (${platform}-${process.arch})`,
    '',
    'Needs, running on this machine:',
    '  - MongoDB on 127.0.0.1:27017   (e.g. `docker run -d -p 27017:27017 mongo:7`)',
    '  - Ollama on 127.0.0.1:11434    (https://ollama.com, then `ollama pull mistral-nemo:12b`)',
    '',
    'Optional: copy .env.example to .env in this folder to change ports, the model or MONGO_URI.',
    '',
    isWin ? 'Start: double-click omnilang.exe' : 'Start: ./omnilang   (in a terminal, from this folder)',
    'Then open http://localhost:5001',
    ''
].join('\n'));

// ── 4. Archive ───────────────────────────────────────────────────────────────
const distDir = join(ROOT, 'dist');
if (isWin) {
    run('powershell', ['-NoProfile', '-Command',
        `Compress-Archive -Path '${OUT}' -DestinationPath '${join(distDir, name + '.zip')}' -Force`]);
} else {
    run('tar', ['-czf', join(distDir, `${name}.tar.gz`), '-C', distDir, name]);
}
console.log(`✓ Built ${relative(ROOT, exe)}`);
