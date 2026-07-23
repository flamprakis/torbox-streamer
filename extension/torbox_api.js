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
 *   1. Single file → return it
 *   2. For series: match episode pattern in filename
 *   3. Pick the largest video file (by size)
 *   4. If no video extension match, pick largest non-skip file
 *   5. Last resort: largest file overall
 */
function autoPickFile(files, fileIdx, season, episode) {
  if (!files || files.length === 0) return null;

  // Single file
  if (files.length === 1) return files[0];

  // For series: try episode pattern matching
  if (season && episode) {
    const s = parseInt(season);
    const e = parseInt(episode);
    const patterns = [
      `s${String(s).padStart(2, "0")}e${String(e).padStart(2, "0")}`,
      `s${s}e${String(e).padStart(2, "0")}`,
      `${String(s).padStart(2, "0")}x${String(e).padStart(2, "0")}`,
      ` - ${e} `,
      ` - ${String(e).padStart(2, "0")} `,
      `e${String(e).padStart(2, "0")}`,
    ];

    for (const pattern of patterns) {
      // Try video files first
      for (const f of files) {
        if (f.name.toLowerCase().includes(pattern) && isVideoFile(f.name)) return f;
      }
      // Fallback: large files (>100MB) with matching name
      for (const f of files) {
        if (f.name.toLowerCase().includes(pattern) && f.size > 100_000_000) return f;
      }
    }
  }

  // Pick the largest video file
  const videoFiles = files.filter(f => isVideoFile(f.name));
  if (videoFiles.length > 0) {
    return videoFiles.reduce((a, b) => a.size > b.size ? a : b);
  }

  // Filter out known non-video, pick largest
  const nonSkip = files.filter(f => !SKIP_EXTS.has(getFileExt(f.name)));
  if (nonSkip.length > 0) {
    return nonSkip.reduce((a, b) => a.size > b.size ? a : b);
  }

  // Last resort: largest file
  return files.reduce((a, b) => a.size > b.size ? a : b);
}
