#!/usr/bin/env python3
"""
Tiny Native Host for TorBox Streamer — MPV Launcher only.
No API keys, no logic, no state. Just receives launch_mpv action and runs mpv.
"""

import json
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
                cmd = [player, "--force-window=yes", url]

                subprocess.Popen(
                    cmd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                send_message({"status": "ok"})
            else:
                send_message({"status": "error", "message": f"Unknown action {action}"})

        except Exception as e:
            send_message({"status": "error", "message": str(e)})


if __name__ == "__main__":
    main()
