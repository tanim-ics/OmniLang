# Releasing OmniLang

All builds run on GitHub-hosted runners. Nothing needs to be built on your Mac.

## Cut a release

1. Bump `"version"` in `package.json` on `master` (optional, it is printed in the bundled `README.txt`).
2. Tag and push:

   ```bash
   git tag v1.1.0
   git push origin v1.1.0
   ```

   A tag with a hyphen (`v1.1.0-rc.1`) is published as a **pre-release**.
3. Watch **Actions → Release**. After about 5–10 minutes the release appears under
   [Releases](https://github.com/tanim-ics/OmniLang/releases) with six archives and `SHA256SUMS.txt`.
   Release notes are `.github/release-notes.md` plus GitHub's generated changelog.

To build without publishing, run **Actions → Release → Run workflow**: the archives are attached to the run as artifacts. The same build runs on every PR that changes the packaging (`scripts/build-binary.mjs`, `release.yml`, `package*.json`).

Archive names carry no version, so the newest one is always at
`https://github.com/tanim-ics/OmniLang/releases/latest/download/omnilang-macos-arm64.tar.gz`.

## What gets built

| Archive | Runner | For |
|---|---|---|
| `omnilang-macos-arm64.tar.gz` | `macos-14` | Apple Silicon Macs |
| `omnilang-macos-x64.tar.gz` | `macos-15-intel` | Intel Macs |
| `omnilang-windows-x64.zip` | `windows-latest` | Windows PCs |
| `omnilang-windows-arm64.zip` | `windows-11-arm` | Windows on ARM |
| `omnilang-linux-x64.tar.gz` | `ubuntu-latest` | Linux PCs and servers |
| `omnilang-linux-arm64.tar.gz` | `ubuntu-24.04-arm` | Raspberry Pi 4/5, ARM servers |

Each archive contains:

```
omnilang(.exe)    Node.js 22 + the bundled server in one executable (~115 MB)
public/           the web app, served as before
src/data/         vocabBank15k.json, seeded into MongoDB on first start
.env.example      copy to .env next to the executable to configure it
README.txt
```

The executable changes into its own folder at startup, so `.env` is read from there even when it is started by double-click. **MongoDB and Ollama are not bundled.** The server needs MongoDB at `MONGO_URI` (default `mongodb://127.0.0.1:27017/tanim_german`) and Ollama at `OLLAMA_ENDPOINT` (default `http://localhost:11434/api/chat`). On macOS it starts `Ollama.app` itself when it is installed.

## How the binary is made

`npm run build:binary` (`scripts/build-binary.mjs`) uses Node's built-in [single executable applications](https://nodejs.org/api/single-executable-applications.html) (SEA):

1. **esbuild** bundles `src/server.js` and its npm dependencies into one CommonJS file. SEA only runs a single CommonJS script, and this step turns the ES modules into one. Each source file's `import.meta.url` is rewritten to the path the file would have next to the executable, so `../public`, `data/vocabBank15k.json` and `../../.env` resolve as they do in a checkout.
2. `node --experimental-sea-config` writes the blob, and **postject** injects it into a copy of the runner's `node` binary. On macOS the binary is then ad-hoc signed (`codesign -s -`), which Apple Silicon requires.
3. `public/`, `src/data/` and `.env.example` are copied beside it and the folder is archived.

SEA cannot cross-compile, so CI builds on one runner per OS/arch. Each job smoke-tests its own executable: every module must load, and on Linux the server must also start against a real MongoDB and serve `/`.

Why not the alternatives:

- **`pkg` / `@yao-pkg/pkg`**: ESM support is partial and relies on its own transforms. `import.meta.url` in particular needs workarounds. SEA ships with Node itself and is maintained there.
- **Electron**: about 3× larger, and it adds a desktop shell the app does not need. The UI already runs in the browser.

Locally: `npm run build:binary` works with the official Node.js installer or nvm. **Homebrew's `node` cannot be used:** it is a small launcher that links `libnode`, so it has no SEA fuse.

## Signing

The macOS binaries are ad-hoc signed but not notarized, and the Windows ones are unsigned. Users therefore remove the quarantine flag once (`xattr -dr com.apple.quarantine <folder>`) or accept the SmartScreen prompt. Proper signing needs an Apple Developer ID ($99/year) and a Windows code-signing certificate, added as repository secrets.
