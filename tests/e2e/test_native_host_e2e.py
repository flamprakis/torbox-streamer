"""Native messaging contract tests against a real host process and player argv."""

import importlib.util
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
HOST_PATH = ROOT / "helpers/native_host.py"
SPEC = importlib.util.spec_from_file_location("native_host", HOST_PATH)
native_host = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native_host)


def frame(value):
    payload = json.dumps(value).encode()
    return struct.pack("=I", len(payload)) + payload


class TestNativeHostE2E(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.argv_path = self.root / "player-arguments.json"
        self.log_path = self.root / "host.log"
        self.player = self.root / "mock-player"
        self.player.write_text(
            f"#!{sys.executable}\n"
            "import json, pathlib, sys\n"
            f"pathlib.Path({str(self.argv_path)!r}).write_text(json.dumps(sys.argv[1:]))\n"
            "print('player stdout must never enter the native messaging pipe')\n"
            "print('player stderr is isolated too', file=sys.stderr)\n"
        )
        self.player.chmod(0o755)

    def exchange(self, payload):
        binary = os.environ.get("TORBOX_NATIVE_HOST_BINARY")
        command = [binary] if binary else [sys.executable, str(HOST_PATH)]
        result = subprocess.run(
            command, input=payload, capture_output=True, timeout=10,
            env={**os.environ, "TORBOX_NATIVE_LOG_PATH": str(self.log_path)},
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
        self.assertEqual(result.stderr, b"", "Host/player diagnostics leaked to stderr")
        output = result.stdout
        responses = []
        while output:
            self.assertGreaterEqual(len(output), 4, "Non-framed data leaked into stdout")
            size = struct.unpack("=I", output[:4])[0]
            self.assertLessEqual(size, native_host.MAX_MESSAGE_BYTES)
            self.assertGreaterEqual(len(output), size + 4, "Incomplete output frame")
            responses.append(json.loads(output[4:4 + size]))
            output = output[4 + size:]
        return responses

    def read_player_args(self):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if self.argv_path.exists():
                try:
                    return json.loads(self.argv_path.read_text())
                except json.JSONDecodeError:
                    pass
            time.sleep(0.02)
        self.fail("Player did not receive the launch arguments within 3 seconds")

    @unittest.skipIf(sys.platform == "win32", "POSIX executable fixture; Windows argv is tested directly")
    def test_mpv_launch_preserves_arguments_and_redacts_secrets(self):
        url = "https://torbox.app/stream/movie.mkv?token=private-stream-token"
        subtitles = [f"https://subs.example/{index}.vtt" for index in range(8)]
        response, = self.exchange(frame({
            "action": "launch_player", "player": "MPV", "custom_path": str(self.player),
            "url": url, "subtitles": subtitles,
            "headers": {"User-Agent": "TorBox Streamer", "Authorization": "Bearer secret-test-token"},
        }))
        self.assertEqual(response, {"status": "ok", "player": "mpv", "bin": str(self.player)})
        self.assertEqual(self.read_player_args(), [
            "--force-window=yes", url,
            *[f"--sub-file={sub}" for sub in subtitles[:5]],
            "--http-header-fields=User-Agent: TorBox Streamer,Authorization: Bearer secret-test-token",
        ])
        log = self.log_path.read_text()
        self.assertNotIn("private-stream-token", log)
        self.assertNotIn("secret-test-token", log)
        self.assertNotIn(url, log)

    @unittest.skipIf(sys.platform == "win32", "POSIX executable fixture; Windows argv is tested directly")
    def test_vlc_action_overrides_player_and_limits_subtitles(self):
        subtitles = [f"https://subs.example/{index}.vtt" for index in range(5)]
        response, = self.exchange(frame({
            "action": "launch_vlc", "player": "mpv", "custom_path": str(self.player),
            "url": "https://torbox.app/movie.mp4", "subtitles": subtitles,
            "headers": {"User-Agent": "TorBox Streamer", "Referer": "https://torbox.app"},
        }))
        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["player"], "vlc")
        expected = ["https://torbox.app/movie.mp4"]
        for sub in subtitles[:3]:
            expected.extend([f"--sub-file={sub}", f"--input-slave={sub}"])
        expected.extend(["--http-user-agent=TorBox Streamer", "--http-referrer=https://torbox.app"])
        self.assertEqual(self.read_player_args(), expected)

    def test_invalid_request_returns_error_and_next_frame_is_still_processed(self):
        bad_payload = b'{"action": '
        responses = self.exchange(
            struct.pack("=I", len(bad_payload)) + bad_payload
            + frame({"action": "launch_mpv"})
            + frame({"action": "unknown"})
        )
        self.assertEqual(len(responses), 3)
        self.assertTrue(all(response["status"] == "error" for response in responses))
        self.assertEqual(responses[1]["message"], "No URL provided")
        self.assertEqual(responses[2]["message"], "Unknown action")

    def test_clean_eof_emits_no_frame(self):
        self.assertEqual(self.exchange(b""), [])

    def test_corrupt_frames_fail_promptly_with_an_error(self):
        for payload, message in (
            (b"\x01\x00", "Incomplete message length"),
            (struct.pack("=I", 100) + b"{}", "Incomplete message payload"),
            (struct.pack("=I", 0), "Message size must be between"),
            (struct.pack("=I", native_host.MAX_MESSAGE_BYTES + 1), "Message size must be between"),
        ):
            with self.subTest(message=message):
                response, = self.exchange(payload)
                self.assertEqual(response["status"], "error")
                self.assertIn(message, response["message"])

    def test_non_object_json_is_rejected(self):
        for value in ([], None, 10, "hello"):
            with self.subTest(value=value):
                response, = self.exchange(frame(value))
                self.assertEqual(response["status"], "error")
                self.assertEqual(response["message"], "Message must be a JSON object")

    def test_invalid_player_custom_path_url_headers_and_subtitles_cannot_launch(self):
        base = {"action": "launch_player", "url": "https://torbox.app/movie.mkv", "custom_path": str(self.player)}
        invalid = [
            ({"player": "sh"}, "Unsupported player"),
            ({"custom_path": str(self.root / "missing-player")}, "does not exist"),
            ({"url": "--script=/tmp/execute.lua"}, "HTTP or HTTPS"),
            ({"url": "file:///etc/passwd"}, "HTTP or HTTPS"),
            ({"url": 42}, "HTTP or HTTPS"),
            ({"headers": {"Authorization": "safe\r\nInjected: value"}}, "Headers must"),
            ({"headers": ["invalid"]}, "Headers must"),
            ({"subtitles": {"url": "https://subs.example/1.vtt"}}, "Subtitles must"),
            ({"subtitles": ["file:///tmp/sub.vtt"]}, "HTTP or HTTPS"),
        ]
        for changes, message in invalid:
            with self.subTest(changes=changes):
                response, = self.exchange(frame({**base, **changes}))
                self.assertEqual(response["status"], "error")
                self.assertIn(message, response["message"])
                self.assertFalse(self.argv_path.exists(), "Invalid input reached the player")

    def test_platform_process_options_and_string_subtitle(self):
        with patch.object(native_host.subprocess, "Popen") as spawn, patch.object(native_host, "log"):
            response = native_host.launch_player({
                "action": "launch_mpv", "custom_path": str(self.player),
                "url": "https://torbox.app/movie.mkv", "subtitles": "https://subs.example/1.vtt",
            })
        self.assertEqual(response["status"], "ok")
        args, options = spawn.call_args
        self.assertEqual(args[0], [str(self.player), "--force-window=yes", "https://torbox.app/movie.mkv", "--sub-file=https://subs.example/1.vtt"])
        self.assertEqual(options["stdin"], subprocess.DEVNULL)
        self.assertEqual(options["stdout"], subprocess.DEVNULL)
        self.assertEqual(options["stderr"], subprocess.DEVNULL)
        self.assertEqual(options.get("start_new_session", False), sys.platform != "win32")


if __name__ == "__main__":
    unittest.main()
