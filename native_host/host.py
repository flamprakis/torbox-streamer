#!/usr/bin/env python3
"""
Native Messaging Host for torbox-streamer.

Communicates with the Firefox extension via JSON over stdin/stdout
(4-byte length-prefixed messages, per the WebExtensions native messaging protocol).

Messages FROM the extension:
  {"action": "get_streams", "imdb_id": "tt0111161"}
  {"action": "get_streams", "imdb_id": "tt0903747", "season": 1, "episode": 1}
  {"action": "stream", "hash": "abc123", "file_idx": null}
  {"action": "pick_file", "torrent_id": 123, "file_id": 456}
  {"action": "delete_torrent", "torrent_id": 123}
  {"action": "get_config"}
  {"action": "set_config", "key": "preferred_quality", "value": "720p"}

Messages TO the extension:
  {"status": "ok", "data": {...}}
  {"status": "error", "message": "..."}
  {"status": "progress", "message": "..."}  (intermediate updates)
"""

import json
import struct
import sys
import os
import subprocess
import traceback
from pathlib import Path

# Add parent directory to path so we can import our modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import load_config, save_config, get_api_key
from torrentio_client import TorrentioClient, Stream
from torbox_client import TorBoxClient, TorrentFile, TorrentInfo


# ─── Native Messaging Protocol ─────────────────────────────────────────────

def read_message() -> dict:
    """Read a length-prefixed JSON message from stdin."""
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        sys.exit(0)
    message_length = struct.unpack("=I", raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode("utf-8")
    return json.loads(message)


def send_message(msg: dict):
    """Write a length-prefixed JSON message to stdout."""
    encoded = json.dumps(msg).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def send_ok(data):
    send_message({"status": "ok", "data": data})


def send_error(message: str):
    send_message({"status": "error", "message": message})


def send_progress(message: str):
    send_message({"status": "progress", "message": message})


# ─── State ──────────────────────────────────────────────────────────────────

# Keep clients alive across messages in a session
_config = None
_torbox = None
_torrentio = None
_last_streams: list[Stream] = []


def get_clients():
    """Initialize or return cached clients."""
    global _config, _torbox, _torrentio

    if _config is None:
        _config = load_config()

    if _torbox is None:
        api_key = _config.get("torbox_api_key", "")
        if not api_key:
            api_key = os.environ.get("TORBOX_API_KEY", "")
        if not api_key:
            raise ValueError("No TorBox API key configured")
        _torbox = TorBoxClient(api_key)

    if _torrentio is None:
        _torrentio = TorrentioClient(_config.get("torrentio_base_url", "https://torrentio.strem.fun"))

    return _torbox, _torrentio


# ─── Action Handlers ────────────────────────────────────────────────────────

def handle_get_streams(msg: dict):
    """Fetch streams from Torrentio and check TorBox cache."""
    global _last_streams

    torbox, torrentio = get_clients()
    imdb_id = msg.get("imdb_id", "")
    season = msg.get("season")
    episode = msg.get("episode")

    if not imdb_id:
        send_error("Missing imdb_id")
        return

    send_progress(f"Fetching streams for {imdb_id}...")

    if season and episode:
        streams = torrentio.get_series_streams(imdb_id, int(season), int(episode))
    else:
        streams = torrentio.get_movie_streams(imdb_id)

    if not streams:
        send_error("No streams found. Check your network or try a different Torrentio instance.")
        return

    _last_streams = streams

    send_progress(f"Checking cache for {len(streams)} streams...")

    hashes = [s.info_hash for s in streams]
    cache_status = torbox.check_cached(hashes)

    # Build response data
    results = []
    for s in streams:
        cached = cache_status.get(s.info_hash, False)
        results.append({
            "info_hash": s.info_hash,
            "file_idx": s.file_idx,
            "title": s.title,
            "quality": s.quality,
            "size_bytes": s.size_bytes,
            "size_human": s.size_human,
            "seeders": s.seeders,
            "cached": cached,
        })

    # Sort: cached first, then seeders, then size
    results.sort(key=lambda r: (
        0 if r["cached"] else 1,
        -(r["seeders"] or 0),
        -(r["size_bytes"] or 0),
    ))

    send_ok({
        "imdb_id": imdb_id,
        "season": season,
        "episode": episode,
        "count": len(results),
        "cached_count": sum(1 for r in results if r["cached"]),
        "streams": results[:_config.get("max_results", 20)],
    })


def handle_stream(msg: dict):
    """Add a torrent, wait for ready, pick file, get URL, launch mpv."""
    torbox, _ = get_clients()

    info_hash = msg.get("hash", "")
    file_idx = msg.get("file_idx")  # from Torrentio (for series)
    season = msg.get("season")
    episode = msg.get("episode")

    if not info_hash:
        send_error("Missing hash")
        return

    # Find the stream in our cached list
    stream = None
    for s in _last_streams:
        if s.info_hash == info_hash:
            stream = s
            break

    if not stream:
        send_error("Stream not found in current results")
        return

    # Check cache status
    cache_status = torbox.check_cached([info_hash])
    is_cached = cache_status.get(info_hash, False)

    if is_cached:
        send_progress("✅ Cached — adding torrent (instant)...")
    else:
        send_progress("❌ Not cached — adding torrent (will download)...")

    # Create torrent
    magnet = f"magnet:?xt=urn:btih:{info_hash}"
    torrent_id = torbox.create_torrent(magnet)

    if torrent_id is None:
        # Check if already exists
        existing = torbox.get_torrent_list()
        for t in existing:
            if t.hash.lower() == info_hash:
                torrent_id = t.id
                break
        if torrent_id is None:
            send_error("Failed to add torrent to TorBox")
            return

    # Wait for ready
    if is_cached:
        send_progress("Waiting for cached torrent...")
    else:
        send_progress("Downloading torrent... (this may take a while)")

    torrent_info = torbox.wait_for_torrent_ready(torrent_id, timeout=300, poll_interval=3)

    if torrent_info is None:
        send_error("Timed out waiting for torrent. It's still in your TorBox account — try again later.")
        return

    send_progress(f"Ready! State: {torrent_info.state}")

    # Pick file
    chosen_file = None

    # Try file_idx from Torrentio first
    if file_idx is not None:
        for f in torrent_info.files:
            if f.id == file_idx:
                chosen_file = f
                break

    # Try episode matching for series
    if not chosen_file and season and episode:
        hint = f"s{int(season):02d}e{int(episode):02d}"
        for f in torrent_info.files:
            if hint in f.name.lower():
                chosen_file = f
                break

    # Single file torrent
    if not chosen_file and len(torrent_info.files) == 1:
        chosen_file = torrent_info.files[0]

    # Pick the largest video file as fallback
    if not chosen_file:
        video_exts = (".mkv", ".mp4", ".avi", ".webm", ".mov")
        video_files = [f for f in torrent_info.files if Path(f.name).suffix.lower() in video_exts]
        if video_files:
            chosen_file = max(video_files, key=lambda f: f.size)

    if not chosen_file:
        # Return file list for manual picking
        files_data = [{
            "id": f.id,
            "name": f.name,
            "size_human": f.size_human,
            "is_video": Path(f.name).suffix.lower() in (".mkv", ".mp4", ".avi", ".webm", ".mov"),
        } for f in torrent_info.files]
        send_ok({
            "action": "pick_file",
            "torrent_id": torrent_id,
            "files": files_data,
        })
        return

    # Get stream URL
    send_progress("Getting stream URL...")
    stream_url = torbox.request_download_link(torrent_id, chosen_file.id, use_permalink=True)

    if not stream_url:
        send_error("Failed to get download link from TorBox")
        return

    # Launch mpv
    mpv_path = _config.get("mpv_path", "mpv")
    try:
        subprocess.Popen(
            [mpv_path, "--force-window=yes", stream_url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        send_ok({
            "action": "streaming",
            "file_name": chosen_file.name,
            "file_size": chosen_file.size_human,
            "torrent_id": torrent_id,
            "url": stream_url,
        })
    except FileNotFoundError:
        # mpv not found — return URL for manual use
        send_ok({
            "action": "url_only",
            "file_name": chosen_file.name,
            "file_size": chosen_file.size_human,
            "torrent_id": torrent_id,
            "url": stream_url,
            "warning": f"mpv not found at '{mpv_path}'. Use the URL manually.",
        })


def handle_pick_file(msg: dict):
    """User manually picked a file — get URL and launch mpv."""
    torbox, _ = get_clients()

    torrent_id = msg.get("torrent_id")
    file_id = msg.get("file_id")

    if not torrent_id or not file_id:
        send_error("Missing torrent_id or file_id")
        return

    stream_url = torbox.request_download_link(int(torrent_id), int(file_id), use_permalink=True)
    if not stream_url:
        send_error("Failed to get download link")
        return

    mpv_path = _config.get("mpv_path", "mpv")
    try:
        subprocess.Popen(
            [mpv_path, "--force-window=yes", stream_url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        send_ok({"action": "streaming", "url": stream_url})
    except FileNotFoundError:
        send_ok({"action": "url_only", "url": stream_url})


def handle_delete_torrent(msg: dict):
    """Delete a torrent from the user's account."""
    torbox, _ = get_clients()
    torrent_id = msg.get("torrent_id")
    if not torrent_id:
        send_error("Missing torrent_id")
        return
    success = torbox.delete_torrent(int(torrent_id))
    if success:
        send_ok({"deleted": True})
    else:
        send_error("Failed to delete torrent")


def handle_get_config(msg: dict):
    """Return current config (without exposing API key)."""
    global _config
    if _config is None:
        _config = load_config()
    safe_config = {k: v for k, v in _config.items() if k != "torbox_api_key"}
    safe_config["has_api_key"] = bool(_config.get("torbox_api_key"))
    send_ok(safe_config)


def handle_set_config(msg: dict):
    """Update a config value."""
    global _config
    if _config is None:
        _config = load_config()
    key = msg.get("key", "")
    value = msg.get("value")
    if key and key in _config:
        _config[key] = value
        save_config(_config)
        send_ok({"updated": key, "value": value})
    else:
        send_error(f"Unknown config key: {key}")


# ─── Main Loop ──────────────────────────────────────────────────────────────

HANDLERS = {
    "get_streams": handle_get_streams,
    "stream": handle_stream,
    "pick_file": handle_pick_file,
    "delete_torrent": handle_delete_torrent,
    "get_config": handle_get_config,
    "set_config": handle_set_config,
}


def main():
    while True:
        try:
            msg = read_message()
            action = msg.get("action", "")
            handler = HANDLERS.get(action)
            if handler:
                handler(msg)
            else:
                send_error(f"Unknown action: {action}")
        except Exception as e:
            send_error(f"{type(e).__name__}: {str(e)}")
            # Log full traceback to stderr for debugging
            traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    main()
