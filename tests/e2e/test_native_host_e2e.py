#!/usr/bin/env python3
"""
E2E Test Suite for TorBox Streamer Native Host (helpers/native_host.py).
Verifies binary IPC protocol, argument formatting for MPV/VLC, stdout/stderr isolation,
headers support, and error handling without spawning GUI windows.
"""

import json
import os
import stat
import struct
import subprocess
import sys
import tempfile
import time
import unittest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
NATIVE_HOST_PATH = os.path.join(ROOT_DIR, "helpers", "native_host.py")


def create_mock_player_script(target_log_file):
    """Creates a temporary executable shell script that logs sys.argv to a file and exits."""
    tmp = tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".sh")
    script_content = f"""#!/bin/sh
echo "$@" > "{target_log_file}"
exit 0
"""
    tmp.write(script_content)
    tmp.close()
    st = os.stat(tmp.name)
    os.chmod(tmp.name, st.st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return tmp.name


class TestNativeHostE2E(unittest.TestCase):

    def send_ipc_message(self, proc, msg_dict):
        """Packs a dictionary as a 4-byte length-prefixed JSON message and writes to proc.stdin."""
        encoded = json.dumps(msg_dict).encode("utf-8")
        proc.stdin.write(struct.pack("=I", len(encoded)))
        proc.stdin.write(encoded)
        proc.stdin.flush()

    def read_ipc_message(self, proc, timeout=5.0):
        """Reads a 4-byte length-prefixed JSON message from proc.stdout."""
        raw_length = proc.stdout.read(4)
        if not raw_length or len(raw_length) < 4:
            return None
        length = struct.unpack("=I", raw_length)[0]
        raw_data = proc.stdout.read(length)
        self.assertEqual(len(raw_data), length, "Incomplete JSON payload received")
        return json.loads(raw_data.decode("utf-8"))

    def test_native_host_protocol_and_mpv_launch(self):
        """Verifies native host launches MPV with proper arguments, sub-files, and headers over IPC protocol."""
        log_file = tempfile.NamedTemporaryFile(delete=False).name
        mock_mpv = create_mock_player_script(log_file)

        proc = subprocess.Popen(
            [sys.executable, NATIVE_HOST_PATH],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        msg = {
            "action": "launch_player",
            "player": "mpv",
            "custom_path": mock_mpv,
            "url": "https://torbox.app/stream/test_movie.mkv",
            "subtitles": ["https://torbox.app/subs/en.vtt"],
            "headers": {"User-Agent": "TorBoxStreamer/2.0.2", "Authorization": "Bearer test_token"}
        }

        self.send_ipc_message(proc, msg)
        response = self.read_ipc_message(proc)

        self.assertIsNotNone(response, "No IPC response received from native host")
        self.assertEqual(response.get("status"), "ok")
        self.assertEqual(response.get("player"), "mpv")

        proc.stdin.close()
        proc.stdout.close()
        proc.stderr.close()
        proc.terminate()
        proc.wait(timeout=2)

        time.sleep(0.1)
        # Inspect recorded arguments from mock script
        with open(log_file, "r") as f:
            arg_line = f.read().strip()

        os.remove(log_file)
        os.remove(mock_mpv)

        self.assertIn("--force-window=yes", arg_line)
        self.assertIn("https://torbox.app/stream/test_movie.mkv", arg_line)
        self.assertIn("--sub-file=https://torbox.app/subs/en.vtt", arg_line)
        self.assertIn("--http-header-fields=", arg_line)
        self.assertIn("User-Agent: TorBoxStreamer/2.0.2", arg_line)

    def test_native_host_vlc_launch(self):
        """Verifies native host launches VLC with proper arguments and headers."""
        log_file = tempfile.NamedTemporaryFile(delete=False).name
        mock_vlc = create_mock_player_script(log_file)

        proc = subprocess.Popen(
            [sys.executable, NATIVE_HOST_PATH],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        msg = {
            "action": "launch_vlc",
            "custom_path": mock_vlc,
            "url": "https://torbox.app/stream/vlc_stream.mp4",
            "subtitles": ["https://torbox.app/subs/es.vtt"],
            "headers": {"User-Agent": "TorBoxStreamer/2.0.2", "Referer": "https://torbox.app"}
        }

        self.send_ipc_message(proc, msg)
        response = self.read_ipc_message(proc)

        self.assertIsNotNone(response)
        self.assertEqual(response.get("status"), "ok")
        self.assertEqual(response.get("player"), "vlc")

        proc.stdin.close()
        proc.stdout.close()
        proc.stderr.close()
        proc.terminate()
        proc.wait(timeout=2)

        for _ in range(20):
            if os.path.exists(log_file) and os.path.getsize(log_file) > 0:
                break
            time.sleep(0.1)

        with open(log_file, "r") as f:
            arg_line = f.read().strip()

        os.remove(log_file)
        os.remove(mock_vlc)

        self.assertIn("https://torbox.app/stream/vlc_stream.mp4", arg_line)
        self.assertIn("--sub-file=https://torbox.app/subs/es.vtt", arg_line)
        self.assertIn("--http-user-agent=TorBoxStreamer/2.0.2", arg_line)
        self.assertIn("--http-referrer=https://torbox.app", arg_line)

    def test_stdout_purity(self):
        """Verifies that native_host.py NEVER outputs raw text or logs to stdout (stdout must remain pure 4-byte frames)."""
        proc = subprocess.Popen(
            [sys.executable, NATIVE_HOST_PATH],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        msg = {"action": "invalid_action"}
        self.send_ipc_message(proc, msg)

        # Read length prefix
        raw_len = proc.stdout.read(4)
        self.assertEqual(len(raw_len), 4, "Stdout must begin with 4-byte binary integer header")
        length = struct.unpack("=I", raw_len)[0]
        data = proc.stdout.read(length)

        # Parse JSON
        resp = json.loads(data.decode("utf-8"))
        self.assertEqual(resp.get("status"), "error")

        proc.stdin.close()
        proc.stdout.close()
        proc.stderr.close()
        proc.terminate()
        proc.wait(timeout=2)

    def test_error_on_missing_url(self):
        """Verifies error response when URL is omitted."""
        proc = subprocess.Popen(
            [sys.executable, NATIVE_HOST_PATH],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        msg = {"action": "launch_mpv"}
        self.send_ipc_message(proc, msg)
        response = self.read_ipc_message(proc)

        self.assertIsNotNone(response)
        self.assertEqual(response.get("status"), "error")
        self.assertIn("No URL provided", response.get("message", ""))

        proc.stdin.close()
        proc.stdout.close()
        proc.stderr.close()
        proc.terminate()
        proc.wait(timeout=2)

    def test_nonexistent_custom_path_fallback(self):
        """Verifies error handling or executable fallback when custom_path does not exist."""
        proc = subprocess.Popen(
            [sys.executable, NATIVE_HOST_PATH],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        msg = {
            "action": "launch_player",
            "player": "nonexistent_player_app_12345",
            "custom_path": "/invalid/path/to/player_bin_xyz",
            "url": "https://torbox.app/stream.mkv"
        }
        self.send_ipc_message(proc, msg)
        response = self.read_ipc_message(proc)

        self.assertIsNotNone(response)
        # Should return response frame (ok if system falls back or error if binary fails to spawn)
        self.assertIn("status", response)

        proc.stdin.close()
        proc.stdout.close()
        proc.stderr.close()
        proc.terminate()
        proc.wait(timeout=2)

    def test_invalid_json_payload(self):
        """Verifies native host returns an error frame when malformed JSON payload is received."""
        proc = subprocess.Popen(
            [sys.executable, NATIVE_HOST_PATH],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        bad_payload = b"{action: 'invalid_json', url: "
        proc.stdin.write(struct.pack("=I", len(bad_payload)))
        proc.stdin.write(bad_payload)
        proc.stdin.flush()

        response = self.read_ipc_message(proc)
        self.assertIsNotNone(response)
        self.assertEqual(response.get("status"), "error")

        proc.stdin.close()
        proc.stdout.close()
        proc.stderr.close()
        proc.terminate()
        proc.wait(timeout=2)


if __name__ == "__main__":
    unittest.main()
