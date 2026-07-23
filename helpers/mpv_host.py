#!/usr/bin/env python3
"""
Native Host Launcher for TorBox Streamer.
Supports launching external players (MPV, VLC) across Linux, macOS, and Windows.
"""

import json
import os
import shutil
import struct
import subprocess
import sys

LOG_FILE = os.path.join(os.path.expanduser("~"), ".torbox_mpv_host.log")


def log(msg):
    try:
        with open(LOG_FILE, "a") as f:
            f.write(f"{msg}\n")
    except Exception:
        pass


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length or len(raw_length) < 4:
        sys.exit(0)
    message_length = struct.unpack("=I", raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode("utf-8")
    return json.loads(message)


def send_message(message):
    encoded = json.dumps(message).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def find_player_executable(player):
    player = (player or "mpv").lower()

    if player == "vlc":
        # Windows paths
        win_program_files = os.environ.get("ProgramFiles", "C:\\Program Files")
        win_program_files_x86 = os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")
        possible_paths = [
            shutil.which("vlc"),
            "/usr/bin/vlc",
            "/usr/local/bin/vlc",
            "/snap/bin/vlc",
            "/Applications/VLC.app/Contents/MacOS/VLC",
            os.path.join(win_program_files, "VideoLAN", "VLC", "vlc.exe"),
            os.path.join(win_program_files_x86, "VideoLAN", "VLC", "vlc.exe"),
        ]
    else: # mpv
        win_program_files = os.environ.get("ProgramFiles", "C:\\Program Files")
        possible_paths = [
            shutil.which("mpv"),
            "/usr/bin/mpv",
            "/usr/local/bin/mpv",
            "/snap/bin/mpv",
            "/Applications/mpv.app/Contents/MacOS/mpv",
            os.path.join(win_program_files, "mpv", "mpv.exe"),
        ]

    for path in possible_paths:
        if path and os.path.isfile(path):
            return path

    return player


def main():
    log("=== torbox native host started ===")
    while True:
        try:
            msg = read_message()
            action = msg.get("action")
            player = msg.get("player", "mpv")
            url = msg.get("url")

            log(f"Received action: {action}, player: {player}")

            if action in ("launch_mpv", "launch_vlc", "launch_player"):
                if not url:
                    send_message({"status": "error", "message": "No URL provided"})
                    continue

                if action == "launch_vlc":
                    player = "vlc"
                elif action == "launch_mpv":
                    player = "mpv"

                player_bin = find_player_executable(player)
                log(f"Found binary: {player_bin}")

                if player == "vlc":
                    cmd = [player_bin, url]
                else:
                    cmd = [player_bin, "--force-window=yes", url]

                log(f"Running cmd: {cmd}")

                kwargs = {
                    "stdin": subprocess.DEVNULL,
                    "stdout": subprocess.DEVNULL,
                    "stderr": subprocess.DEVNULL,
                }
                if sys.platform != "win32":
                    kwargs["start_new_session"] = True

                proc = subprocess.Popen(cmd, **kwargs)
                log(f"Spawned process PID: {proc.pid}")
                send_message({"status": "ok", "player": player, "bin": player_bin})
            else:
                send_message({"status": "error", "message": f"Unknown action {action}"})

        except Exception as e:
            log(f"Exception in main: {e}")
            send_message({"status": "error", "message": str(e)})


if __name__ == "__main__":
    main()
