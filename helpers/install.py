#!/usr/bin/env python3
"""
TorBox Streamer — Native Messaging Host Installer (Cross-Platform Python)
Auto-detects installed browsers and allows installing for all detected or specific browsers.
Supports both Gecko (Firefox/Waterfox/Zen) and Chromium (Chrome/Brave/Edge) manifest schemas.
"""

import argparse
import json
import os
import sys
from pathlib import Path

HOST_NAME = "com.torbox_streamer.host"
SCRIPT_DIR = Path(__file__).resolve().parent
HOST_PATH = SCRIPT_DIR / "native_host.py"
GECKO_ID = "torbox-streamer@flamprakis.com"


def build_gecko_manifest(exec_path):
    return {
        "name": HOST_NAME,
        "description": "TorBox Streamer Native Messaging Host",
        "path": str(exec_path),
        "type": "stdio",
        "allowed_extensions": [GECKO_ID]
    }


def build_chromium_manifest(exec_path, chrome_id="ldnghajfecbhmnlnoejglhkdojdambef"):
    return {
        "name": HOST_NAME,
        "description": "TorBox Streamer Native Messaging Host",
        "path": str(exec_path),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{chrome_id}/"]
    }


def get_known_browsers():
    """Returns dict of known browsers on the host system with auto-detection status."""
    browsers = []

    if sys.platform == "linux":
        home = Path.home()
        candidates = [
            # Native Linux Paths
            ("Firefox", "gecko", home / ".mozilla", home / ".mozilla" / "native-messaging-hosts"),
            ("Waterfox", "gecko", home / ".waterfox", home / ".waterfox" / "native-messaging-hosts"),
            ("LibreWolf", "gecko", home / ".librewolf", home / ".librewolf" / "native-messaging-hosts"),
            ("Zen Browser", "gecko", home / ".zen", home / ".zen" / "native-messaging-hosts"),
            ("Google Chrome", "chromium", home / ".config" / "google-chrome", home / ".config" / "google-chrome" / "NativeMessagingHosts"),
            ("Chromium", "chromium", home / ".config" / "chromium", home / ".config" / "chromium" / "NativeMessagingHosts"),
            ("Brave", "chromium", home / ".config" / "BraveSoftware", home / ".config" / "BraveSoftware" / "Brave-Browser" / "NativeMessagingHosts"),
            ("Vivaldi", "chromium", home / ".config" / "vivaldi", home / ".config" / "vivaldi" / "NativeMessagingHosts"),
            ("Microsoft Edge", "chromium", home / ".config" / "microsoft-edge", home / ".config" / "microsoft-edge" / "NativeMessagingHosts"),

            # Flatpak Paths
            ("Firefox (Flatpak)", "gecko", home / ".var" / "app" / "org.mozilla.firefox", home / ".var" / "app" / "org.mozilla.firefox" / ".mozilla" / "native-messaging-hosts"),
            ("Waterfox (Flatpak)", "gecko", home / ".var" / "app" / "net.waterfox.waterfox", home / ".var" / "app" / "net.waterfox.waterfox" / ".waterfox" / "native-messaging-hosts"),
            ("LibreWolf (Flatpak)", "gecko", home / ".var" / "app" / "io.gitlab.librewolf-community", home / ".var" / "app" / "io.gitlab.librewolf-community" / ".librewolf" / "native-messaging-hosts"),
            ("Zen Browser (Flatpak)", "gecko", home / ".var" / "app" / "io.github.zen_browser.zen", home / ".var" / "app" / "io.github.zen_browser.zen" / ".zen" / "native-messaging-hosts"),
            ("Google Chrome (Flatpak)", "chromium", home / ".var" / "app" / "com.google.Chrome", home / ".var" / "app" / "com.google.Chrome" / "config" / "google-chrome" / "NativeMessagingHosts"),
            ("Chromium (Flatpak)", "chromium", home / ".var" / "app" / "org.chromium.Chromium", home / ".var" / "app" / "org.chromium.Chromium" / "config" / "chromium" / "NativeMessagingHosts"),
            ("Brave (Flatpak)", "chromium", home / ".var" / "app" / "com.brave.Browser", home / ".var" / "app" / "com.brave.Browser" / "config" / "BraveSoftware" / "Brave-Browser" / "NativeMessagingHosts"),
            ("Vivaldi (Flatpak)", "chromium", home / ".var" / "app" / "com.vivaldi.Vivaldi", home / ".var" / "app" / "com.vivaldi.Vivaldi" / "config" / "vivaldi" / "NativeMessagingHosts"),
            ("Microsoft Edge (Flatpak)", "chromium", home / ".var" / "app" / "com.microsoft.Edge", home / ".var" / "app" / "com.microsoft.Edge" / "config" / "microsoft-edge" / "NativeMessagingHosts"),

            # Snap Paths
            ("Firefox (Snap)", "gecko", home / "snap" / "firefox", home / "snap" / "firefox" / "common" / ".mozilla" / "native-messaging-hosts"),
            ("Google Chrome (Snap)", "chromium", home / "snap" / "google-chrome", home / "snap" / "google-chrome" / "current" / ".config" / "google-chrome" / "NativeMessagingHosts"),
            ("Chromium (Snap)", "chromium", home / "snap" / "chromium", home / "snap" / "chromium" / "current" / ".config" / "chromium" / "NativeMessagingHosts"),
            ("Brave (Snap)", "chromium", home / "snap" / "brave", home / "snap" / "brave" / "current" / ".config" / "BraveSoftware" / "Brave-Browser" / "NativeMessagingHosts"),
        ]
    elif sys.platform == "darwin":
        app_supp = Path.home() / "Library" / "Application Support"
        candidates = [
            ("Firefox", "gecko", app_supp / "Mozilla", app_supp / "Mozilla" / "NativeMessagingHosts"),
            ("Waterfox", "gecko", app_supp / "Waterfox", app_supp / "Waterfox" / "NativeMessagingHosts"),
            ("Zen Browser", "gecko", app_supp / "Zen", app_supp / "Zen" / "NativeMessagingHosts"),
            ("Google Chrome", "chromium", app_supp / "Google" / "Chrome", app_supp / "Google" / "Chrome" / "NativeMessagingHosts"),
            ("Brave", "chromium", app_supp / "BraveSoftware", app_supp / "BraveSoftware" / "Brave-Browser" / "NativeMessagingHosts"),
        ]
    else:  # win32
        app_data = Path(os.environ.get("APPDATA", ""))
        candidates = [
            ("Firefox", "gecko", app_data / "Mozilla", app_data / "Mozilla" / "NativeMessagingHosts"),
            ("Waterfox", "gecko", app_data / "Waterfox", app_data / "Waterfox" / "NativeMessagingHosts"),
            ("Zen Browser", "gecko", app_data / "Zen", app_data / "Zen" / "NativeMessagingHosts"),
            ("Google Chrome", "chromium", app_data / "Google" / "Chrome", app_data / "Google" / "Chrome" / "NativeMessagingHosts"),
        ]

    for name, btype, check_dir, host_dir in candidates:
        is_installed = check_dir.exists()
        browsers.append({
            "name": name,
            "type": btype,
            "check_dir": check_dir,
            "host_dir": host_dir,
            "installed": is_installed
        })

    return browsers


def install_manifest(browser, exec_path):
    target_dir = browser["host_dir"]
    target_dir.mkdir(parents=True, exist_ok=True)
    manifest_file = target_dir / f"{HOST_NAME}.json"

    if browser["type"] == "gecko":
        content = build_gecko_manifest(exec_path)
    else:
        content = build_chromium_manifest(exec_path)

    with open(manifest_file, "w", encoding="utf-8") as f:
        json.dump(content, f, indent=2)

    print(f"  ✅ Installed manifest for {browser['name']} ({browser['type']}):")
    print(f"     {manifest_file}")


def main():
    parser = argparse.ArgumentParser(description="TorBox Streamer Native Host Installer")
    parser.add_argument("--all", action="store_true", help="Install manifest to all detected browsers without prompt")
    parser.add_argument("--browser", type=str, help="Specify target browser name (e.g. firefox, chrome)")
    args = parser.parse_args()

    print("======================================================")
    print("   TorBox Streamer — Native Host Installer")
    print("======================================================")
    print()

    if HOST_PATH.exists():
        try:
            HOST_PATH.chmod(0o755)
        except Exception:
            pass

    all_browsers = get_known_browsers()
    installed_browsers = [b for b in all_browsers if b["installed"]]

    if not installed_browsers:
        print("⚠️ No standard browser profile directories detected automatically.")
        print("Fallback: Installing for Firefox & Chrome default locations...")
        installed_browsers = [b for b in all_browsers if b["name"] in ("Firefox", "Google Chrome")]

    selected_browsers = []

    if args.browser:
        query = args.browser.lower()
        matched = [b for b in all_browsers if query in b["name"].lower()]
        if matched:
            selected_browsers = matched
        else:
            print(f"❌ Error: Specified browser '{args.browser}' not recognized.")
            sys.exit(1)
    elif args.all or not sys.stdin.isatty():
        # Non-interactive or --all flag
        selected_browsers = installed_browsers
    else:
        # Interactive TTY Prompt
        print("🔍 Detected installed browsers on your system:")
        for idx, b in enumerate(installed_browsers, 1):
            print(f"  [{idx}] {b['name']} ({b['type'].capitalize()})")
        print("  [A] Install for All Detected Browsers (Default)")
        print()

        try:
            choice = input("Select an option [1-" + str(len(installed_browsers)) + " or A]: ").strip().upper()
        except (KeyboardInterrupt, EOFError):
            print("\nInstallation cancelled.")
            sys.exit(0)

        if not choice or choice == "A":
            selected_browsers = installed_browsers
        else:
            try:
                num = int(choice)
                if 1 <= num <= len(installed_browsers):
                    selected_browsers = [installed_browsers[num - 1]]
                else:
                    selected_browsers = installed_browsers
            except ValueError:
                selected_browsers = installed_browsers

    print(f"\n🚀 Installing Native Host manifest for {len(selected_browsers)} browser(s)...")
    for b in selected_browsers:
        install_manifest(b, HOST_PATH)

    print("\n======================================================")
    print(" 🎉 Native Host installation complete!")
    print(" You can now launch MPV / VLC directly from TorBox Streamer.")
    print("======================================================")


if __name__ == "__main__":
    main()
