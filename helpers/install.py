#!/usr/bin/env python3
"""
Installer script for the optional mpv launcher native helper.
Registers com.torbox_streamer.host with Firefox / Chrome.
"""

import json
import os
import sys
from pathlib import Path

HOST_NAME = "com.torbox_streamer.host"
SCRIPT_DIR = Path(__file__).resolve().parent
HOST_PATH = SCRIPT_DIR / "mpv_host.py"

MANIFEST_CONTENT = {
    "name": HOST_NAME,
    "description": "TorBox Streamer MPV Native Launcher",
    "path": str(HOST_PATH),
    "type": "stdio",
    "allowed_extensions": [
        "torbox-streamer@arena"
    ]
}


def install_firefox():
    if sys.platform == "linux":
        target_dir = Path.home() / ".mozilla" / "native-messaging-hosts"
    elif sys.platform == "darwin":
        target_dir = Path.home() / "Library" / "Application Support" / "Mozilla" / "NativeMessagingHosts"
    elif sys.platform == "win32":
        target_dir = Path(os.environ.get("APPDATA", "")) / "Mozilla" / "NativeMessagingHosts"
    else:
        print(f"Unsupported platform: {sys.platform}")
        return

    target_dir.mkdir(parents=str(target_dir), exist_ok=True)
    manifest_file = target_dir / f"{HOST_NAME}.json"

    # Ensure executable permissions on script
    HOST_PATH.chmod(0o755)

    with open(manifest_file, "w") as f:
        json.dump(MANIFEST_CONTENT, f, indent=2)

    print(f"✅ Installed Native Helper manifest for Firefox at:\n   {manifest_file}")


def main():
    print(f"Installing optional MPV launcher helper for TorBox Streamer...")
    install_firefox()
    print("Done! You can now select 'Always MPV' or use MPV playback in TorBox Streamer options.")


if __name__ == "__main__":
    main()
