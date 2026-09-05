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
from urllib.parse import urlsplit

LOG_FILE = os.environ.get(
    "TORBOX_NATIVE_LOG_PATH", os.path.join(os.path.expanduser("~"), ".torbox_mpv_host.log")
)
MAX_MESSAGE_BYTES = 1024 * 1024


class ProtocolError(ValueError):
    """An invalid frame after which the input cannot safely be resynchronized."""


def log(msg):
    try:
        with open(LOG_FILE, "a") as f:
            f.write(f"{msg}\n")
    except Exception:
        pass


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    if len(raw_length) != 4:
        raise ProtocolError("Incomplete message length")
    message_length = struct.unpack("=I", raw_length)[0]
    if not 0 < message_length <= MAX_MESSAGE_BYTES:
        raise ProtocolError("Message size must be between 1 byte and 1 MiB")
    message = sys.stdin.buffer.read(message_length)
    if len(message) != message_length:
        raise ProtocolError("Incomplete message payload")
    value = json.loads(message.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Message must be a JSON object")
    return value


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


def validate_url(value, label="URL"):
    if not isinstance(value, str) or any(c in value for c in "\r\n\0"):
        raise ValueError(f"{label} must be an HTTP or HTTPS URL")
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError(f"{label} must be an HTTP or HTTPS URL")
    return value


def launch_player(msg):
    action = msg.get("action")
    if action not in ("launch_mpv", "launch_vlc", "launch_player"):
        raise ValueError("Unknown action")
    player = {"launch_mpv": "mpv", "launch_vlc": "vlc"}.get(action, msg.get("player", "mpv"))
    if not isinstance(player, str) or player.lower() not in ("mpv", "vlc"):
        raise ValueError("Unsupported player; choose mpv or vlc")
    player = player.lower()
    if not msg.get("url"):
        raise ValueError("No URL provided")
    url = validate_url(msg["url"])

    custom_path = msg.get("custom_path")
    if custom_path:
        if not isinstance(custom_path, str) or not os.path.isfile(custom_path):
            raise ValueError("Custom player executable does not exist")
        player_bin = custom_path
    else:
        player_bin = find_player_executable(player)

    subtitles = msg.get("subtitles") or []
    if isinstance(subtitles, str):
        subtitles = [subtitles]
    if not isinstance(subtitles, list):
        raise ValueError("Subtitles must be a URL or a list of URLs")
    subtitles = [validate_url(sub, "Subtitle") for sub in subtitles[:5]]

    headers = msg.get("headers") or {}
    if not isinstance(headers, dict) or any(
        not isinstance(key, str) or not isinstance(value, str)
        or any(c in key + value for c in "\r\n\0")
        for key, value in headers.items()
    ):
        raise ValueError("Headers must contain string names and values without line breaks")

    if player == "vlc":
        cmd = [player_bin, url]
        for sub in subtitles[:3]:
            cmd.extend([f"--sub-file={sub}", f"--input-slave={sub}"])
        for name, flag in (("User-Agent", "--http-user-agent"), ("Referer", "--http-referrer")):
            if name in headers:
                cmd.append(f"{flag}={headers[name]}")
    else:
        cmd = [player_bin, "--force-window=yes", url]
        cmd.extend(f"--sub-file={sub}" for sub in subtitles)
        if headers:
            cmd.append("--http-header-fields=" + ",".join(f"{key}: {value}" for key, value in headers.items()))

    env = os.environ.copy()
    env.update(QT_LOGGING_RULES="*.debug=false;qt.dbusmenu=false", NO_AT_BRIDGE="1")
    kwargs = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "env": env,
    }
    if sys.platform != "win32":
        kwargs["start_new_session"] = True
    proc = subprocess.Popen(cmd, **kwargs)
    # Stream URLs and HTTP headers can contain API tokens. Never log arguments.
    log(f"Launched {player}, PID: {proc.pid}")
    return {"status": "ok", "player": player, "bin": player_bin}


def main():
    log("=== torbox native host started ===")
    while True:
        try:
            msg = read_message()
            if msg is None:
                return
            send_message(launch_player(msg))
        except ProtocolError as error:
            send_message({"status": "error", "message": str(error)})
            return
        except Exception as error:
            log(f"Request failed: {type(error).__name__}")
            send_message({"status": "error", "message": str(error)})


if __name__ == "__main__":
    main()
