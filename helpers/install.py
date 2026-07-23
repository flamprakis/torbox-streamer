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
HOST_PATH = SCRIPT_DIR / "native_host.py"

MANIFEST_CONTENT = {
    "name": HOST_NAME,
    "description": "TorBox Streamer External Player Launcher",
    "path": str(HOST_PATH),
    "type": "stdio",
    "allowed_extensions": [
        "torbox-streamer@arena"
    ]
}


def get_target_dirs():
    dirs = []
    if sys.platform == "linux":
        base_home = Path.home()
        dirs.extend([
            base_home / ".mozilla" / "native-messaging-hosts",
            base_home / ".waterfox" / "native-messaging-hosts",
            base_home / ".waterfox-current" / "native-messaging-hosts",
            base_home / ".librewolf" / "native-messaging-hosts",
            base_home / ".zen" / "native-messaging-hosts",
            base_home / ".config" / "google-chrome" / "NativeMessagingHosts",
            base_home / ".config" / "chromium" / "NativeMessagingHosts",
            base_home / ".config" / "BraveSoftware" / "Brave-Browser" / "NativeMessagingHosts",
        ])
    elif sys.platform == "darwin":
        base_app_supp = Path.home() / "Library" / "Application Support"
        dirs.extend([
            base_app_supp / "Mozilla" / "NativeMessagingHosts",
            base_app_supp / "Waterfox" / "NativeMessagingHosts",
            base_app_supp / "Zen" / "NativeMessagingHosts",
            base_app_supp / "Google" / "Chrome" / "NativeMessagingHosts",
            base_app_supp / "BraveSoftware" / "Brave-Browser" / "NativeMessagingHosts",
        ])
    elif sys.platform == "win32":
        app_data = Path(os.environ.get("APPDATA", ""))
        dirs.extend([
            app_data / "Mozilla" / "NativeMessagingHosts",
            app_data / "Waterfox" / "NativeMessagingHosts",
            app_data / "Zen" / "NativeMessagingHosts",
            app_data / "zen" / "NativeMessagingHosts",
        ])
    return dirs


def install():
    HOST_PATH.chmod(0o755)
    installed_any = False

    for target_dir in get_target_dirs():
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
            manifest_file = target_dir / f"{HOST_NAME}.json"
            with open(manifest_file, "w") as f:
                json.dump(MANIFEST_CONTENT, f, indent=2)
            print(f"✅ Installed manifest at:\n   {manifest_file}")
            installed_any = True
        except Exception as e:
            pass

    if not installed_any:
        print("⚠️ Could not find or write to any standard browser native messaging directories.")


def main():
    print("Installing optional MPV launcher helper for TorBox Streamer (Firefox, Waterfox, Chrome, etc.)...")
    install()
    print("Done! You can now select 'Always MPV' or use MPV playback in TorBox Streamer options.")


if __name__ == "__main__":
    main()
