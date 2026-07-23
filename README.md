# torbox-streamer

**IMDb → Torrentio → TorBox → mpv** — stream any movie or TV episode in one command, or straight from IMDb pages with the Firefox extension.

## Features

- 🎬 **CLI** — stream directly from your terminal with an IMDb ID
- 🦊 **Firefox Extension** — "Play Now" button injected on IMDb pages with an in-page modal picker
- ⚡ **Instant Cached Playback** — TorBox cache check shows which torrents are immediately available
- 📺 **Series Support** — auto-matches episode files (S01E01 pattern matching)
- 🎛️ **Quality Filters** — filter by resolution, cached status
- 🧹 **Cleanup** — delete torrents from your TorBox account after streaming

## Quick Start (CLI)

```bash
git clone https://github.com/your-user/torbox-streamer.git
cd torbox-streamer
pip install -r requirements.txt

# Set your TorBox API key (get one from https://torbox.app)
export TORBOX_API_KEY="your-key-here"

# Stream a movie
python cli.py tt0111161              # The Shawshank Redemption

# Stream a series episode
python cli.py tt0903747 1 1          # Breaking Bad S01E01
python cli.py tt0903747 s01e01       # alternate format
```

## How It Works

```
IMDb ID (tt1234567)
    │
    ▼
Torrentio API (torrentio.strem.fun)
    │  → list of torrent hashes + metadata
    ▼
TorBox Cache Check (batched, <1s)
    │  → which are instantly available ✅
    ▼
Picker (cached first, sorted by seeders/quality)
    │
    ▼
TorBox: Create Torrent (magnet link)
    │  → instant if cached, downloads if not
    ▼
TorBox: Pick File (for series → auto-matches episode)
    │
    ▼
TorBox: Get Stream URL (permalink)
    │
    ▼
mpv 🎬
```

The Firefox extension follows the same flow but fetches Torrentio streams from the browser context (bypassing Cloudflare), while TorBox API calls go through a native messaging host.

## Firefox Extension

The extension adds a **"Play Now"** button to IMDb title pages and opens a modal stream picker directly on the page.

### Setup

1. Install Python dependencies: `pip install -r requirements.txt`
2. Register the native messaging host:
   ```bash
   cd native_host
   python3 install.py
   ```
3. Load the extension in Firefox:
   - Go to `about:debugging#/runtime/this-firefox`
   - Click **"Load Temporary Add-on..."**
   - Select `extension/manifest.json`
4. Note the Extension ID from `about:debugging`, update `EXTENSION_ID` in `native_host/install.py`, and re-run `python3 install.py`

See [INSTALL.md](INSTALL.md) for detailed setup instructions including permanent install via signed `.xpi`.

## Configuration

Config is stored in `~/.config/torbox-streamer/config.json` and can be overridden with environment variables:

| Setting | Env Var | Default | Description |
|---------|---------|---------|-------------|
| `torbox_api_key` | `TORBOX_API_KEY` | *(prompted on first run)* | Your TorBox API key |
| `torrentio_base_url` | `TORRENTIO_BASE_URL` | `https://torrentio.strem.fun` | Torrentio instance URL |
| `mpv_path` | `MPV_PATH` | `mpv` | Path to mpv binary |
| `max_results` | `MAX_RESULTS` | `20` | Max streams to display |
| `auto_pick_best_cached` | `AUTO_PICK_BEST_CACHED` | `false` | Auto-select best cached stream (CLI) |

## Project Structure

```
torbox-streamer/
├── cli.py                  # Standalone CLI entry point
├── torrentio_client.py     # Torrentio/Stremio addon API client
├── torbox_client.py        # TorBox torrent API client
├── config.py               # Config management (JSON + env vars)
├── requirements.txt        # Python dependencies (requests)
├── native_host/
│   ├── host.py             # Native messaging host (stdin/stdout JSON bridge)
│   └── install.py          # Registers host manifest with Firefox
└── extension/
    ├── manifest.json       # WebExtension manifest (MV2)
    ├── background.js       # Torrentio fetch + native message routing
    ├── content.js          # IMDb page detection, button injection, modal UI
    ├── icons/
    │   ├── icon-48.svg
    │   └── icon-96.svg
    └── popup/
        ├── popup.html      # Popup UI (alternative to in-page modal)
        ├── popup.css
        └── popup.js
```

## Prerequisites

- **Python 3.10+**
- **mpv** media player ([install guide](https://mpv.io/installation/))
- **TorBox account** with API key ([torbox.app](https://torbox.app))
- **Firefox** (for the extension)

## Packaging & Distribution

### For pip users (recommended)

If you want others to install with `pip install torbox-streamer`, add a `pyproject.toml`:

```bash
pip install torbox-streamer
torbox-streamer tt0111161
```

See the packaging section below for setup instructions.

### Creating a `pyproject.toml`

Create a `pyproject.toml` in the project root to make this pip-installable:

```toml
[build-system]
requires = ["setuptools>=68.0", "wheel"]
build-backend = "setuptools.backends._legacy:_Backend"

[project]
name = "torbox-streamer"
version = "1.0.0"
description = "Stream movies and TV shows via Torrentio + TorBox + mpv"
readme = "README.md"
license = {text = "MIT"}
requires-python = ">=3.10"
dependencies = ["requests>=2.28.0"]

[project.scripts]
torbox-streamer = "cli:main"

[tool.setuptools.packages.find]
include = ["*.py"]
```

Then users install with:
```bash
pip install .                    # local install
pip install -e .                 # editable/dev install
torbox-streamer tt0111161        # run from anywhere
```

To publish to PyPI:
```bash
pip install build twine
python -m build
twine upload dist/*
```

### Docker (CLI only)

```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y mpv && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py .
ENTRYPOINT ["python", "cli.py"]
```

```bash
docker build -t torbox-streamer .
docker run -e TORBOX_API_KEY="your-key" torbox-streamer tt0111161
```

> **Note:** Docker won't easily launch mpv with a display. This is best for headless use or getting the stream URL only.

### Firefox Extension (`.xpi`)

To distribute the extension:
```bash
cd extension
zip -r ../torbox-streamer.xpi .
```

For public distribution, sign it via [addons.mozilla.org](https://addons.mozilla.org/developers/) or use `web-ext sign`.

## TorBox API Rate Limits

| Endpoint | Limit |
|----------|-------|
| Cache check | 300 req/min |
| Create torrent (cached) | 300 req/min |
| Create torrent (uncached) | 60 req/hour |
| All other endpoints | 300 req/min |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Native host disconnected" | Run `python3 native_host/install.py` and reload extension |
| Torrentio returns no results | May be Cloudflare-blocked — try a different `TORRENTIO_BASE_URL` |
| mpv not found | Set `MPV_PATH` to the full path (e.g. `/usr/bin/mpv`) |
| Timeout on uncached torrent | Uncached torrents download on TorBox servers first — try a cached one |
| "Duplicate item" error | Torrent already in your account — handled automatically |
| Popup shows nothing on click | The toolbar button only works on IMDb `/title/` pages |

## Notes

- Torrentio may be behind Cloudflare — if blocked from CLI, try the Firefox extension (it fetches from browser context, which bypasses Cloudflare)
- TorBox permalinks (`redirect=true`) are preferred over CDN links since CDN links expire
- For series, both CLI and extension auto-match episode filenames (e.g. `s01e01`)
- The native messaging host logs to `~/.config/torbox-streamer/host_debug.log` for debugging
