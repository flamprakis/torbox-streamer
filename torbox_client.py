"""
TorBox API client.
Wraps the torrent endpoints: checkcached, createtorrent, mylist, requestdl, controltorrent.
"""

import time
from dataclasses import dataclass, field
from typing import Optional

import requests

BASE_URL = "https://api.torbox.app/v1/api"


@dataclass
class TorrentFile:
    """A file within a torrent."""
    id: int
    name: str
    size: int
    short_name: str = ""

    @property
    def size_human(self) -> str:
        size = self.size
        for unit in ("B", "KB", "MB", "GB", "TB"):
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} PB"


@dataclass
class TorrentInfo:
    """A torrent in the user's TorBox account."""
    id: int
    hash: str
    name: str
    size: int
    state: str
    files: list = field(default_factory=list)
    progress: float = 0.0

    @property
    def is_ready(self) -> bool:
        return self.state in ("completed", "cached", "uploading")

    @property
    def size_human(self) -> str:
        size = self.size
        for unit in ("B", "KB", "MB", "GB", "TB"):
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} PB"


class TorBoxClient:
    """Client for the TorBox torrent API."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {api_key}",
        })

    def _get(self, endpoint: str, params: dict = None) -> dict:
        url = f"{BASE_URL}/{endpoint}"
        resp = self.session.get(url, params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def _post(self, endpoint: str, data: dict = None, files=None) -> dict:
        url = f"{BASE_URL}/{endpoint}"
        if files:
            resp = self.session.post(url, data=data, files=files, timeout=60)
        else:
            resp = self.session.post(url, data=data, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def _post_json(self, endpoint: str, json_body: dict = None) -> dict:
        """POST with a JSON body (Content-Type: application/json)."""
        url = f"{BASE_URL}/{endpoint}"
        resp = self.session.post(url, json=json_body, timeout=30)
        resp.raise_for_status()
        return resp.json()

    # ─── Cache Check ───────────────────────────────────────────────────────

    def check_cached(self, hashes: list[str]) -> dict[str, bool]:
        """
        Check which hashes are cached on TorBox servers.
        Returns a dict mapping hash -> is_cached.
        Uses POST with JSON body to avoid URL length limits.
        """
        result = {}
        # Deduplicate hashes
        unique_hashes = list(dict.fromkeys(h.lower() for h in hashes))
        batch_size = 50

        for i in range(0, len(unique_hashes), batch_size):
            batch = unique_hashes[i:i + batch_size]

            try:
                # Try POST method first (avoids URL length issues)
                data = self._post_json("torrents/checkcached", json_body={
                    "hashes": batch,
                })
            except (requests.HTTPError, Exception):
                try:
                    # Fallback: GET with multiple hash params (smaller batch)
                    data = self._get("torrents/checkcached", params=[
                        ("hash", h) for h in batch[:25]
                    ] + [("format", "object"), ("list_files", "false")])
                except requests.HTTPError as e:
                    if e.response is not None and e.response.status_code == 403:
                        raise ValueError(
                            "TorBox returned 403 Forbidden. Your API key may be invalid. "
                            "Check it at https://torbox.app/dashboard → Settings → API."
                        )
                    for h in batch:
                        result[h] = False
                    continue

            if data.get("success") and data.get("data"):
                resp_data = data["data"]
                if isinstance(resp_data, dict):
                    for hash_key, cached_info in resp_data.items():
                        result[hash_key.lower()] = cached_info is not None and cached_info != False
                elif isinstance(resp_data, list):
                    for item in resp_data:
                        if isinstance(item, dict) and item.get("hash"):
                            result[item["hash"].lower()] = True
            else:
                for h in batch:
                    result[h] = False

        # Ensure all original hashes have a result
        for h in hashes:
            h_lower = h.lower()
            if h_lower not in result:
                result[h_lower] = False

        return result

    # ─── Create Torrent ────────────────────────────────────────────────────

    def create_torrent(self, magnet: str) -> Optional[int]:
        """
        Add a torrent via magnet link.
        Returns the torrent_id if successful.
        """
        data = self._post("torrents/createtorrent", data={"magnet": magnet})

        if data.get("success"):
            torrent_data = data.get("data", {})
            # The response may contain torrent_id directly or in a nested structure
            if isinstance(torrent_data, dict):
                return torrent_data.get("torrent_id") or torrent_data.get("id")
            return torrent_data
        else:
            error = data.get("error", "UNKNOWN")
            detail = data.get("detail", "Unknown error")
            print(f"  ⚠ TorBox error: {error} - {detail}")
            return None

    # ─── Torrent List / Info ───────────────────────────────────────────────

    def get_torrent_list(self, torrent_id: int = None) -> list[TorrentInfo]:
        """
        Get the user's torrent list, or a specific torrent by ID.
        Returns parsed TorrentInfo objects with file listings.
        """
        params = {"bypass_cache": "true"}
        if torrent_id:
            params["id"] = torrent_id

        data = self._get("torrents/mylist", params=params)

        if not data.get("success"):
            return []

        torrents_raw = data.get("data", [])
        if isinstance(torrents_raw, dict):
            torrents_raw = [torrents_raw]

        torrents = []
        for t in torrents_raw:
            files = []
            for f in t.get("files", []):
                files.append(TorrentFile(
                    id=f.get("id", 0),
                    name=f.get("name", ""),
                    short_name=f.get("short_name", ""),
                    size=f.get("size", 0),
                ))

            torrents.append(TorrentInfo(
                id=t.get("id", 0),
                hash=t.get("hash", ""),
                name=t.get("name", ""),
                size=t.get("size", 0),
                state=t.get("download_state", t.get("state", "")),
                progress=t.get("progress", 0),
                files=files,
            ))

        return torrents

    def wait_for_torrent_ready(self, torrent_id: int, timeout: int = 120, poll_interval: int = 3) -> Optional[TorrentInfo]:
        """
        Poll until a torrent is ready (downloaded/cached).
        Returns the TorrentInfo when ready, or None on timeout.
        """
        start = time.time()
        while time.time() - start < timeout:
            torrents = self.get_torrent_list(torrent_id=torrent_id)
            if torrents:
                t = torrents[0]
                if t.is_ready:
                    return t
                # Print progress
                pct = int(t.progress * 100)
                print(f"\r  ⏳ State: {t.state} ({pct}%)", end="", flush=True)
            time.sleep(poll_interval)

        print()  # newline after progress
        return None

    # ─── Download Link ─────────────────────────────────────────────────────

    def request_download_link(self, torrent_id: int, file_id: int, use_permalink: bool = True) -> Optional[str]:
        """
        Get a download/stream link for a specific file in a torrent.
        If use_permalink=True, returns a permalink URL (redirect=true).
        Otherwise calls the API to get a direct CDN link.
        """
        if use_permalink:
            return (
                f"{BASE_URL}/torrents/requestdl"
                f"?token={self.api_key}"
                f"&torrent_id={torrent_id}"
                f"&file_id={file_id}"
                f"&redirect=true"
            )

        data = self._get("torrents/requestdl", params={
            "token": self.api_key,
            "torrent_id": torrent_id,
            "file_id": file_id,
        })

        if data.get("success"):
            return data.get("data")
        return None

    # ─── Control ───────────────────────────────────────────────────────────

    def delete_torrent(self, torrent_id: int) -> bool:
        """Delete a torrent from the account."""
        data = self._post("torrents/controltorrent", data={
            "torrent_id": torrent_id,
            "operation": "Delete",
        })
        return data.get("success", False)
