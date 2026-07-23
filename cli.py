#!/usr/bin/env python3
"""
torbox-streamer CLI — IMDb → Torrentio → TorBox → mpv

Usage:
    python cli.py tt0111161              # movie
    python cli.py tt0903747 1 1          # series S01E01
    python cli.py tt0903747 s01e01       # series (alternate format)
"""

import re
import subprocess
import sys
from pathlib import Path

from config import load_config, get_api_key
from torrentio_client import TorrentioClient, Stream
from torbox_client import TorBoxClient, TorrentFile


# ─── ANSI Colors ───────────────────────────────────────────────────────────

class C:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    CYAN = "\033[96m"
    MAGENTA = "\033[95m"
    BG_GREEN = "\033[42m"
    BG_GREY = "\033[100m"


def colored(text: str, color: str) -> str:
    return f"{color}{text}{C.RESET}"


# ─── IMDb ID Parsing ───────────────────────────────────────────────────────

def parse_imdb_input(raw: str) -> str:
    """Extract tt ID from various formats (URL, raw ID)."""
    # Direct tt ID
    match = re.search(r"(tt\d{7,})", raw)
    if match:
        return match.group(1)
    # IMDb URL
    match = re.search(r"imdb\.com/title/(tt\d{7,})", raw)
    if match:
        return match.group(1)
    return raw


def parse_episode(raw: str) -> tuple[int, int] | None:
    """Parse season/episode from 's01e01' or '1 1' format."""
    # s01e01 format
    match = re.match(r"s(\d+)e(\d+)", raw.lower())
    if match:
        return int(match.group(1)), int(match.group(2))
    return None


# ─── Display Helpers ───────────────────────────────────────────────────────

def print_header(text: str):
    print()
    print(colored(f"━━━ {text} ━━━", C.BOLD + C.CYAN))
    print()


def print_streams(streams: list[Stream], cache_status: dict[str, bool], max_results: int):
    """Print streams sorted: cached first, then by seeders/quality."""
    # Sort: cached first, then by seeders (desc), then by size (desc)
    def sort_key(s: Stream):
        cached = cache_status.get(s.info_hash, False)
        return (
            0 if cached else 1,
            -(s.seeders or 0),
            -(s.size_bytes or 0),
        )

    sorted_streams = sorted(streams, key=sort_key)[:max_results]

    cached_count = sum(1 for s in sorted_streams if cache_status.get(s.info_hash, False))
    print(colored(f"  Found {len(streams)} streams, showing top {len(sorted_streams)}", C.DIM))
    print(colored(f"  ✅ {cached_count} cached | ❌ {len(sorted_streams) - cached_count} uncached", C.DIM))
    print()

    for i, s in enumerate(sorted_streams, 1):
        cached = cache_status.get(s.info_hash, False)
        if cached:
            badge = colored(" ✅ CACHED ", C.GREEN + C.BOLD)
        else:
            badge = colored(" ❌        ", C.DIM)

        quality = colored(f"[{s.quality or '???':>7}]", C.CYAN)
        size = colored(f"{s.size_human:>9}", C.MAGENTA)
        seeders = colored(f"👤{s.seeders or '?':>4}", C.YELLOW)
        title = s.title[:55] if s.title else ""

        num = colored(f" {i:>2})", C.BOLD)
        print(f"  {num} {badge} {quality} {size} {seeders}  {title}")

    print()
    return sorted_streams


def pick_file(files: list[TorrentFile], episode_hint: str = "") -> TorrentFile | None:
    """Let user pick a file from a torrent, or auto-pick for single files."""
    if not files:
        print(colored("  ⚠ No files found in torrent", C.RED))
        return None

    if len(files) == 1:
        f = files[0]
        print(f"  📄 Single file: {f.name} ({f.size_human})")
        return f

    # For series, try to auto-match the episode
    if episode_hint:
        for f in files:
            name_lower = f.name.lower()
            if episode_hint.lower() in name_lower:
                print(f"  📄 Auto-selected: {f.name} ({f.size_human})")
                return f

    # Show file list
    print()
    print(colored("  Files in torrent:", C.BOLD))
    for i, f in enumerate(files, 1):
        # Skip non-video files
        ext = Path(f.name).suffix.lower()
        marker = "🎬" if ext in (".mkv", ".mp4", ".avi", ".webm", ".mov") else "📎"
        print(f"    {i:>3}) {marker} {f.name} ({f.size_human})")

    print()
    while True:
        try:
            choice = input(colored("  Pick file number (or 'q' to cancel): ", C.BOLD)).strip()
            if choice.lower() == "q":
                return None
            idx = int(choice) - 1
            if 0 <= idx < len(files):
                return files[idx]
        except (ValueError, EOFError):
            pass
        print(colored("  Invalid choice, try again.", C.RED))


def launch_mpv(url: str, mpv_path: str = "mpv"):
    """Launch mpv with the stream URL."""
    print()
    print(colored(f"  🚀 Launching mpv...", C.GREEN + C.BOLD))
    print(colored(f"  URL: {url[:80]}...", C.DIM))
    print()

    try:
        subprocess.Popen(
            [mpv_path, "--force-window=yes", url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        print(colored("  ✓ mpv started! Enjoy your stream. 🍿", C.GREEN))
    except FileNotFoundError:
        print(colored(f"  ⚠ mpv not found at '{mpv_path}'.", C.RED))
        print(colored(f"  Stream URL (copy manually):", C.YELLOW))
        print(f"  {url}")


# ─── Main Flow ─────────────────────────────────────────────────────────────

def main():
    # Parse arguments
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    imdb_raw = sys.argv[1]
    imdb_id = parse_imdb_input(imdb_raw)

    season, episode = None, None
    if len(sys.argv) >= 4:
        season, episode = int(sys.argv[2]), int(sys.argv[3])
    elif len(sys.argv) >= 3:
        parsed = parse_episode(sys.argv[2])
        if parsed:
            season, episode = parsed
        else:
            # Maybe they passed season and episode as separate args
            try:
                season, episode = int(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 1
            except (ValueError, IndexError):
                pass

    is_series = season is not None and episode is not None

    # Load config
    config = load_config()
    api_key = get_api_key(config)
    if not api_key:
        print(colored("Error: TorBox API key is required.", C.RED))
        sys.exit(1)

    # Initialize clients
    torrentio = TorrentioClient(config["torrentio_base_url"])
    torbox = TorBoxClient(api_key)

    # Step 1: Fetch streams from Torrentio
    print_header("Fetching streams from Torrentio")
    if is_series:
        print(f"  📺 {imdb_id} — Season {season}, Episode {episode}")
        streams = torrentio.get_series_streams(imdb_id, season, episode)
    else:
        print(f"  🎬 {imdb_id}")
        streams = torrentio.get_movie_streams(imdb_id)

    if not streams:
        print(colored("  No streams found. Try a different IMDb ID or check your network.", C.RED))
        sys.exit(1)

    # Step 2: Check TorBox cache
    print_header("Checking TorBox cache")
    print(f"  Checking {len(streams)} hashes...", end="", flush=True)
    hashes = [s.info_hash for s in streams]
    cache_status = torbox.check_cached(hashes)
    print(" done!")

    # Step 3: Display and pick
    print_header("Select a stream")
    sorted_streams = print_streams(streams, cache_status, config["max_results"])

    # Auto-pick mode
    if config["auto_pick_best_cached"]:
        for s in sorted_streams:
            if cache_status.get(s.info_hash, False):
                print(colored(f"  Auto-picked best cached: {s.quality} {s.size_human}", C.GREEN))
                chosen = s
                break
        else:
            chosen = None
    else:
        chosen = None

    if not chosen:
        while True:
            try:
                choice = input(colored("  Enter number to stream (or 'q' to quit): ", C.BOLD)).strip()
                if choice.lower() == "q":
                    sys.exit(0)
                idx = int(choice) - 1
                if 0 <= idx < len(sorted_streams):
                    chosen = sorted_streams[idx]
                    break
            except (ValueError, EOFError):
                pass
            print(colored("  Invalid choice.", C.RED))

    is_cached = cache_status.get(chosen.info_hash, False)
    print()
    print(colored(f"  Selected: [{chosen.quality}] {chosen.title[:60]}", C.BOLD))
    print(colored(f"  Hash: {chosen.info_hash}", C.DIM))
    print(colored(f"  Cached: {'Yes ✅' if is_cached else 'No ❌ (will download)'}", C.DIM if is_cached else C.YELLOW))

    # Step 4: Add torrent to TorBox
    print_header("Adding torrent to TorBox")
    magnet = chosen.magnet
    print(f"  📡 Sending magnet...")
    torrent_id = torbox.create_torrent(magnet)

    if torrent_id is None:
        # Maybe it's already in the account — try to find it by hash
        print("  Checking if torrent already exists in your account...")
        existing = torbox.get_torrent_list()
        for t in existing:
            if t.hash.lower() == chosen.info_hash:
                torrent_id = t.id
                print(f"  Found existing torrent (id={torrent_id}, state={t.state})")
                break

        if torrent_id is None:
            print(colored("  Failed to add torrent. Exiting.", C.RED))
            sys.exit(1)

    # Step 5: Wait for ready & get file list
    print_header("Waiting for torrent to be ready")
    torrent_info = torbox.wait_for_torrent_ready(torrent_id, timeout=180, poll_interval=3)

    if torrent_info is None:
        print(colored("  ⚠ Timed out waiting for torrent. It may still be downloading.", C.YELLOW))
        print(colored("  You can try again later — the torrent is in your TorBox account.", C.DIM))
        sys.exit(1)

    print(f"\n  ✓ Ready! State: {torrent_info.state}")

    # Step 6: Pick file
    episode_hint = f"s{season:02d}e{episode:02d}" if is_series else ""
    chosen_file = pick_file(torrent_info.files, episode_hint)

    if chosen_file is None:
        print(colored("  Cancelled.", C.YELLOW))
        # Optionally clean up
        cleanup = input("  Delete torrent from TorBox? [y/N]: ").strip().lower()
        if cleanup == "y":
            torbox.delete_torrent(torrent_id)
            print("  Deleted.")
        sys.exit(0)

    # Step 7: Get stream URL
    print_header("Getting stream URL")
    stream_url = torbox.request_download_link(torrent_id, chosen_file.id, use_permalink=True)

    if not stream_url:
        print(colored("  Failed to get download link.", C.RED))
        sys.exit(1)

    print(f"  📄 File: {chosen_file.name}")
    print(f"  📏 Size: {chosen_file.size_human}")

    # Step 8: Launch mpv
    launch_mpv(stream_url, config["mpv_path"])

    # Optional cleanup
    print()
    cleanup = input("  Delete torrent from TorBox after streaming? [y/N]: ").strip().lower()
    if cleanup == "y":
        torbox.delete_torrent(torrent_id)
        print("  Torrent deleted from account.")

    print(colored("\n  Done! 🎉", C.GREEN + C.BOLD))


if __name__ == "__main__":
    main()
