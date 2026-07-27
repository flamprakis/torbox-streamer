# Installation Guide — TorBox Streamer 🍿

## Prerequisites

- **Web Browser**: Firefox, Waterfox, LibreWolf, Zen, Google Chrome, Brave, or Microsoft Edge.
- **External Player (Optional)**: [MPV](https://mpv.io) or [VLC](https://www.videolan.org/vlc/) (only needed for 1-click desktop launching).
- **TorBox API Key**: Free API key from your [TorBox Settings](https://torbox.app/settings).

---

## 1. Extension Installation

### Option A: Firefox / Waterfox / LibreWolf / Zen
1. Download `torbox-streamer-firefox-v2.0.2.zip` from [GitHub Releases](https://github.com/flamprakis/torbox-streamer/releases).
2. Open `about:debugging#/runtime/this-firefox` in your browser.
3. Click **"Load Temporary Add-on..."** and select `extension/manifest.json`.

### Option B: Google Chrome / Brave / Chromium / Edge
1. Download `torbox-streamer-chrome-v2.0.2.zip` from [GitHub Releases](https://github.com/flamprakis/torbox-streamer/releases).
2. Extract the zip package to a folder.
3. Open `chrome://extensions` (or `brave://extensions`).
4. Toggle **"Developer mode"** ON in the top-right corner.
5. Click **"Load unpacked"** and select the extracted folder.

---

## 2. Configure Your TorBox API Key

1. Click the **TorBox Streamer** extension icon in your toolbar, or click the ⚙️ **Settings** button in the stream picker modal.
2. Paste your TorBox API key.
3. Select your preferred player mode (`Auto`, `Browser`, `MPV`, or `VLC`).
4. Click **Save**.

---

## 3. Optional: Install MPV / VLC Native Host Launcher

To launch streams directly into **MPV** or **VLC** on your desktop, run the smart installer:

### Linux / macOS
```bash
./helpers/install.sh
```
*If running non-interactively or installing for all detected browsers, run `./helpers/install.sh --all`.*

### Windows
Double-click `helpers/install.bat` (or run `python3 helpers/install.py`).

### Cross-Platform Python Installer
```bash
python3 helpers/install.py
```

The installer auto-detects installed browsers on your system, prompts you to select target browsers (or all detected), and configures the native messaging host manifests automatically!

---

## 4. Run the Automated Tests (Developer Setup)

To verify extension logic and installer configuration locally:

```bash
# Run Vitest unit suite and Playwright Firefox/Chrome E2E suite
npm test

# Build release zip archives
python3 package.py
```

---

## Troubleshooting

| Problem | Solution |
| :--- | :--- |
| **Play button doesn't appear on IMDb / TMDB** | Make sure you are on a valid `/title/ttXXXXXXX` (IMDb) or `/movie/...` / `/tv/...` (TMDB) page. |
| **"MPV helper not found"** | Run `./helpers/install.sh` (Linux/Mac) or `helpers/install.bat` (Windows) and refresh your browser page. |
| **Format codec error in browser player tab** | High-bitrate `.mkv` files require MPV or VLC. Switch player mode to **MPV** or **VLC** in options. |
| **Torrentio returns no results** | Check if your network blocks Cloudflare/Torrentio or set a custom `TORRENTIO_BASE_URL` in Options. |
