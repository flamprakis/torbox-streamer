#!/usr/bin/env python3
"""
E2E Test Suite for TorBox Streamer CLI (cli/cli.py).
Verifies full CLI streaming workflow, stream selection, TorBox client interaction,
and mpv invocation with correct flags without GUI hanging.
"""

import json
import os
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
CLI_DIR = os.path.join(ROOT_DIR, "cli")
sys.path.insert(0, CLI_DIR)

import cli
from torrentio_client import Stream
from torbox_client import TorrentInfo, TorrentFile


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


class TestCLIE2E(unittest.TestCase):

    def test_parse_imdb_input_and_episode(self):
        """Verifies IMDb ID and episode parsing functions in CLI."""
        self.assertEqual(cli.parse_imdb_input("tt0111161"), "tt0111161")
        self.assertEqual(cli.parse_imdb_input("https://www.imdb.com/title/tt0111161/"), "tt0111161")
        self.assertEqual(cli.parse_episode("s02e05"), (2, 5))
        self.assertIsNone(cli.parse_episode("invalid"))

    def _wait_and_read_log(self, log_file, timeout=2.0):
        import time
        start = time.time()
        while time.time() - start < timeout:
            if os.path.exists(log_file) and os.path.getsize(log_file) > 0:
                with open(log_file, "r") as f:
                    return f.read().strip()
            time.sleep(0.05)
        if os.path.exists(log_file):
            with open(log_file, "r") as f:
                return f.read().strip()
        return ""

    @patch("cli.TorBoxClient")
    @patch("cli.TorrentioClient")
    @patch("cli.load_config")
    @patch("cli.get_api_key")
    def test_cli_movie_workflow_e2e(self, mock_get_api_key, mock_load_config, mock_torrentio_cls, mock_torbox_cls):
        """Verifies full movie streaming workflow: Torrentio -> TorBox -> mpv launcher."""
        mock_get_api_key.return_value = "mock_torbox_api_key"
        log_file = tempfile.NamedTemporaryFile(delete=False).name
        mock_mpv = create_mock_player_script(log_file)

        mock_load_config.return_value = {
            "torrentio_base_url": "https://torrentio.strem.fun",
            "max_results": 5,
            "auto_pick_best_cached": True,
            "mpv_path": mock_mpv
        }

        # Mock stream from Torrentio
        mock_stream = Stream(
            info_hash="1234567890abcdef1234567890abcdef12345678",
            file_idx=0,
            title="The.Shawshank.Redemption.1994.1080p.BluRay.x264\n👤 100 💾 2.5 GB ⚙️ Torrentio",
            quality="1080p",
            size_bytes=2500000000,
            seeders=100,
            raw_name="The.Shawshank.Redemption.1994.1080p.BluRay.x264"
        )
        mock_torrentio_inst = MagicMock()
        mock_torrentio_inst.get_movie_streams.return_value = [mock_stream]
        mock_torrentio_cls.return_value = mock_torrentio_inst

        # Mock TorBox responses
        mock_torbox_inst = MagicMock()
        mock_torbox_inst.check_cached.return_value = {mock_stream.info_hash: True}
        mock_torbox_inst.create_torrent.return_value = 42
        mock_torbox_inst.wait_for_torrent_ready.return_value = TorrentInfo(
            id=42,
            name="Shawshank Redemption",
            size=2500000000,
            hash=mock_stream.info_hash,
            state="cached",
            progress=1.0,
            files=[TorrentFile(id=1, name="Shawshank.Redemption.1994.1080p.mkv", size=2500000000)]
        )
        mock_torbox_inst.request_download_link.return_value = "https://cdn.torbox.app/download/42/1/Shawshank.mkv"
        mock_torbox_cls.return_value = mock_torbox_inst

        test_args = ["cli.py", "tt0111161"]
        with patch.object(sys, "argv", test_args):
            with patch("builtins.input", return_value="n"):
                cli.main()

        arg_line = self._wait_and_read_log(log_file)

        if os.path.exists(log_file):
            os.remove(log_file)
        if os.path.exists(mock_mpv):
            os.remove(mock_mpv)

        self.assertIn("--force-window=yes", arg_line)
        self.assertIn("https://cdn.torbox.app/download/42/1/Shawshank.mkv", arg_line)

    def test_launch_mpv_headers(self):
        """Verifies CLI launch_mpv function formats custom headers into --http-header-fields."""
        log_file = tempfile.NamedTemporaryFile(delete=False).name
        mock_mpv = create_mock_player_script(log_file)

        headers = {"User-Agent": "TorBoxCLI/2.0.2", "Authorization": "Bearer test"}
        cli.launch_mpv("https://cdn.torbox.app/stream.mkv", mpv_path=mock_mpv, headers=headers)

        arg_line = self._wait_and_read_log(log_file)

        if os.path.exists(log_file):
            os.remove(log_file)
        if os.path.exists(mock_mpv):
            os.remove(mock_mpv)

        self.assertIn("--force-window=yes", arg_line)
        self.assertIn("https://cdn.torbox.app/stream.mkv", arg_line)
        self.assertIn("--http-header-fields=", arg_line)
        self.assertIn("User-Agent: TorBoxCLI/2.0.2", arg_line)

    @patch("cli.load_config")
    @patch("cli.get_api_key")
    def test_cli_missing_api_key_exits(self, mock_get_api_key, mock_load_config):
        """Verifies CLI exits with status 1 if API key is empty."""
        mock_get_api_key.return_value = ""
        mock_load_config.return_value = {"torrentio_base_url": "https://torrentio.strem.fun"}

        test_args = ["cli.py", "tt0111161"]
        with patch.object(sys, "argv", test_args):
            with self.assertRaises(SystemExit) as cm:
                cli.main()
            self.assertEqual(cm.exception.code, 1)

    def test_pick_file_auto_selects_matching_episode(self):
        """Verifies pick_file auto-selects the file matching episode hint in multi-file torrents."""
        files = [
            TorrentFile(id=1, name="Breaking.Bad.S01E01.1080p.mkv", size=1500000000),
            TorrentFile(id=2, name="Breaking.Bad.S01E02.1080p.mkv", size=1500000000),
        ]
        selected = cli.pick_file(files, episode_hint="s01e02")
        self.assertIsNotNone(selected)
        self.assertEqual(selected.id, 2)
        self.assertEqual(selected.name, "Breaking.Bad.S01E02.1080p.mkv")


if __name__ == "__main__":
    unittest.main()
