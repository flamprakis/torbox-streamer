"""Regression tests exercise the real CLI/client implementations at their boundaries."""

import contextlib
import io
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "cli"))
import cli
from torbox_client import TorBoxClient, TorrentFile
from torrentio_client import TorrentioClient


class TestCLIContracts(unittest.TestCase):
    def test_series_stream_request_uses_stremio_video_identifier(self):
        client = TorrentioClient()
        response = Mock(headers={"Content-Type": "application/json"}, text='{"streams": []}')
        response.json.return_value = {"streams": [{
            "infoHash": "A" * 40, "fileIdx": 0,
            "name": "Torrentio 1080p", "title": "Episode S00E02\n👤 45 💾 1.5 GB",
        }]}
        with patch.object(client.session, "get", return_value=response) as get:
            streams = client.get_series_streams("tt0903747", 0, 2)
        get.assert_called_once_with("https://torrentio.strem.fun/stream/series/tt0903747:0:2.json", timeout=10)
        self.assertEqual(len(streams), 1)
        self.assertEqual(streams[0].info_hash, "a" * 40)
        self.assertEqual(streams[0].file_idx, 0)
        self.assertEqual(streams[0].seeders, 45)
        self.assertEqual(streams[0].size_bytes, int(1.5 * 1024**3))

    def test_torbox_cache_authentication_errors_are_not_reported_as_uncached(self):
        for status in (401, 403):
            with self.subTest(status=status):
                client = TorBoxClient("test-key")
                response = requests.Response()
                response.status_code = status
                with patch.object(client.session, "get", side_effect=requests.HTTPError(response=response)):
                    with self.assertRaisesRegex(ValueError, "API key may be invalid"):
                        client.check_cached(["a" * 40])

    def test_cache_batches_deduplicate_and_normalize_hashes(self):
        hashes = [f"{index:040x}" for index in range(25)]
        client = TorBoxClient("test-key")
        response = Mock()
        response.json.return_value = {"success": True, "data": {hashes[0].upper(): {"files": []}}}
        with patch.object(client.session, "get", return_value=response) as get:
            cached = client.check_cached([*hashes, hashes[0].upper()])
        self.assertEqual(get.call_count, 2)
        self.assertEqual(len(get.call_args_list[0].kwargs["params"]["hash"].split(",")), 20)
        self.assertEqual(len(get.call_args_list[1].kwargs["params"]["hash"].split(",")), 5)
        self.assertEqual(cached, {value: value == hashes[0] for value in hashes})
        self.assertEqual(client.session.headers["Authorization"], "Bearer test-key")

    def test_permalink_encodes_credentials_without_changing_query_shape(self):
        client = TorBoxClient("token&redirect=false+with space")
        query = parse_qs(urlsplit(client.request_download_link(0, 0)).query)
        self.assertEqual(query, {
            "token": [client.api_key], "torrent_id": ["0"], "file_id": ["0"], "redirect": ["true"],
        })

    def test_zero_torrent_id_survives_creation_and_list_filter(self):
        client = TorBoxClient("test-key")
        response = Mock()
        response.json.side_effect = [
            {"success": True, "data": {"torrent_id": 0}},
            {"success": True, "data": []},
        ]
        with patch.object(client.session, "post", return_value=response):
            self.assertEqual(client.create_torrent("magnet:?xt=urn:btih:" + "a" * 40), 0)
        with patch.object(client.session, "get", return_value=response) as get:
            self.assertEqual(client.get_torrent_list(0), [])
        self.assertEqual(get.call_args.kwargs["params"]["id"], 0)

    def test_episode_selection_skips_subtitle_and_episode_number_prefixes(self):
        files = [
            TorrentFile(1, "Show.S01E020.mkv", 2000),
            TorrentFile(2, "Show.S01E02.srt", 100),
            TorrentFile(3, "Show.S01E02.mkv", 1000),
        ]
        with patch("builtins.input", side_effect=AssertionError("Matching episode should not prompt")):
            self.assertEqual(cli.pick_file(files, "s01e02").id, 3)

    def test_episode_parser_requires_complete_identifier_and_positive_episode(self):
        self.assertEqual(cli.parse_episode("S00E02"), (0, 2))
        for value in ("s01e01junk", "s01e00", "s-1e1"):
            self.assertIsNone(cli.parse_episode(value))

    def test_closed_input_cancels_file_selection_instead_of_looping(self):
        with patch("builtins.input", side_effect=EOFError):
            self.assertIsNone(cli.pick_file([TorrentFile(1, "one.mkv", 1), TorrentFile(2, "two.mkv", 2)]))

    def test_mpv_receives_headers_as_one_argument_on_every_platform(self):
        with patch.object(cli.subprocess, "Popen") as spawn, contextlib.redirect_stdout(io.StringIO()):
            cli.launch_mpv("https://cdn.example/movie.mkv", "/player with spaces", {"User-Agent": "TorBox CLI"})
        args, kwargs = spawn.call_args
        self.assertEqual(args[0], ["/player with spaces", "--force-window=yes", "https://cdn.example/movie.mkv", "--http-header-fields=User-Agent: TorBox CLI"])
        self.assertEqual(kwargs["stdout"], subprocess.DEVNULL)
        self.assertEqual(kwargs["stderr"], subprocess.DEVNULL)


if __name__ == "__main__":
    unittest.main()
