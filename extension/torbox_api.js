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
        batch.forEach(h => { result[h] = false; });
      }
    } catch (e) {
      if (e.status === 403) {
        throw new Error(
          "TorBox returned 403 Forbidden. Your API key may be invalid or expired."
        );
      }
      // Network/timeout error — mark batch as uncached, don't hang
      batch.forEach(h => { result[h] = false; });
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
        return torrentData.torrent_id || torrentData.id || null;
      }
      return torrentData;
    } else {
      const error = data.error || "UNKNOWN";
      const detail = data.detail || "Unknown error";
      console.warn(`TorBox error: ${error} - ${detail}`);
      return null;
    }
  } catch (e) {
    console.warn("createTorrent failed:", e);
    return null;
  }
}

// ─── Torrent List / Info ────────────────────────────────────────────────────

/**
 * Parse raw torrent data from the API into a clean object.
 */
function parseTorrent(raw) {
  const files = (raw.files || []).map(f => ({
    id: f.id || 0,
    name: f.name || "",
    short_name: f.short_name || "",
    size: f.size || 0,
    size_human: humanSize(f.size || 0),
  }));

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
  if (torrentId) params.id = torrentId;

  try {
    const data = await torboxGet(apiKey, "torrents/mylist", params, 10000);
    if (!data.success) return [];

    let raw = data.data || [];
    if (!Array.isArray(raw)) raw = [raw];

    return raw.map(parseTorrent);
  } catch (e) {
    console.warn("getTorrentList failed:", e);
    return [];
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
    if (torrents.length > 0) {
      const t = torrents[0];
      if (isReady(t.state)) return t;
      if (onProgress) onProgress(t);
    }
    await new Promise(r => setTimeout(r, pollInterval * 1000));
  }

  return null; // timed out
}

// ─── Download Link ──────────────────────────────────────────────────────────

/**
 * Get a permalink URL for streaming a specific file.
 * Uses redirect=true so the URL is stable (doesn't expire).
 */
function torboxGetDownloadUrl(apiKey, torrentId, fileId) {
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
  if (VIDEO_EXTS.has(ext)) return true;
  if (SKIP_EXTS.has(ext)) return false;
  // Skip obvious non-video paths
  const lower = filename.toLowerCase();
  if (["subtitle", "subs/", "sample/", "proof", "cover", "poster", "artwork"].some(s => lower.includes(s))) return false;
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
 *   2. For series: match episode pattern in filename among video files
 *   3. Pick the largest video file (by size)
 *   4. If no video extension match, pick largest non-skip file
 *   5. Last resort: largest file overall
 */
function autoPickFile(files, fileIdx, season, episode) {
  if (!files || files.length === 0) return null;

  // 1. If fileIdx is provided, validate that it points to an actual video file (not .nfo / .txt)
  if (fileIdx != null) {
    const candidate = files.find(f => f.id === fileIdx || f.id === fileIdx + 1);
    if (candidate && isVideoFile(candidate.name) && candidate.size > 20_000_000) {
      return candidate;
    }
  }

  // Single file torrent
  if (files.length === 1) {
    const ext = getFileExt(files[0].name);
    if (SKIP_EXTS.has(ext)) return null;
    return files[0];
  }

  // 2. For series: try episode pattern matching among video files
  if (season && episode) {
    const s = parseInt(season);
    const e = parseInt(episode);
    const sp = String(s).padStart(2, "0");
    const ep = String(e).padStart(2, "0");

    // Tier 1: Season+Episode patterns (high confidence — match both S and E)
    const tier1Patterns = [
      new RegExp(`s${sp}[.\s_-]?e${ep}(?!\d)`, "i"),         // s01e05, s01.e05, s01_e05
      new RegExp(`s${s}[.\s_-]?e${ep}(?!\d)`, "i"),           // s1e05
      new RegExp(`s${sp}[.\s_-]?e${e}(?!\d)`, "i"),           // s01e5
      new RegExp(`s${s}[.\s_-]?e${e}(?!\d)`, "i"),            // s1e5
      new RegExp(`s${sp}[.\s_-]?ep${ep}(?!\d)`, "i"),         // s01ep05
      new RegExp(`${sp}x${ep}(?!\d)`, "i"),                    // 01x05
      new RegExp(`${s}x${ep}(?!\d)`, "i"),                     // 1x05
      new RegExp(`season\s*${sp}[^a-z]*episode\s*${ep}(?!\d)`, "i"), // season 01 episode 05
      new RegExp(`season\s*${s}[^a-z]*episode\s*${e}(?!\d)`, "i"),   // season 1 episode 5
    ];

    for (const rx of tier1Patterns) {
      for (const f of files) {
        if (rx.test(f.name) && isVideoFile(f.name)) return f;
      }
      for (const f of files) {
        if (rx.test(f.name) && f.size > 100_000_000) return f;
      }
    }

    // Tier 2: Episode-only patterns (lower confidence — verify season context in path/name)
    const tier2Patterns = [
      new RegExp(`(?:^|[\s._\-\[/])e${ep}(?!\d)`, "i"),       // e05 at word boundary
      new RegExp(`(?:^|[\s._\-\[/])ep${ep}(?!\d)`, "i"),      // ep05 at word boundary
      new RegExp(`(?:^|[\s._\-\[/])ep\s+${ep}(?!\d)`, "i"),   // ep 05
      new RegExp(`(?:^|[\s._\-/])episode[\s._]*${ep}(?!\d)`, "i"), // episode 05, episode.05
      new RegExp(`\b${ep}\s*(?:of|/)\s*\d+`, "i"),             // 05 of 24, 05/24
      new RegExp(`(?:^|\s|\.|_|-)${ep}\.(?:mkv|mp4|avi)`, "i"), // 05.mkv at boundary
    ];

    // Verify season context: the file path should reference the correct season
    const seasonCtx = [
      new RegExp(`s${sp}|s${s}|season\s*${sp}|season\s*${s}`, "i"),
    ];

    for (const rx of tier2Patterns) {
      for (const f of files) {
        if (!rx.test(f.name) || !isVideoFile(f.name)) continue;
        // Accept if season context is found in the file path, or if there's no season info at all
        const hasSeasonRef = seasonCtx.some(sr => sr.test(f.name));
        const hasAnySeasonRef = /s\d+|season/i.test(f.name);
        if (hasSeasonRef || !hasAnySeasonRef) return f;
      }
    }
  }
  }

  // 3. Pick the largest video file
  const videoFiles = files.filter(f => isVideoFile(f.name) && f.size > 10_000_000);
  if (videoFiles.length > 0) {
    return videoFiles.reduce((a, b) => a.size > b.size ? a : b);
  }

  // 4. Filter out known non-video/skip extensions, pick largest
  const nonSkip = files.filter(f => !SKIP_EXTS.has(getFileExt(f.name)));
  if (nonSkip.length > 0) {
    return nonSkip.reduce((a, b) => a.size > b.size ? a : b);
  }

  // 5. Last resort: largest file overall
  return files.reduce((a, b) => a.size > b.size ? a : b);
}
