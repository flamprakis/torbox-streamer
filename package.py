#!/usr/bin/env python3
"""
Packaging Script for TorBox Streamer.
Bundles the extension files into build/torbox-streamer-v<version>.zip for release distribution.
"""

import json
import os
import shutil
import zipfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
EXTENSION_DIR = ROOT_DIR / "extension"
BUILD_DIR = ROOT_DIR / "build"
MANIFEST_PATH = EXTENSION_DIR / "manifest.json"


def package():
    if not MANIFEST_PATH.exists():
        print(f"❌ Manifest not found at: {MANIFEST_PATH}")
        return False

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    version = manifest.get("version", "2.0.0")
    BUILD_DIR.mkdir(exist_ok=True)

    zip_filename = f"torbox-streamer-v{version}.zip"
    zip_path = BUILD_DIR / zip_filename

    print(f"📦 Packaging TorBox Streamer v{version}...")

    # Files/patterns to exclude
    exclude_extensions = {".DS_Store", ".git", ".pyc"}
    exclude_dirs = {"__pycache__", ".git", ".github"}

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(EXTENSION_DIR):
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            for file in files:
                if any(file.endswith(ext) for ext in exclude_extensions):
                    continue
                file_path = Path(root) / file
                arcname = file_path.relative_to(EXTENSION_DIR)
                zf.write(file_path, arcname)
                print(f"  + {arcname}")

    size_kb = zip_path.stat().st_size / 1024
    print(f"\n✅ Package successfully created:")
    print(f"   Path: {zip_path}")
    print(f"   Size: {size_kb:.1f} KB")
    return True


if __name__ == "__main__":
    package()
