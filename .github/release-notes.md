## Download

| Your computer | File |
|---|---|
| Mac with Apple Silicon (M1–M4) | `omnilang-macos-arm64.tar.gz` |
| Mac with Intel CPU | `omnilang-macos-x64.tar.gz` |
| Windows PC | `omnilang-windows-x64.zip` |
| Windows on ARM (Snapdragon, Surface Pro X) | `omnilang-windows-arm64.zip` |
| Linux PC / server | `omnilang-linux-x64.tar.gz` |
| Raspberry Pi 4/5, ARM Linux | `omnilang-linux-arm64.tar.gz` |

Each archive holds one `omnilang` executable (Node.js is built in) plus the web app (`public/`) and the 15k word bank (`src/data/`). Keep them together in one folder.

## You still need

The executable is the OmniLang server only. These run separately on the same machine:

- **MongoDB** on `127.0.0.1:27017`, for example `docker run -d --name omnilang-mongo -p 27017:27017 -v omnilang-data:/data/db mongo:7`
- **Ollama** on `127.0.0.1:11434` ([ollama.com](https://ollama.com)), then `ollama pull mistral-nemo:12b`

## Run

- **macOS:** unpack, then in Terminal: `xattr -dr com.apple.quarantine omnilang-macos-arm64 && ./omnilang-macos-arm64/omnilang`. The binary is ad-hoc signed, not notarized, so the quarantine flag has to be removed once.
- **Windows:** unzip and double-click `omnilang.exe`. SmartScreen may warn about an unknown publisher: *More info → Run anyway*.
- **Linux:** `tar xzf omnilang-linux-*.tar.gz && ./omnilang-linux-*/omnilang`

Then open http://localhost:5001. To change the port, the model or `MONGO_URI`, copy `.env.example` to `.env` in the same folder and edit it.

`SHA256SUMS.txt` lists the checksums of all archives.
