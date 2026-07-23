# Installation Guide

## Prerequisites

- Python 3.10+
- Firefox (or Firefox-based browser)
- mpv media player
- A TorBox API key (from your TorBox dashboard)

---

## 1. Install Python Dependencies

```bash
cd torbox-streamer
pip install -r requirements.txt
```

## 2. Configure Your API Key

Either set the environment variable:
```bash
export TORBOX_API_KEY="your-api-key-here"
```

Or save it permanently:
```bash
python3 -c "
from config import load_config, save_config
c = load_config()
c['torbox_api_key'] = 'YOUR-KEY-HERE'
save_config(c)
print('Saved to ~/.config/torbox-streamer/config.json')
"
```

## 3. Install the Native Messaging Host

```bash
cd native_host
python3 install.py
```

This registers `com.torbox_streamer.host` with Firefox by placing a JSON manifest in:
- **Linux:** `~/.mozilla/native-messaging-hosts/`
- **macOS:** `~/Library/Application Support/Mozilla/NativeMessagingHosts/`
- **Windows:** `%APPDATA%\Mozilla\NativeMessagingHosts\`

### Update the Extension ID

After loading the extension in Firefox (step 5), note its extension ID from
`about:debugging`, then update `EXTENSION_ID` in `native_host/install.py` and re-run:

```bash
python3 install.py
```

## 4. Test the CLI (optional but recommended)

```bash
export TORBOX_API_KEY="your-key"
python3 cli.py tt0111161          # The Shawshank Redemption
python3 cli.py tt0903747 s01e01   # Breaking Bad S01E01
```

## 5. Load the Firefox Extension

### For Development (Temporary)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on..."**
3. Select `extension/manifest.json`
4. Note the **Extension ID** shown (e.g. `torbox-streamer@arena` or a UUID)
5. Update `native_host/install.py` with that ID and re-run `python3 install.py`

### For Permanent Install (Firefox ESR / Developer Edition)

1. Package: `cd extension && zip -r ../torbox-streamer.xpi .`
2. Sign via [addons.mozilla.org](https://addons.mozilla.org/developers/)
   or use `web-ext sign` with Mozilla API credentials
3. Install the signed `.xpi`

## 6. Use It!

1. Navigate to any IMDb title page (e.g. `imdb.com/title/tt0111161`)
2. Click the **TorBox Streamer** toolbar button (play icon)
3. The popup shows available streams — cached ones appear first in green
4. Click a stream → mpv launches automatically

For TV series:
- The popup shows a Season/Episode picker
- Set S/E and click "Go" to fetch episode-specific streams

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Popup says "not on IMDb page" | Make sure you're on a `/title/ttXXXXXXX` URL |
| "Native host disconnected" | Run `python3 native_host/install.py` and reload the extension |
| Torrentio returns no results | It may be Cloudflare-blocked. Try setting `TORRENTIO_BASE_URL` to another instance |
| mpv not found | Set `MPV_PATH` env var or config to the full path (e.g. `/usr/bin/mpv`) |
| Timeout on uncached torrent | Uncached torrents download on TorBox servers first. Wait or try a cached one |
| "Duplicate item" error | The torrent is already in your account. The host handles this automatically |

---

## Project Structure

```
torbox-streamer/
├── cli.py                  # Standalone CLI (no extension needed)
├── torrentio_client.py     # Torrentio/Stremio addon API
├── torbox_client.py        # TorBox torrent API wrapper
├── config.py               # Config management
├── requirements.txt        # Python deps (just requests)
├── README.md               # Overview
├── INSTALL.md              # This file
├── native_host/
│   ├── host.py             # Native messaging host (stdin/stdout JSON)
│   └── install.py          # Registers host with Firefox
└── extension/
    ├── manifest.json       # WebExtension manifest (MV2)
    ├── background.js       # Native messaging bridge
    ├── content.js          # IMDb page detection
    ├── icons/
    │   ├── icon-48.svg
    │   └── icon-96.svg
    └── popup/
        ├── popup.html      # Picker UI
        ├── popup.css       # Dark theme styles
        └── popup.js        # Popup logic
```
