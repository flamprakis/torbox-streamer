"""Exercise the release builder and inspect the artifacts users install."""

import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("release_package", ROOT / "package.py")
packager = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packager)


class TestPackaging(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copytree(ROOT / "extension", self.root / "extension")
        shutil.copytree(ROOT / "helpers", self.root / "helpers", ignore=shutil.ignore_patterns("__pycache__"))
        for name in ("package.py", "package.json", "INSTALL.md", "README.md"):
            shutil.copy2(ROOT / name, self.root / name)

    def build(self):
        return subprocess.run(
            [sys.executable, str(self.root / "package.py")],
            capture_output=True, text=True, timeout=20,
        )

    def test_archives_have_complete_resources_and_shared_background_dependencies(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        source = json.loads((self.root / "extension/manifest.json").read_text())
        version = source["version"]
        artifacts = list((self.root / "build").glob("*.zip"))
        self.assertEqual(len(artifacts), 3)
        with zipfile.ZipFile(self.root / "build" / f"torbox-streamer-firefox-v{version}.zip") as firefox:
            self.assertIsNone(firefox.testzip())
            self.assertEqual(json.loads(firefox.read("manifest.json")), source)
            expected_files = {
                path.relative_to(self.root / "extension").as_posix()
                for path in (self.root / "extension").rglob("*") if path.is_file()
            }
            self.assertEqual(set(firefox.namelist()), expected_files)
        with zipfile.ZipFile(self.root / "build" / f"torbox-streamer-chrome-v{version}.zip") as chrome:
            self.assertIsNone(chrome.testzip())
            manifest = json.loads(chrome.read("manifest.json"))
            self.assertEqual(manifest["manifest_version"], 3)
            self.assertNotIn("browser_specific_settings", manifest)
            self.assertNotIn("browser_action", manifest)
            self.assertEqual(manifest["action"], source["browser_action"])
            self.assertEqual(manifest["background"], {"service_worker": "background.js"})
            self.assertEqual(manifest["host_permissions"], [
                permission for permission in source["permissions"]
                if "://" in permission or permission == "<all_urls>"
            ])
            worker = chrome.read("background.js").decode()
            imports = ", ".join(json.dumps(name) for name in source["background"]["scripts"][:-1])
            self.assertTrue(worker.startswith(f"importScripts({imports});\n"))
            for name in chrome.namelist():
                self.assertEqual(chrome.read(name), (self.root / "build/chrome-ext-unpacked" / name).read_bytes())
        with zipfile.ZipFile(self.root / "build" / f"torbox-native-host-installer-v{version}.zip") as installer:
            self.assertEqual(set(installer.namelist()), {
                "install.sh", "install.bat", "install.py", "native_host.py", "INSTALL.md", "README.md",
            })
            self.assertEqual(installer.read("native_host.py"), (self.root / "helpers/native_host.py").read_bytes())

    def test_missing_manifest_exits_nonzero(self):
        (self.root / "extension/manifest.json").unlink()
        self.assertNotEqual(self.build().returncode, 0)

    def test_missing_entry_point_prevents_any_release_artifacts(self):
        (self.root / "extension/background.js").unlink()
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing or invalid manifest resource: background.js", result.stderr)
        self.assertFalse((self.root / "build").exists())

    def test_missing_installer_is_a_failure_instead_of_an_incomplete_zip(self):
        (self.root / "helpers/native_host.py").unlink()
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing installer resource", result.stderr)
        self.assertFalse((self.root / "build").exists())

    def test_version_mismatch_is_rejected(self):
        package_json = self.root / "package.json"
        metadata = json.loads(package_json.read_text())
        metadata["version"] = "0.0.0"
        package_json.write_text(json.dumps(metadata))
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("versions must match", result.stderr)

    def test_manifest_conversion_does_not_mutate_source(self):
        source = json.loads((ROOT / "extension/manifest.json").read_text())
        original = json.dumps(source, sort_keys=True)
        packager.generate_chrome_manifest_v3(source)
        self.assertEqual(json.dumps(source, sort_keys=True), original)

    def test_nested_manifest_and_background_are_not_replaced(self):
        nested = self.root / "extension/nested"
        nested.mkdir()
        (nested / "manifest.json").write_text('{"test": true}')
        (nested / "background.js").write_text("// nested entry point")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        chrome_zip = next((self.root / "build").glob("torbox-streamer-chrome-*.zip"))
        with zipfile.ZipFile(chrome_zip) as chrome:
            self.assertEqual(chrome.read("nested/manifest.json"), b'{"test": true}')
            self.assertEqual(chrome.read("nested/background.js"), b"// nested entry point")


if __name__ == "__main__":
    unittest.main()
