# TorBox Streamer 🍿

[![Version](https://img.shields.io/badge/version-2.0.2-gold.svg)](https://github.com/flamprakis/torbox-streamer/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Browser Support](https://img.shields.io/badge/browsers-Firefox%20%7C%20Waterfox%20%7C%20LibreWolf%20%7C%20Zen%20%7C%20Chrome%20%7C%20Brave%20%7C%20Edge-orange.svg)](#installation)
[![TorBox](https://img.shields.io/badge/service-TorBox.app-teal.svg)](https://torbox.app)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/flamprakis)

**Stream movies & TV shows directly from IMDb and TMDB pages using Torrentio + TorBox in your browser or with MPV / VLC.**

TorBox Streamer is a **pure, self-contained browser extension**. No complex background daemons or terminal commands required for standard in-browser playback!

---

## ✨ Features

- 🍿 **Direct IMDb & TMDB Integration** — Injects a sleek **"Play Now"** action button on movie and TV show title pages.
- ⚡ **Instant Cache Checking** — Queries TorBox cache in parallel to find instantly streamable torrents.
- 🎬 **In-Browser Player Tab** — Built-in dark-themed HTML5 player tab for compatible videos (`.mp4`, `.webm`).
- 💬 **Subtitle Engine & OpenSubtitles** — Automatic WebVTT subtitle track rendering, BOM sanitation, language selection, and OpenSubtitles API integration.
- 📺 **External Player Launcher (MPV & VLC)** — Seamlessly launch high-bitrate streams into **MPV** or **VLC** on Linux, macOS, or Windows with subtitle passthrough.
- 🎛️ **In-Modal Player & Quality Switcher** — Toggle between `Auto`, `Browser`, `MPV`, `VLC`, and select quality buckets (`4K`, `1080p`, `720p`, `480p`) inside the stream selection modal.
- ⚙️ **Custom Quality Mixer & Options** — Configure custom resolution distribution and preferred subtitle languages in extension settings.
- 📦 **Smart Multi-File Torrent Selection** — Intelligently resolves specific movie titles (e.g., IMDb Top 250 collection packs) and series episodes (`S01E05`) without downloading raw `.zip` archives.
- 🧹 **File & Account Management** — Automatic trash/`.nfo` filtering, and 1-click torrent deletion from TorBox when done.
- 🌐 **Cross-Browser Support** — Promisified storage wrapper supporting Firefox, Waterfox, LibreWolf, Zen Browser, Google Chrome, Brave, and Edge.
- 💻 **Standalone CLI Included** — Terminal enthusiasts can also stream directly using the included `cli/` tool.

---

## 🚀 Quick Start Guide

### Step 1: Install Extension
Download the appropriate release package from [GitHub Releases](https://github.com/flamprakis/torbox-streamer/releases):

- **Firefox / Waterfox / LibreWolf / Zen**:
  - Install directly from [Firefox Add-ons (AMO)](https://addons.mozilla.org) or download `torbox-streamer-firefox-v2.0.2.zip`.
  - Open `about:debugging#/runtime/this-firefox` → Click **Load Temporary Add-on...** → Select `manifest.json`.
- **Chrome / Brave / Chromium / Edge**:
  - Download `torbox-streamer-chrome-v2.0.2.zip` and extract it.
  - Open `chrome://extensions` → Enable **Developer mode** → Click **Load unpacked** → Select the extracted folder.

### Step 2: Configure API Key
Open extension settings by clicking the ⚙️ icon or the extension toolbar icon, and enter your free TorBox API Key ([Get API Key](https://torbox.app/settings)).

---

## 🍿 Optional: 1-Click Setup for MPV / VLC Desktop Launching

If you want heavy high-bitrate `.mkv` files, surround sound, or HDR to launch directly into **MPV** or **VLC** on your desktop, run the smart auto-detect installer:

### Linux / macOS (Smart Setup)
Run the setup script in your terminal:
```bash
./helpers/install.sh
```

### Windows (Smart Setup)
Double-click **`helpers/install.bat`** (or run `python3 helpers/install.py`).

The installer auto-detects installed browsers on your system and configures native host manifests for Firefox and Chrome families automatically!

---

## 🛠️ Source Setup & Developer Guide

For developers who clone the repository and want to run directly from source:

```bash
git clone https://github.com/flamprakis/torbox-streamer.git
cd torbox-streamer

# Run automated Vitest unit suite (35 unit tests) and Playwright Firefox/Chrome E2E suite (4 tests)
npm test

# Build release zip assets in build/
python3 package.py
```

---

## 🖥️ Player Mode Comparison

| Mode | Format Support | External Player | Setup |
| :--- | :--- | :--- | :--- |
| **Browser Tab** 🎬 | `.mp4`, `.webm`, `.mov` | None (In-Browser) | **Zero setup required.** Works out of the box! Includes subtitle track picker. |
| **MPV** 🍿 | All formats (`.mkv`, `.avi`, HDR, etc.) | MPV Player | Run `install.sh` (Linux/Mac) or `install.bat` (Windows). |
| **VLC** 🟧 | All formats (`.mkv`, `.avi`, multi-audio) | VLC Media Player | Run `install.sh` (Linux/Mac) or `install.bat` (Windows). |
| **Auto** ⚡ | Dynamic | Auto-selects | Uses Browser Tab for `.mp4` and MPV/VLC for `.mkv`. |

---

## 📁 Repository Structure

```
torbox-streamer/
├── extension/                  # Pure WebExtension Source
│   ├── manifest.json
│   ├── background.js           # Background worker & stream router
│   ├── torbox_api.js           # TorBox JS client & auto file picker
│   ├── subtitles_api.js        # Subtitle parser & OpenSubtitles client
│   ├── content.js              # IMDb & TMDB page injection UI
│   ├── options/                # Promisified extension settings UI
│   └── player/                 # Internal tab player & subtitle engine
├── helpers/                    # MPV / VLC Launcher Helper & Installers
│   ├── install.sh              # Bash installer with browser auto-detection
│   ├── install.bat             # Windows batch installer & registry setup
│   ├── install.py              # Cross-platform Python installer & CLI flags
│   └── native_host.py          # Native messaging bridge source
├── tests/                      # Automated Test Framework
│   ├── unit/                   # Vitest unit test suite (35 tests)
│   └── e2e/                    # Playwright Firefox & Chromium E2E suite
├── cli/                        # Standalone Terminal CLI Tool
├── package.py                  # Dual release zip builder (Firefox MV2 & Chrome MV3)
└── .github/workflows/          # GitHub Actions CI matrix workflow
```

---

## 🗺️ Feature Roadmap

- [x] 🍿 **v2.0.0** — IMDb injection & Pure Extension architecture
- [x] 🌐 **v2.0.1** — TMDB site integration & Playwright testing framework
- [x] ⚡ **v2.0.2** — Multi-browser auto-detection installer & dual Firefox (MV2) / Chrome (MV3) packaging
- [x] 💬 **v2.0.3** — **Subtitles & Multi-File Engine**: In-browser WebVTT subtitle renderer, OpenSubtitles API integration, custom quality bucket mixer, and smart multi-file collection auto-picker
- [ ] 📺 **v2.1.0** — **Trakt Integration**: Trakt OAuth2 login and watch status scrobbling
- [ ] 🔌 **v2.2.0** — **Multi-Debrid**: Support RealDebrid, AllDebrid, and Premiumize alongside TorBox

---

## ☕ Support Development

If you find **TorBox Streamer** useful and want to support ongoing development:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/flamprakis)

---

## 📜 License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for details.
Copyright (c) 2026 flamprakis.
