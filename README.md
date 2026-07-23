# torbox-streamer v2.0

**IMDb → Torrentio → TorBox** — stream any movie or TV episode directly from IMDb pages in your browser or with MPV.

Now a **pure, self-contained browser extension** (no mandatory local Python scripts or setup required for basic playback).

---

## Features

- 🦊 **Firefox Extension** — "Play Now" button injected directly on IMDb title pages
- ⚡ **Instant Cached Playback** — checks TorBox server cache in parallel before playing
- 🎬 **In-Browser Video Player** — custom dark-themed tab player for direct browser streaming (`.mp4`, `.webm`)
- 🍿 **Optional MPV Launcher** — launch external MPV with one optional helper script
- 📺 **Series & Season Support** — auto-matches episode files with S01E01 pattern detection
- 🎛️ **Quality & Status Filters** — filter by 4K, 1080p, 720p, or Cached Only
- 🧹 **TorBox Account Cleanup** — easily delete streams from your TorBox account when finished
- 💻 **CLI Included** — separate standalone CLI available in `cli/`

---

## Quick Start (Browser Extension)

### 1. Install Extension in Firefox
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select the `extension/manifest.json` file in this repository

### 2. Set Your API Key
1. Go to `about:addons` → **TorBox Streamer** → **Options** (or right click icon → options)
2. Enter your **TorBox API Key** (from [torbox.app/settings](https://torbox.app/settings)) and click **Save**.

### 3. Stream from IMDb!
1. Go to any IMDb page (e.g. [The Shawshank Redemption](https://www.imdb.com/title/tt0111161/))
2. Click the yellow **Play Now** button in the header action bar
3. Select a cached stream — it will open in the in-browser video player tab!

---

## Optional: Launch in MPV Player

If you prefer external MPV playback for high-bitrate MKV files or surround audio:

1. Ensure `mpv` and `python3` are installed on your system.
2. Run the one-time helper installer:
   ```bash
   python3 helpers/install.py
   ```
3. In Extension Options, set **Preferred Player** to `Always MPV` (or leave as `Auto`).

---

## Project Structure

```
torbox-streamer/
├── extension/                  # Pure Browser Extension (v2.0)
│   ├── manifest.json
│   ├── background.js           # Main background worker & stream router
│   ├── torbox_api.js           # TorBox API client in JavaScript
│   ├── content.js              # IMDb page injection & stream picker UI
│   ├── options/                # Extension settings page
│   └── player/                 # Internal tab video player
├── helpers/                    # Optional MPV Launcher Helper
│   ├── install.py              # One-line installer script for Firefox
│   └── mpv_host.py             # Minimal native host bridge (20 lines)
├── cli/                        # Standalone CLI Tool
│   ├── cli.py                  # Stream directly from terminal
│   ├── torbox_client.py
│   └── config.py
└── legacy/                     # v1 Python Native Messaging Host (archived)
```

---

## CLI Usage (Standalone)

The CLI tool remains fully functional in the `cli/` directory:

```bash
cd cli
pip install -r requirements.txt
export TORBOX_API_KEY="your-key-here"

# Movie
python cli.py tt0111161

# Episode
python cli.py tt0903747 1 1
```

---

## License

MIT
