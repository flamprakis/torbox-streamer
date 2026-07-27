#!/usr/bin/env python3
"""
Packaging Script for TorBox Streamer.
Bundles:
1. build/torbox-streamer-extension-v<version>.zip (WebExtension distribution)
2. build/torbox-native-host-installer-v<version>.zip (MPV/VLC native launcher installer)
"""

import json
import os
import zipfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
EXTENSION_DIR = ROOT_DIR / "extension"
HELPERS_DIR = ROOT_DIR / "helpers"
BUILD_DIR = ROOT_DIR / "build"
MANIFEST_PATH = EXTENSION_DIR / "manifest.json"


def package():
    if not MANIFEST_PATH.exists():
        print(f"❌ Manifest not found at: {MANIFEST_PATH}")
        return False

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    version = manifest.get("version", "2.0.2")
    BUILD_DIR.mkdir(exist_ok=True)

    # 1. Package WebExtension
    ext_zip_path = BUILD_DIR / f"torbox-streamer-extension-v{version}.zip"
    print(f"📦 [1/2] Packaging WebExtension v{version}...")

    exclude_extensions = {".DS_Store", ".git", ".pyc"}
    exclude_dirs = {"__pycache__", ".git", ".github"}

    with zipfile.ZipFile(ext_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(EXTENSION_DIR):
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            for file in files:
                if any(file.endswith(ext) for ext in exclude_extensions):
                    continue
                file_path = Path(root) / file
                arcname = file_path.relative_to(EXTENSION_DIR)
                zf.write(file_path, arcname)

    ext_size = ext_zip_path.stat().st_size / 1024
    print(f"   ✅ WebExtension Zip created: {ext_zip_path.name} ({ext_size:.1f} KB)")

    # 2. Package Native Host Installers (Linux / macOS / Windows)
    installer_zip_path = BUILD_DIR / f"torbox-native-host-installer-v{version}.zip"
    print(f"\n📦 [2/2] Packaging Native Host Installer v{version}...")

    installer_files = [
        HELPERS_DIR / "install.sh",
        HELPERS_DIR / "install.bat",
        HELPERS_DIR / "install.py",
        HELPERS_DIR / "native_host.py",
        ROOT_DIR / "INSTALL.md",
        ROOT_DIR / "README.md",
    ]

    with zipfile.ZipFile(installer_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in installer_files:
            if file_path.exists():
                zf.write(file_path, file_path.name)
                print(f"  + {file_path.name}")

    installer_size = installer_zip_path.stat().st_size / 1024
    print(f"   ✅ Native Host Installer Zip created: {installer_zip_path.name} ({installer_size:.1f} KB)")

    print(f"\n🎉 Packaging complete! All release assets ready in: {BUILD_DIR}")
    return True


if __name__ == "__main__":
    package()
