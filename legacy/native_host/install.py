#!/usr/bin/env python3
"""
Installer for the torbox-streamer native messaging host.

Registers the host with Firefox so the extension can communicate with it.
Run: python install.py [--uninstall]
"""

import json
import os
import sys
import stat
from pathlib import Path

# ─── Configuration ──────────────────────────────────────────────────────────

HOST_NAME = "com.torbox_streamer.host"
HOST_DIR = Path(__file__).parent.resolve()
HOST_SCRIPT = HOST_DIR / "host.py"

# Firefox native messaging manifest locations
if sys.platform == "win32":
    # Windows: registry-based, but we'll create the JSON for reference
    MANIFEST_DIRS = [
        Path.home() / "AppData" / "Roaming" / "Mozilla" / "NativeMessagingHosts",
    ]
elif sys.platform == "darwin":
    MANIFEST_DIRS = [
        Path.home() / "Library" / "Application Support" / "Mozilla" / "NativeMessagingHosts",
    ]
else:
    # Linux
    MANIFEST_DIRS = [
        Path.home() / ".mozilla" / "native-messaging-hosts",
        # Waterfox
        Path.home() / ".waterfox" / "native-messaging-hosts",
        # Firefox via Flatpak
        Path.home() / ".var" / "app" / "org.mozilla.firefox" / ".mozilla" / "native-messaging-hosts",
        # Waterfox via Flatpak (if applicable)
        Path.home() / ".var" / "app" / "net.waterfox.waterfox" / ".waterfox" / "native-messaging-hosts",
    ]

# The extension ID — after loading in about:debugging, copy the UUID here.
# For temporary/dev loads it looks like: {a1b2c3d4-e5f6-7890-abcd-ef1234567890}
# You can also just use a fixed ID by adding "browser_specific_settings" to manifest.json
EXTENSION_ID = "torbox-streamer@arena"


def get_manifest() -> dict:
    """Generate the native messaging manifest."""
    return {
        "name": HOST_NAME,
        "description": "TorBox Streamer — stream torrents via TorBox from IMDb pages",
        "path": str(HOST_SCRIPT),
        "type": "stdio",
        "allowed_extensions": [
            EXTENSION_ID,
            # Add more IDs here if you publish or use different dev profiles
        ],
    }


def install():
    """Install the native messaging host manifest."""
    # Make host.py executable
    HOST_SCRIPT.chmod(HOST_SCRIPT.stat().st_mode | stat.S_IEXEC)

    # Also ensure python3 shebang works
    print(f"Host script: {HOST_SCRIPT}")
    print(f"Host name:   {HOST_NAME}")
    print()

    installed = False
    for manifest_dir in MANIFEST_DIRS:
        manifest_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = manifest_dir / f"{HOST_NAME}.json"

        manifest = get_manifest()
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)

        print(f"  ✓ Installed: {manifest_path}")
        installed = True

    if not installed:
        print("  ⚠ No manifest directories found for your platform.")
        return

    print()
    print("Native messaging host installed!")
    print()
    print("Next steps:")
    print(f"  1. Update EXTENSION_ID in this script with your extension's ID")
    print(f"  2. Re-run: python install.py")
    print(f"  3. Load the extension in Firefox (about:debugging)")
    print(f"  4. Make sure your TorBox API key is set:")
    print(f"     export TORBOX_API_KEY='your-key'")
    print(f"     or run: python -c \"from config import *; c=load_config(); c['torbox_api_key']='YOUR_KEY'; save_config(c)\"")


def uninstall():
    """Remove the native messaging host manifest."""
    for manifest_dir in MANIFEST_DIRS:
        manifest_path = manifest_dir / f"{HOST_NAME}.json"
        if manifest_path.exists():
            manifest_path.unlink()
            print(f"  ✓ Removed: {manifest_path}")
    print("Native messaging host uninstalled.")


if __name__ == "__main__":
    if "--uninstall" in sys.argv:
        uninstall()
    else:
        install()
