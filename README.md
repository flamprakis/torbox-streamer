# torbox-streamer

**IMDb → Torrentio → TorBox → mpv** — one command to stream any movie or episode.

## Quick Start

```bash
cd torbox-streamer
pip install -r requirements.txt

# Set your API key (saved to ~/.config/torbox-streamer/config.json)
export TORBOX_API_KEY="your-key-here"

# Stream a movie
python cli.py tt0111161

# Stream a series episode
python cli.py tt0903747 1 1
python cli.py tt0903747 s01e01
```

## How It Works

```
IMDb ID (tt1234567)
    │
    ▼
Torrentio API (torrentio.strem.fun)
    │  → list of torrent hashes + metadata
    ▼
TorBox Cache Check (batch, <1s)
    │  → which are instantly available ✅
    ▼
Picker (cached first, sorted by seeders/quality)
    │
    ▼
TorBox: Create Torrent (magnet)
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

## Configuration

Config is stored in `~/.config/torbox-streamer/config.json`.
All settings can be overridden via environment variables:

| Setting | Env Var | Default |
|---------|---------|---------|
| `torbox_api_key` | `TORBOX_API_KEY` | (prompted) |
| `torrentio_base_url` | `TORRENTIO_BASE_URL` | `https://torrentio.strem.fun` |
| `mpv_path` | `MPV_PATH` | `mpv` |
| `max_results` | `MAX_RESULTS` | `20` |
| `auto_pick_best_cached` | `AUTO_PICK_BEST_CACHED` | `false` |
| `preferred_quality` | `PREFERRED_QUALITY` | `1080p` |

## Architecture

```
torbox-streamer/
├── cli.py              # Main entry point & interactive flow
├── torrentio_client.py # Torrentio/Stremio addon API client
├── torbox_client.py    # TorBox torrent API client
├── config.py           # Configuration management
├── requirements.txt
└── README.md
```

## Next Steps (Firefox Extension + Native Host)

1. **Native messaging host** — JSON stdin/stdout bridge wrapping this logic
2. **Firefox extension** — detect IMDb pages, show picker popup, call native host
3. **Background polling** — for uncached torrents, notify when ready

## TorBox API Rate Limits

- Cache check: 300 req/min
- Create torrent (cached): 300 req/min
- Create torrent (uncached): 60 req/hour
- All other endpoints: 300 req/min

## Notes

- Torrentio may be behind Cloudflare — if you get blocked, try a different instance
  or add the `|` sort/quality filter syntax to the base URL
- TorBox permalinks (`redirect=true`) are preferred over CDN links since CDN links expire
- For series, the CLI auto-matches episode filenames (e.g. `s01e01`)
