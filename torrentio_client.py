"""
Torrentio (Stremio addon) API client.
Fetches torrent streams for movies and TV series episodes.
"""

import re
import sys
from dataclasses import dataclass
from typing import Optional

import requests

DEFAULT_BASE_URL = "https://torrentio.strem.fun"


@dataclass
class Stream:
    """A torrent stream result from Torrentio."""
    info_hash: str
    file_idx: Optional[int]
    title: str
    quality: str
    size_bytes: Optional[int]
    seeders: Optional[int]
    raw_name: str

    @property
    def size_human(self) -> str:
        if self.size_bytes is None:
            return "?"
        size = self.size_bytes
        for unit in ("B", "KB", "MB", "GB", "TB"):
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} PB"

    @property
    def magnet(self) -> str:
        """Build a magnet URI from the infohash."""
        return f"magnet:?xt=urn:btih:{self.info_hash}"

    def display_line(self) -> str:
        parts = [self.quality or "???"]
        if self.size_bytes:
            parts.append(self.size_human)
        if self.seeders is not None:
            parts.append(f"👤 {self.seeders}")
        if self.title:
            parts.append(self.title[:60])
        return " | ".join(parts)


def _parse_size(size_str: str) -> Optional[int]:
    """Parse a human-readable size string like '1.5 GB' into bytes."""
    if not size_str:
        return None
    # Require at least one digit before the unit (avoids matching bare "." in filenames)
    match = re.search(r"(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)\b", size_str, re.IGNORECASE)
    if not match:
        return None
    value = float(match.group(1))
    unit = match.group(2).upper()
    multipliers = {"B": 1, "KB": 1024, "MB": 1024**2, "GB": 1024**3, "TB": 1024**4}
    return int(value * multipliers.get(unit, 1))


def _parse_quality(text: str) -> str:
    """Extract quality label from title text."""
    # Try common quality patterns
    for q in ("2160p", "4K", "1080p", "720p", "480p", "360p"):
        if q.lower() in text.lower():
            return q
    # Check for CAM/TS/SCR
    for q in ("CAM", "TS", "TC", "SCR", "R5", "DVDSCR", "HDRip", "WEBRip", "BluRay", "BDRip", "WEB-DL"):
        if q.lower() in text.lower():
            return q
    return ""


def _parse_seeders(text: str) -> Optional[int]:
    """Extract seeder count from title text."""
    match = re.search(r"[👤S]\s*(\d+)", text)
    if match:
        return int(match.group(1))
    match = re.search(r"(\d+)\s*(?:seeds?|seeders?)", text, re.IGNORECASE)
    if match:
        return int(match.group(1))
    return None


class TorrentioClient:
    """Client for the Torrentio Stremio addon API."""

    def __init__(self, base_url: str = DEFAULT_BASE_URL):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
            "Accept": "application/json",
        })

    def _fetch_streams(self, path: str) -> list[Stream]:
        """Fetch and parse streams from a Torrentio endpoint."""
        url = f"{self.base_url}/{path}"
        try:
            resp = self.session.get(url, timeout=10)
            resp.raise_for_status()

            # Detect Cloudflare blocks (returns 200 with HTML challenge page)
            content_type = resp.headers.get("Content-Type", "")
            if "text/html" in content_type or "cf-" in resp.text[:500].lower():
                raise ValueError(
                    "Torrentio blocked the request (Cloudflare). "
                    "Try a different instance or add a config string like: "
                    "https://torrentio.strem.fun/sort=qualitysize|qualityfilter=scr,cam"
                )

            data = resp.json()
        except requests.Timeout:
            print("  ⚠ Torrentio request timed out (10s)", file=sys.stderr)
            raise ValueError("Torrentio timed out. The service may be down or blocking your connection.")
        except requests.RequestException as e:
            print(f"  ⚠ Torrentio request failed: {e}", file=sys.stderr)
            raise ValueError(f"Torrentio request failed: {e}")
        except ValueError as e:
            # Re-raise our custom ValueError, catch JSON parse errors
            if "Torrentio" in str(e) or "Cloudflare" in str(e) or "timed out" in str(e):
                raise
            print("  ⚠ Torrentio returned invalid JSON", file=sys.stderr)
            raise ValueError("Torrentio returned an unexpected response (possibly a Cloudflare challenge).")

        streams = []
        for entry in data.get("streams", []):
            info_hash = entry.get("infoHash")
            if not info_hash:
                continue

            title = entry.get("title", "")
            name = entry.get("name", "")
            full_text = f"{name} {title}"

            streams.append(Stream(
                info_hash=info_hash.lower(),
                file_idx=entry.get("fileIdx"),
                title=title.strip(),
                quality=_parse_quality(full_text),
                size_bytes=_parse_size(full_text),
                seeders=_parse_seeders(full_text),
                raw_name=name,
            ))

        return streams

    def get_movie_streams(self, imdb_id: str) -> list[Stream]:
        """
        Get torrent streams for a movie.
        imdb_id: e.g. 'tt0111161'
        """
        return self._fetch_streams(f"stream/movie/{imdb_id}.json")

    def get_series_streams(self, imdb_id: str, season: int, episode: int) -> list[Stream]:
        """
        Get torrent streams for a TV series episode.
        imdb_id: e.g. 'tt0903747'
        """
        return self._fetch_streams(f"stream/series/{imdb_id}/{season}/{episode}.json")
