# TorBox Streamer 🍿

[![Version](https://img.shields.io/badge/version-2.0.0-gold.svg)](https://github.com/flamprakis/torbox-streamer/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Browser Support](https://img.shields.io/badge/browsers-Firefox%20%7C%20Waterfox%20%7C%20Chrome%20%7C%20Brave-orange.svg)](#installation)
[![TorBox](https://img.shields.io/badge/service-TorBox.app-teal.svg)](https://torbox.app)

**Stream movies & TV shows directly from IMDb pages using Torrentio + TorBox in your browser or with MPV / VLC.**

TorBox Streamer is a **pure, self-contained browser extension**. No complex servers or local Python background daemons required for standard browser playback!

---

## ✨ Features

- 🍿 **Direct IMDb Integration** — Injects a sleek **"Play Now"** button on movie and TV show IMDb pages.
- ⚡ **Instant Cache Checking** — Queries TorBox cache in parallel to find instantly streamable torrents.
- 🎬 **In-Browser Player Tab** — Built-in dark-themed HTML5 player tab for compatible videos (`.mp4`, `.webm`).
- 📺 **External Player Launcher (MPV & VLC)** — Seamlessly launch streams into **MPV** or **VLC** on Linux, macOS, or Windows with an optional 20-line helper.
- 🎛️ **In-Modal Player Switcher** — Toggle between `Auto`, `Browser`, `MPV`, and `VLC` right inside the stream selection modal.
- 📺 **Series Episode Matcher** — Automatically detects season/episode formats (`S01E01`, `1x01`) and picks the matching file.
- 🧹 **File & Account Management** — Automatic trash/`.nfo` file filtering, and 1-click torrent deletion from TorBox when done.
- 💻 **Standalone CLI Included** — Terminal enthusiasts can also stream directly using the included `cli/` tool.

---

## 🚀 Quick Start Guide

### Option A: Install from GitHub Release (Recommended)

1. Download `torbox-streamer-v2.0.0.zip` from [GitHub Releases](https://github.com/flamprakis/torbox-streamer/releases).
2. Open your browser's extension debugging page:
   - **Firefox / Waterfox / LibreWolf**: Navigate to `about:debugging#/runtime/this-firefox` → Click **Load Temporary Add-on...** → Select the `.zip` file (or `manifest.json`).
   - **Chrome / Brave / Chromium**: Navigate to `chrome://extensions` → Enable **Developer mode** → Click **Load unpacked** → Select the `extension/` folder.

### Option B: Load Source Code directly

```bash
git clone https://github.com/flamprakis/torbox-streamer.git
```
Then load the `extension/` directory in your browser's Developer / Debugging page.

---

## ⚙️ Configuration (API Key)

1. Get your free API Key from your [TorBox.app Settings](https://torbox.app/settings).
2. Right-click the **TorBox Streamer** extension icon → **Options** (or open options from your browser's extension settings).
3. Paste your **TorBox API Key** and click **Save**.

---

## 🍿 Optional: Enable MPV / VLC External Launching

If you want high-bitrate `.mkv` files, surround sound, or HDR to launch directly into **MPV** or **VLC**:

1. Ensure **MPV** or **VLC** and **Python 3** are installed on your computer.
2. Run the one-command native helper installer script:
   ```bash
   python3 helpers/install.py
   ```
   *This automatically registers the helper for Firefox, Waterfox, LibreWolf, Chrome, Brave, and Chromium on Linux, macOS, and Windows.*

3. Now, when selecting a stream on IMDb, choose **MPV** or **VLC** from the modal player bar, or set your preference in Extension Options!

---

## 🖥️ Player Mode Comparison

| Mode | Format Support | External Player | Notes |
| :--- | :--- | :--- | :--- |
| **Browser Tab** 🎬 | `.mp4`, `.webm`, `.mov` | None (In-Browser) | Zero setup required. Dark custom tab player. |
| **MPV** 🍿 | All formats (`.mkv`, `.avi`, HDR, etc.) | MPV Player | Requires running `helpers/install.py` once. |
| **VLC** 🟧 | All formats (`.mkv`, `.avi`, multi-audio) | VLC Media Player | Great for Windows users. Requires `helpers/install.py`. |
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
├── helpers/                    # Optional MPV / VLC Launcher Helper
│   ├── install.py              # Cross-browser native host installer
│   └── mpv_host.py             # Lightweight native player bridge
├── cli/                        # Standalone Terminal CLI Tool
│   ├── cli.py                  # Stream directly from terminal
│   ├── torbox_client.py
│   └── config.py
├── package.py                  # Automated extension release builder
└── .github/workflows/          # GitHub Actions CI release workflow
```

---

## ❓ Troubleshooting & FAQ

<details>
<summary><b>The "Open Settings" button or Play Now doesn't do anything</b></summary>
Ensure you have saved a valid TorBox API key in the extension options page.
</details>

<details>
<summary><b>It launched an .nfo file or sample video in previous versions</b></summary>
v2.0 includes an intelligent file auto-picker that filters out non-video files (`.nfo`, `.txt`, `.jpg`, `.srt`) and picks the main movie file or matching episode.
</details>

<details>
<summary><b>Helper script error when clicking MPV or VLC</b></summary>
Make sure you ran <code>python3 helpers/install.py</code> and that MPV or VLC is installed on your system.
</details>

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for details.
