#!/usr/bin/env python3
import json
import os
import shutil
import struct
import subprocess
import sys


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


def find_mpv_executable(player_param):
    if player_param and os.path.isabs(player_param) and os.path.isfile(player_param):
        return player_param
    found = shutil.which(player_param or "mpv")
    if found:
        return found
    for fallback in ["/usr/bin/mpv", "/usr/local/bin/mpv", "/snap/bin/mpv"]:
        if os.path.isfile(fallback):
            return fallback
    return player_param or "mpv"


def main():
    while True:
        try:
            msg = read_message()
            action = msg.get("action")

            if action == "launch_mpv":
                url = msg.get("url")
                if not url:
                    send_message({"status": "error", "message": "No URL provided"})
                    continue

                player = msg.get("player", "mpv")
                mpv_bin = find_mpv_executable(player)
                cmd = [mpv_bin, "--force-window=yes", url]

                subprocess.Popen(
                    cmd,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                )
                send_message({"status": "ok"})
            else:
                send_message({"status": "error", "message": f"Unknown action {action}"})

        except Exception as e:
            send_message({"status": "error", "message": str(e)})


if __name__ == "__main__":
    main()
