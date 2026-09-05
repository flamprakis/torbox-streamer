/**
 * TorBox API Client (JavaScript)
 * Ported from torbox_client.py — all TorBox API calls run directly in the extension.
 *
 * Every function takes `apiKey` as the first parameter.
 * Config is read from browser.storage.local by the caller (background.js).
 */

const TORBOX_API = "https://api.torbox.app/v1/api";

// ─── Helpers ────────────────────────────────────────────────────────────────

function humanSize(bytes) {
  if (bytes == null || bytes === 0) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  for (const unit of units) {
    if (size < 1024) return `${size.toFixed(1)} ${unit}`;
    size /= 1024;
  }
  return `${size.toFixed(1)} PB`;
}

async function torboxGet(apiKey, endpoint, params = {}, timeout = 30000) {
  const url = new URL(`${TORBOX_API}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!resp.ok) {
      const err = new Error(`HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function torboxPost(apiKey, endpoint, formData = {}, timeout = 30000) {
  const url = `${TORBOX_API}/${endpoint}`;
  const body = new URLSearchParams(formData);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      signal: controller.signal,
    });
    if (!resp.ok) {
      const err = new Error(`HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Cache Check ────────────────────────────────────────────────────────────

/**
 * Check which hashes are cached on TorBox servers.
 * Returns a Map of hash (lowercase) → boolean.
 * Batches in groups of 20 to avoid URL length limits.
 */
async function torboxCheckCached(apiKey, hashes) {
  const result = {};
  const uniqueHashes = [...new Set(hashes.map(h => h.toLowerCase()))];
  const batchSize = 20;

  for (let i = 0; i < uniqueHashes.length; i += batchSize) {
    const batch = uniqueHashes.slice(i, i + batchSize);
    const hashStr = batch.join(",");

    try {
      const data = await torboxGet(apiKey, "torrents/checkcached", {
        hash: hashStr,
        format: "object",
        list_files: "false",
      }, 10000);

      if (data.success && data.data) {
        const respData = data.data;
        if (typeof respData === "object" && !Array.isArray(respData)) {
          // Object format: { hash: cachedInfo | null }
          for (const [hashKey, cachedInfo] of Object.entries(respData)) {
            result[hashKey.toLowerCase()] = cachedInfo != null && cachedInfo !== false;
          }
        } else if (Array.isArray(respData)) {
          // Array format: list of cached hashes
          for (const item of respData) {
            if (typeof item === "string") {
              result[item.toLowerCase()] = true;
            }
          }
        }
      } else {
        throw new Error(data.detail || "TorBox could not check the cache. Please try again.");
      }
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        throw new Error(
          "TorBox rejected your API key. It may be invalid or expired."
        );
      }
      // A failed request does not establish that a torrent is uncached.
      throw new Error(`TorBox cache check failed: ${e.message}`);
    }
  }

  // Ensure all original hashes have a result
  for (const h of hashes) {
    const lower = h.toLowerCase();
    if (!(lower in result)) result[lower] = false;
  }

  return result;
}

// ─── Create Torrent ─────────────────────────────────────────────────────────

/**
 * Add a torrent via magnet link.
 * Returns the torrent_id if successful, or null on failure.
 */
async function torboxCreateTorrent(apiKey, magnet) {
  try {
    const data = await torboxPost(apiKey, "torrents/createtorrent", { magnet }, 60000);

    if (data.success) {
      const torrentData = data.data || {};
      if (typeof torrentData === "object") {
        return torrentData.torrent_id ?? torrentData.id ?? null;
      }
      return torrentData;
    } else {
      const error = data.error || "UNKNOWN";
      const detail = data.detail || "Unknown error";
      throw new Error(`TorBox error: ${error} - ${detail}`);
    }
  } catch (e) {
    throw new Error(`Could not add torrent: ${e.message}`);
  }
}

// ─── Torrent List / Info ────────────────────────────────────────────────────

/**
 * Parse raw torrent data from the API into a clean object.
 */
function parseTorrent(raw) {
  const files = (raw.files || []).map((f, idx) => {
    let fileId = idx + 1; // 1-indexed fallback
    if (typeof f.id === "number") {
      fileId = f.id;
    } else if (typeof f.file_id === "number") {
      fileId = f.file_id;
    } else if (f.id != null && !isNaN(parseInt(f.id))) {
      fileId = parseInt(f.id);
    } else if (f.file_id != null && !isNaN(parseInt(f.file_id))) {
      fileId = parseInt(f.file_id);
    }
    const fileName = f.name || f.short_name || f.path || f.s3_path || f.filename || "";
    return {
      id: fileId,
      file_id: fileId,
      name: fileName,
      short_name: f.short_name || fileName,
      size: f.size || 0,
      size_human: humanSize(f.size || 0),
    };
  });

  return {
    id: raw.id || 0,
    hash: raw.hash || "",
    name: raw.name || "",
    size: raw.size || 0,
    size_human: humanSize(raw.size || 0),
    state: raw.download_state || raw.state || "",
    progress: raw.progress || 0,
    files,
  };
}

function isReady(state) {
  return ["completed", "cached", "uploading"].includes(state);
}

/**
 * Get the user's torrent list, or a specific torrent by ID.
 */
async function torboxGetTorrentList(apiKey, torrentId = null) {
  const params = { bypass_cache: "true" };
  if (torrentId != null) params.id = torrentId;

  try {
    const data = await torboxGet(apiKey, "torrents/mylist", params, 10000);
    if (!data.success) throw new Error(data.detail || "TorBox could not retrieve the torrent list.");

    let raw = data.data || [];
    if (!Array.isArray(raw)) raw = [raw];

    return raw.map(parseTorrent);
  } catch (e) {
    throw new Error(`Could not retrieve torrent status: ${e.message}`);
  }
}

/**
 * Poll until a torrent is ready (downloaded/cached).
 * Returns the torrent info when ready, or null on timeout.
 * Calls onProgress(torrent) on each poll cycle if provided.
 */
async function torboxWaitForReady(apiKey, torrentId, { timeout = 120, pollInterval = 3, onProgress } = {}) {
  const start = Date.now();

  while (Date.now() - start < timeout * 1000) {
    const torrents = await torboxGetTorrentList(apiKey, torrentId);
    const t = torrents.find(item => String(item.id) === String(torrentId));
    if (t) {
      if (isReady(t.state)) return t;
      if (["failed", "error", "cancelled"].includes(t.state)) {
        throw new Error(`Torrent download ${t.state}. Please choose another source.`);
      }
      if (onProgress) onProgress(t);
    }
    const remaining = timeout * 1000 - (Date.now() - start);
    if (remaining > 0) await new Promise(resolve => { setTimeout(resolve, Math.min(pollInterval * 1000, remaining)); });
  }

  return null; // timed out
}

// ─── Download Link ──────────────────────────────────────────────────────────

/**
 * Get a permalink URL for streaming a specific file.
 * Uses redirect=true so the URL is stable (doesn't expire).
 */
function torboxGetDownloadUrl(apiKey, torrentId, fileId) {
  if (!apiKey || torrentId == null || String(torrentId).trim() === "" ||
      !Number.isInteger(Number(torrentId)) || Number(torrentId) < 0 ||
      fileId == null || String(fileId).trim() === "" ||
      !Number.isInteger(Number(fileId)) || Number(fileId) < 0) {
    console.error("[TorBox Streamer] Invalid fileId provided to torboxGetDownloadUrl:", fileId);
    return null;
  }
  return (
    `${TORBOX_API}/torrents/requestdl` +
    `?token=${encodeURIComponent(apiKey)}` +
    `&torrent_id=${torrentId}` +
    `&file_id=${fileId}` +
    `&redirect=true`
  );
}

// ─── Delete Torrent ─────────────────────────────────────────────────────────

/**
 * Delete a torrent from the user's account.
 */
async function torboxDeleteTorrent(apiKey, torrentId) {
  try {
    const data = await torboxPost(apiKey, "torrents/controltorrent", {
      torrent_id: torrentId,
      operation: "Delete",
    });
    return data.success || false;
  } catch (e) {
    console.warn("deleteTorrent failed:", e);
    return false;
  }
}

// ─── File Auto-Selection ────────────────────────────────────────────────────

const VIDEO_EXTS = new Set([".mkv", ".mp4", ".avi", ".webm", ".mov", ".m4v", ".wmv", ".flv", ".ts", ".m2ts"]);
const SKIP_EXTS = new Set([
  ".srt", ".sub", ".ass", ".ssa", ".idx", ".nfo", ".txt",
  ".vtt",
  ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tbn",
  ".xml", ".html", ".htm", ".url", ".lnk",
]);
const BROWSER_PLAYABLE_EXTS = new Set([".mp4", ".webm", ".mov", ".m4v"]);

function getFileExt(filename) {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

function isVideoFile(filename) {
  const ext = getFileExt(filename);
  if (SKIP_EXTS.has(ext)) return false;
  // Skip obvious non-video or sample/extra paths
  const tokens = filename.toLowerCase().split(/[\s._/\\-]+/);
  if (["subtitles", "subs", "sample", "samples", "proof", "cover", "poster", "artwork", "featurette", "featurettes"].some(s => tokens.includes(s))) return false;
  if (VIDEO_EXTS.has(ext)) return true;
  // No extension — might still be video
  if (!ext) return true;
  return false;
}

function isBrowserPlayable(filename) {
  return BROWSER_PLAYABLE_EXTS.has(getFileExt(filename));
}

/**
 * Intelligently pick the right file from a torrent.
 * Strategy:
 *   1. If fileIdx points to a valid video file (>20MB, video ext), use it
 *   2. For series: match the requested episode or ask for a manual selection
 *   3. For movies: match title keywords, then choose the largest video
 */
function autoPickFile(files, fileIdx, season, episode, searchTitle = "") {
  if (!files || files.length === 0) return null;

  // 1. If fileIdx is provided, validate that it points to an actual video file (>20MB, video ext)
  if (fileIdx != null) {
    // Torrentio supplies a zero-based file index; TorBox file IDs need not match it.
    const idxNum = Number(fileIdx);
    const candidate = Number.isInteger(idxNum) && idxNum >= 0 ? files[idxNum] : null;
    if (candidate && isVideoFile(candidate.name) && candidate.size > 20_000_000) {
      return candidate;
    }
  }

  // Single file torrent
  if (files.length === 1) {
    return isVideoFile(files[0].name) ? files[0] : null;
  }

  // 2. Title-based keyword matching (crucial for movie/series packs like IMDb Top 250)
  const hasEpisode = season != null && episode != null &&
    Number.isInteger(Number(season)) && Number(season) >= 0 &&
    Number.isInteger(Number(episode)) && Number(episode) > 0;
  if (!hasEpisode && searchTitle && typeof searchTitle === "string") {
    const cleanTitle = searchTitle.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
    const stopWords = new Set(["1080p", "2160p", "720p", "480p", "bluray", "webrip", "web-dl", "remastered", "esubs", "x264", "x265", "hevc", "rarbg", "edition", "imdb", "top", "250"]);
    const keywords = cleanTitle.split(/\s+/).filter(k => k.length >= 3 && !stopWords.has(k));

    if (keywords.length > 0) {
      const videoFiles = files.filter(f => isVideoFile(f.name) && f.size > 20_000_000);
      let bestMatch = null;
      let maxHits = 0;

      for (const f of videoFiles) {
        const lowerName = f.name.toLowerCase();
        let hits = 0;
        for (const kw of keywords) {
          if (lowerName.includes(kw)) hits++;
        }
        if (hits > maxHits) {
          maxHits = hits;
          bestMatch = f;
        }
      }

      if (bestMatch && maxHits >= Math.min(2, keywords.length)) {
        return bestMatch;
      }
    }
  }

  // 3. For series: try episode pattern matching among video files
  if (hasEpisode) {
    const s = parseInt(season);
    const e = parseInt(episode);
    const sp = String(s).padStart(2, "0");
    const ep = String(e).padStart(2, "0");

    // Tier 1: Season+Episode patterns (high confidence — match both S and E)
    const tier1Patterns = [
      new RegExp(`s${sp}[.\\s_-]?e${ep}(?!\\d)`, "i"),        // s01e05, s01.e05, s01_e05
      new RegExp(`s${s}[.\\s_-]?e${ep}(?!\\d)`, "i"),          // s1e05
      new RegExp(`s${sp}[.\\s_-]?e${e}(?!\\d)`, "i"),          // s01e5
      new RegExp(`s${s}[.\\s_-]?e${e}(?!\\d)`, "i"),           // s1e5
      new RegExp(`s${sp}[.\\s_-]?ep${ep}(?!\\d)`, "i"),        // s01ep05
      new RegExp(`(?:^|[^\\d])${sp}x${ep}(?!\\d)`, "i"),     // 01x05
      new RegExp(`(?:^|[^\\d])${s}x${ep}(?!\\d)`, "i"),      // 1x05
      new RegExp(`(?:^|[^\\d])${s}x${e}(?!\\d)`, "i"),       // 1x5
      new RegExp(`season\\s*${sp}[\\s._/\\-]*episode\\s*${ep}(?!\\d)`, "i"), // season 01 episode 05
      new RegExp(`season\\s*${s}[\\s._/\\-]*episode\\s*${ep}(?!\\d)`, "i"),  // season 1 episode 05
      new RegExp(`season\\s*${s}[\\s._/\\-]*episode\\s*${e}(?!\\d)`, "i"),   // season 1 episode 5
    ];

    for (const rx of tier1Patterns) {
      for (const f of files) {
        if (rx.test(f.name) && isVideoFile(f.name)) return f;
      }
    }

    // A release can contain consecutive episodes, e.g. S01E05-E06.
    const rangePattern = new RegExp(`s0*${s}[.\\s_-]?e(\\d+)[-–]e?(\\d+)(?!\\d)`, "i");
    for (const f of files) {
      const range = f.name.match(rangePattern);
      if (range && isVideoFile(f.name) && e >= Number(range[1]) && e <= Number(range[2])) return f;
    }

    // Tier 2: Episode-only patterns (lower confidence — verify season context in path/name)
    const tier2Patterns = [
      new RegExp(`(?:^|[\\s._\\[/\\-])e${ep}(?!\\d)`, "i"),       // e05 at word boundary
      new RegExp(`(?:^|[\\s._\\[/\\-])ep${ep}(?!\\d)`, "i"),      // ep05 at word boundary
      new RegExp(`(?:^|[\\s._\\[/\\-])ep\\s+${ep}(?!\\d)`, "i"),   // ep 05
      new RegExp(`(?:^|[\\s._/\\-])episode[\\s._]*${ep}(?!\\d)`, "i"), // episode 05, episode.05
      new RegExp(`\\b${ep}\\s*(?:of|/)\\s*\\d+`, "i"),            // 05 of 24, 05/24
      new RegExp(`(?:^|\\s|\\.|_|-)${ep}\\.(?:mkv|mp4|avi)`, "i"), // 05.mkv at boundary
      new RegExp(`(?:^|[\\s/_-])${ep}(?=[\\s._-]|$)`, "i"), // Season 04/05 - Title; S02 - 05
    ];

    // Verify season context: the file path should reference the correct season
    const seasonCtx = [
      new RegExp(`(?:^|[^a-z0-9])(?:s|season\\s*)0*${s}(?!\\d)`, "i"),
    ];

    for (const rx of tier2Patterns) {
      for (const f of files) {
        if (!rx.test(f.name) || !isVideoFile(f.name)) continue;
        // Accept if season context is found in the file path, or if there's no season info at all
        const hasSeasonRef = seasonCtx.some(sr => sr.test(f.name));
        const hasAnySeasonRef = /(?:^|[^a-z0-9])(?:s\d+|season\s*\d+)/i.test(f.name);
        if (hasSeasonRef || !hasAnySeasonRef) return f;
      }
    }
    return null;
  }

  // 4. Pick the largest video file
  const videoFiles = files.filter(f => isVideoFile(f.name));
  if (videoFiles.length > 0) {
    return videoFiles.reduce((a, b) => a.size > b.size ? a : b);
  }

  return null;
}

// ─── Subtitles Helper ────────────────────────────────────────────────────────

function parsePreferredLanguages(prefString, userBrowserLang = "en") {
  const defaultLangs = ["en"];
  if (userBrowserLang) {
    const shortLang = userBrowserLang.slice(0, 2).toLowerCase();
    if (!defaultLangs.includes(shortLang)) defaultLangs.push(shortLang);
  }

  if (!prefString || typeof prefString !== "string") return defaultLangs;

  const result = new Set();
  const tokens = prefString.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);

  for (const token of tokens) {
    if (token === "browser") {
      if (userBrowserLang) result.add(userBrowserLang.slice(0, 2).toLowerCase());
    } else {
      result.add(token.split(/[-_]/)[0]);
    }
  }

  // Ensure English is always included as requested
  result.add("en");

  return Array.from(result);
}
