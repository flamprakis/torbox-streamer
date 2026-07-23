# TorBox Streamer 🍿

[![Version](https://img.shields.io/badge/version-2.0.1-gold.svg)](https://github.com/flamprakis/torbox-streamer/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Browser Support](https://img.shields.io/badge/browsers-Firefox%20%7C%20Zen%20%7C%20Waterfox%20%7C%20Chrome%20%7C%20Brave-orange.svg)](#installation)
[![TorBox](https://img.shields.io/badge/service-TorBox.app-teal.svg)](https://torbox.app)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/flamprakis)

**Stream movies & TV shows directly from IMDb pages using Torrentio + TorBox in your browser or with MPV / VLC.**

TorBox Streamer is a **pure, self-contained browser extension**. No complex background daemons or terminal commands required for standard in-browser playback!

---

## ✨ Features

- 🍿 **Direct IMDb Integration** — Injects a sleek **"Play Now"** button on movie and TV show IMDb pages.
- ⚡ **Instant Cache Checking** — Queries TorBox cache in parallel to find instantly streamable torrents.
- 🎬 **In-Browser Player Tab** — Built-in dark-themed HTML5 player tab for compatible videos (`.mp4`, `.webm`).
- 📺 **External Player Launcher (MPV & VLC)** — Seamlessly launch streams into **MPV** or **VLC** on Windows, Linux, or macOS.
- 🎛️ **In-Modal Player Switcher** — Toggle between `Auto`, `Browser`, `MPV`, and `VLC` right inside the stream selection modal.
- 📺 **Series Episode Matcher** — Automatically detects season/episode formats (`S01E01`, `1x01`) and picks the matching file.
- 🧹 **File & Account Management** — Automatic trash/`.nfo` file filtering, and 1-click torrent deletion from TorBox when done.
- 💻 **Standalone CLI Included** — Terminal enthusiasts can also stream directly using the included `cli/` tool.

---

## 🚀 Quick Start Guide

### Step 1: Install Browser Extension
1. Download `torbox-streamer-v2.0.0.zip` (or signed `.xpi`) from [GitHub Releases](https://github.com/flamprakis/torbox-streamer/releases).
2. Install in your browser:
   - **Firefox / Zen / Waterfox**: Drag & drop the `.xpi` file into your browser (or load zip via `about:debugging#/runtime/this-firefox`).
   - **Chrome / Brave / Chromium**: Open `chrome://extensions` → Enable **Developer mode** → Click **Load unpacked** → Select the `extension/` folder.
3. Add your free TorBox API Key in the extension options page ([Get API Key](https://torbox.app/settings)).

---

## 🍿 Optional: 1-Click Setup for MPV / VLC Desktop Launching

If you want heavy high-bitrate `.mkv` files, surround sound, or HDR to launch directly into **MPV** or **VLC** on your desktop, run the 1-click setup installer (**Zero Python required!**):

### Windows (1-Click Setup)
1. Download the release files from [GitHub Releases](https://github.com/flamprakis/torbox-streamer/releases).
2. Double-click **`helpers/install.bat`**.

### Linux & macOS (1-Click Setup)
Run the setup script in your terminal:
```bash
./helpers/install.sh
```

Now, when selecting a stream on IMDb, choose **MPV** or **VLC** from the modal player bar, or set your preference in Extension Options!

---

## 🛠️ Source Setup & Developer Guide (No Prebuilt Binaries)

For developers or users who clone the repository and want to run directly from source code without using prebuilt binaries:

### 1. Clone Repository
```bash
git clone https://github.com/flamprakis/torbox-streamer.git
cd torbox-streamer
```

### 2. Load Extension Source
- **Firefox / Zen / Waterfox**: Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on...** → Select `extension/manifest.json`.
- **Chrome / Brave**: Open `chrome://extensions` → **Load unpacked** → Select `extension/`.

### 3. Register Native Host via Python
Ensure Python 3 is installed, then run:
```bash
python3 helpers/install.py
```
This registers `helpers/native_host.py` directly with your browser's native messaging configuration without needing prebuilt binary files.

---

## 🖥️ Player Mode Comparison

| Mode | Format Support | External Player | Setup |
| :--- | :--- | :--- | :--- |
| **Browser Tab** 🎬 | `.mp4`, `.webm`, `.mov` | None (In-Browser) | **Zero setup required.** Works out of the box! |
| **MPV** 🍿 | All formats (`.mkv`, `.avi`, HDR, etc.) | MPV Player | Run `install.bat` (Windows) or `install.sh` (Linux/Mac). |
| **VLC** 🟧 | All formats (`.mkv`, `.avi`, multi-audio) | VLC Media Player | Run `install.bat` (Windows) or `install.sh` (Linux/Mac). |
| **Auto** ⚡ | Dynamic | Auto-selects | Uses Browser Tab for `.mp4` and MPV/VLC for `.mkv`. |

---

## 📁 Repository Structure

```
torbox-streamer/
├── extension/                  # Pure Browser Extension (v2.0)
│   ├── manifest.json
│   ├── background.js           # Background worker & stream router
│   ├── torbox_api.js           # TorBox JS client & auto file picker
│   ├── content.js              # IMDb page injection & stream picker UI
│   ├── options/                # Extension settings UI
│   └── player/                 # Internal tab video player
├── helpers/                    # MPV / VLC Launcher Helper & Installers
│   ├── install.bat             # 1-Click Windows installer (No Python needed)
│   ├── install.sh              # 1-Click Linux / macOS installer script
│   ├── install.py              # Cross-platform Python source installer
│   └── native_host.py          # Native messaging bridge source
├── cli/                        # Standalone Terminal CLI Tool
│   ├── cli.py                  # Stream directly from terminal
│   ├── torbox_client.py
│   └── config.py
├── package.py                  # Extension release zip builder
└── .github/workflows/          # GitHub Actions matrix build & release workflow
```

---

## 🗺️ Future Roadmap

- [ ] 💬 **Subtitles Support**: Integrated subtitle fetching (OpenSubtitles API / TorBox subs) for in-browser player tab, MPV, and VLC.
- [ ] 🔌 **Multi-Debrid Integration**: Add support for additional debrid services (RealDebrid, AllDebrid, Premiumize) alongside TorBox.
- [ ] 🌐 **Multi-Platform Support**: Expand site injection to TMDB, Trakt, Letterboxd, and AniList.
- [ ] 🎨 **Custom Subtitle Styling**: Configurable font size, language preferences, and subtitle offset controls.

---

## ☕ Support Development

If you find **TorBox Streamer** useful and want to support ongoing development (subtitles, multi-debrid, TMDB support):

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/flamprakis)

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for details.
