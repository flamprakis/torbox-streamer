#!/usr/bin/env python3
"""
Packaging Script for TorBox Streamer.
Bundles 3 release artifacts in build/:
1. build/torbox-streamer-firefox-v<version>.zip (Firefox AMO / Gecko Manifest V2)
2. build/torbox-streamer-chrome-v<version>.zip (Chrome Web Store / Manifest V3)
3. build/torbox-native-host-installer-v<version>.zip (Native Host Installer helper)
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


def generate_chrome_manifest_v3(v2_manifest):
    """Converts a Manifest V2 object to a Manifest V3 object for Chrome Web Store."""
    v3 = json.loads(json.dumps(v2_manifest))
    v3["manifest_version"] = 3

    # Background service worker conversion
    if "background" in v3:
        v3["background"] = {
            "service_worker": "background.js"
        }

    # Browser action to action
    if "browser_action" in v3:
        v3["action"] = v3.pop("browser_action")

    # Permissions split into permissions and host_permissions
    if "permissions" in v3:
        permissions = []
        host_permissions = []
        for p in v3["permissions"]:
            if "://" in p or p == "<all_urls>":
                host_permissions.append(p)
            else:
                permissions.append(p)
        v3["permissions"] = permissions
        if host_permissions:
            v3["host_permissions"] = host_permissions

    # Remove Gecko specific settings for Chrome
    v3.pop("browser_specific_settings", None)
    return v3


def package():
    if not MANIFEST_PATH.exists():
        print(f"❌ Manifest not found at: {MANIFEST_PATH}")
        return False

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest_v2 = json.load(f)

    version = manifest_v2.get("version", "2.0.2")
    BUILD_DIR.mkdir(exist_ok=True)

    exclude_extensions = {".DS_Store", ".git", ".pyc"}
    exclude_dirs = {"__pycache__", ".git", ".github"}

    # 1. Package Firefox WebExtension (Manifest V2)
    ff_zip_path = BUILD_DIR / f"torbox-streamer-firefox-v{version}.zip"
    print(f"📦 [1/3] Packaging Firefox WebExtension (Manifest V2) v{version}...")

    with zipfile.ZipFile(ff_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(EXTENSION_DIR):
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            for file in files:
                if any(file.endswith(ext) for ext in exclude_extensions):
                    continue
                file_path = Path(root) / file
                arcname = file_path.relative_to(EXTENSION_DIR)
                zf.write(file_path, arcname)

    ff_size = ff_zip_path.stat().st_size / 1024
    print(f"   ✅ Firefox Zip created: {ff_zip_path.name} ({ff_size:.1f} KB)")

    # 2. Package Chrome WebExtension (Manifest V3)
    chrome_zip_path = BUILD_DIR / f"torbox-streamer-chrome-v{version}.zip"
    print(f"\n📦 [2/3] Packaging Chrome WebExtension (Manifest V3) v{version}...")

    manifest_v3 = generate_chrome_manifest_v3(manifest_v2)

    with zipfile.ZipFile(chrome_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(EXTENSION_DIR):
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            for file in files:
                if any(file.endswith(ext) for ext in exclude_extensions):
                    continue
                file_path = Path(root) / file
                arcname = file_path.relative_to(EXTENSION_DIR)
                if file == "manifest.json":
                    # Write converted Manifest V3
                    zf.writestr(str(arcname), json.dumps(manifest_v3, indent=2))
                else:
                    zf.write(file_path, arcname)

    chrome_size = chrome_zip_path.stat().st_size / 1024
    print(f"   ✅ Chrome Zip created: {chrome_zip_path.name} ({chrome_size:.1f} KB)")

    # 3. Package Native Host Installers
    installer_zip_path = BUILD_DIR / f"torbox-native-host-installer-v{version}.zip"
    print(f"\n📦 [3/3] Packaging Native Host Installer v{version}...")

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

    print(f"\n🎉 Packaging complete! All 3 release assets ready in: {BUILD_DIR}")
    return True


if __name__ == "__main__":
    package()
