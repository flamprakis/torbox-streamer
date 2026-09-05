/**
 * TorBox Streamer — Background Script (v2 Pure Extension)
 * - Fetches Torrentio streams
 * - Executes TorBox API calls directly via torbox_api.js
 * - Handles optional native helper for launching mpv
 * - Routes playback (browser tab vs mpv helper)
 */

const NATIVE_HOST = "com.torbox_streamer.host";
var browser = typeof globalThis.browser !== "undefined" ? globalThis.browser : globalThis.chrome;
let nativePort = null;
let isNativeConnected = false;

const tabInfo = {};
let torrentioBaseUrl = "https://torrentio.strem.fun";

const storage = {
  get: (keys) => {
    return new Promise((resolve) => {
      try {
        if (typeof globalThis.browser !== "undefined" && globalThis.browser.storage) {
          globalThis.browser.storage.local.get(keys).then(resolve).catch(() => resolve({}));
        } else if (typeof globalThis.chrome !== "undefined" && globalThis.chrome.storage) {
          globalThis.chrome.storage.local.get(keys, (res) => resolve(res || {}));
        } else {
          resolve({});
        }
      } catch (e) {
        resolve({});
      }
    });
  },
  set: (items) => {
    return new Promise((resolve) => {
      try {
        if (typeof globalThis.browser !== "undefined" && globalThis.browser.storage) {
          globalThis.browser.storage.local.set(items).then(resolve).catch(() => resolve());
        } else if (typeof globalThis.chrome !== "undefined" && globalThis.chrome.storage) {
          globalThis.chrome.storage.local.set(items, () => resolve());
        } else {
          resolve();
        }
      } catch (e) {
        resolve();
      }
    });
  }
};

// ─── Settings & Storage ────────────────────────────────────────────────────

async function getConfig() {
  const stored = await storage.get([
    "torbox_api_key",
    "player_preference",
    "mpv_path",
    "vlc_path",
    "subtitle_languages",
    "torrentio_base_url",
    "max_results",
    "default_quality_filter",
    "enabled_qualities",
    "max_per_quality"
  ]);
  return {
    apiKey: stored.torbox_api_key || "",
    playerPref: stored.player_preference || "auto",
    mpv_path: stored.mpv_path || "",
    vlc_path: stored.vlc_path || "",
    subtitleLangs: stored.subtitle_languages || "en, browser",
    torrentioBaseUrl: stored.torrentio_base_url || "https://torrentio.strem.fun",
    maxResults: stored.max_results || 20,
    default_quality_filter: stored.default_quality_filter || "all",
    enabled_qualities: stored.enabled_qualities || ["4K", "1080p", "720p", "480p"],
    max_per_quality: stored.max_per_quality || 5
  };
}

// ─── Optional Native Helper for mpv ────────────────────────────────────────

function connectNativeHelper() {
  if (nativePort) {
    try { nativePort.disconnect(); } catch (e) {}
  }

  try {
    nativePort = browser.runtime.connectNative(NATIVE_HOST);
    isNativeConnected = true;

    nativePort.onDisconnect.addListener(() => {
      isNativeConnected = false;
      nativePort = null;
    });
  } catch (e) {
    isNativeConnected = false;
    nativePort = null;
  }
}

async function tryLaunchPlayer(streamUrl, player = "mpv", subtitles = [], headers = null) {
  const config = await getConfig();
  const customPath = player === "vlc" ? config.vlc_path : config.mpv_path;

  return new Promise((resolve) => {
    let port;
    let timer;
    let resolved = false;
    const finish = (success) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { port?.disconnect(); } catch (e) {}
      resolve(success);
    };
    try {
      port = browser.runtime.connectNative(NATIVE_HOST);
      timer = setTimeout(() => finish(false), 10000);

      port.onMessage.addListener((msg) => {
        finish(!!msg && msg.status === "ok");
      });

      port.onDisconnect.addListener(() => {
        finish(false);
      });

      port.postMessage({ action: "launch_player", player, custom_path: customPath || null, url: streamUrl, subtitles, headers });
    } catch (e) {
      finish(false);
    }
  });
}

async function tryLaunchMpv(streamUrl) {
  return tryLaunchPlayer(streamUrl, "mpv");
}

// ─── Torrentio Fetch ───────────────────────────────────────────────────────

async function fetchTorrentio(imdbId, season, episode) {
  const config = await getConfig();
  let path;
  if (season != null && episode != null) {
    path = `stream/series/${imdbId}:${season}:${episode}.json`;
  } else {
    path = `stream/movie/${imdbId}.json`;
  }

  const url = `${config.torrentioBaseUrl.replace(/\/+$/, "")}/${path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const resp = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const text = await resp.text();

    if (text.includes("<!DOCTYPE") || text.includes("cf-error") || text.includes("Cloudflare")) {
      throw new Error("Torrentio blocked by Cloudflare. Try updating Torrentio base URL in options.");
    }

    const data = JSON.parse(text);
    if (data.streams != null && !Array.isArray(data.streams)) throw new Error("Invalid stream list received.");
    const rawStreams = (data.streams || []).filter(s => s && typeof s.infoHash === "string" && s.infoHash);

    const parsedStreams = rawStreams.map((s, idx) => {
      const fullText = `${s.name || ""} ${s.title || ""}`;
      return {
        info_hash: s.infoHash.toLowerCase(),
        file_idx: s.fileIdx != null ? s.fileIdx : null,
        title: (s.title || "").trim(),
        quality: parseQuality(fullText),
        size_bytes: parseSize(fullText),
        size_human: parseSizeHuman(fullText),
        seeders: parseSeeders(fullText),
        original_index: idx,
      };
    });

    return distributeStreamsByQuality(parsedStreams, config);
  } catch (e) {
    throw new Error(`Torrentio fetch failed: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function distributeStreamsByQuality(streams, config = {}) {
  const defaultQualities = ["4K", "1080p", "720p", "480p"];
  const enabledQualities = config.enabled_qualities || defaultQualities;
  const maxPerQuality = parseInt(config.max_per_quality) || 5;
  const legacyFilter = config.default_quality_filter || "all";

  if (legacyFilter && legacyFilter !== "all") {
    return streams.filter(s => s.quality === legacyFilter).slice(0, config.maxResults || 20);
  }

  const buckets = {
    "4K": [],
    "1080p": [],
    "720p": [],
    "480p": [],
    "Other": []
  };

  for (const s of streams) {
    if (s.quality === "4K") buckets["4K"].push(s);
    else if (s.quality === "1080p") buckets["1080p"].push(s);
    else if (s.quality === "720p") buckets["720p"].push(s);
    else if (s.quality === "480p" || s.quality === "SD") buckets["480p"].push(s);
    else buckets["Other"].push(s);
  }

  const result = [];
  for (const q of defaultQualities) {
    if (enabledQualities.includes(q)) {
      result.push(...buckets[q].slice(0, maxPerQuality));
    }
  }

  const limit = config.maxResults || 20;
  if (result.length < limit) {
    const remaining = limit - result.length;
    result.push(...buckets["Other"].slice(0, remaining));
  }

  return result.slice(0, limit);
}

// ─── Parsing Helpers ────────────────────────────────────────────────────────

function parseQuality(text) {
  const t = text.toLowerCase();
  for (const q of ["2160p", "4k", "1080p", "720p", "480p", "360p"]) {
    if (t.includes(q)) return q === "4k" || q === "2160p" ? "4K" : q;
  }
  for (const q of ["web-dl", "webrip", "bluray", "bdrip", "hdrip", "dvdscr", "cam", "ts"]) {
    if (t.includes(q)) return q.toUpperCase();
  }
  return "";
}

function parseSize(text) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)\b/i);
  if (!match) return null;
  const val = parseFloat(match[1]);
  const units = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };
  return Math.floor(val * (units[match[2].toUpperCase()] || 1));
}

function parseSizeHuman(text) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)\b/i);
  return match ? `${match[1]} ${match[2].toUpperCase()}` : "?";
}

function parseSeeders(text) {
  let m = text.match(/[\u{1F464}S]\s*(\d+)/u);
  if (m) return parseInt(m[1]);
  m = text.match(/(\d+)\s*(?:seeds?|seeders?)/i);
  if (m) return parseInt(m[1]);
  return null;
}

// ─── High Level Streaming Logic ─────────────────────────────────────────────

async function handleStreamRequest(data, senderTabId, sendProgress) {
  const config = await getConfig();
  if (!config.apiKey) {
    throw new Error("TorBox API Key is missing. Please set it in the extension settings.");
  }

  const { hash, file_idx, is_cached, season, episode, title, page_title, imdb_id, media_type } = data;
  const magnet = `magnet:?xt=urn:btih:${hash}`;

  sendProgress("Adding torrent to TorBox...");
  const torrentId = await torboxCreateTorrent(config.apiKey, magnet);
  if (torrentId == null || String(torrentId).trim() === "") {
    throw new Error("Failed to add torrent to TorBox.");
  }

  // Poll for ready state
  const pollInterval = is_cached ? 1 : 3;
  const timeout = is_cached ? 30 : 300;

  sendProgress(is_cached ? "Checking torrent status..." : "Downloading torrent on TorBox...");

  const torrent = await torboxWaitForReady(config.apiKey, torrentId, {
    timeout,
    pollInterval,
    onProgress: (t) => {
      const pct = Math.floor((t.progress || 0) * 100);
      sendProgress(`Downloading: ${t.state} (${pct}%)`);
    },
  });

  if (!torrent) {
    throw new Error("Timed out waiting for torrent download on TorBox.");
  }

  // Pick file using smart file selection (filters out .nfo, .txt, samples)
  const searchTitle = page_title || title || "";
  const selectedFile = autoPickFile(torrent.files, file_idx,
    media_type === "movie" ? null : season, media_type === "movie" ? null : episode, searchTitle);

  if (!selectedFile || selectedFile.id == null || selectedFile.id === "" || isNaN(selectedFile.id)) {
    // Return file list for manual picking if auto-pick returned nothing or an invalid ID
    return {
      action: "pick_file",
      torrent_id: torrentId,
      files: torrent.files,
    };
  }

  // Get stream URL
  const streamUrl = torboxGetDownloadUrl(config.apiKey, torrentId, selectedFile.id);
  if (!streamUrl) {
    return {
      action: "pick_file",
      torrent_id: torrentId,
      files: torrent.files,
    };
  }
  // Extract bundled torrent subtitles (.srt, .vtt, .ass) filtered by user's preferred languages
  const prefLangsStr = config.subtitleLangs || "en, browser";
  const prefLangs = typeof parsePreferredLanguages === "function"
    ? parsePreferredLanguages(prefLangsStr, typeof navigator !== "undefined" ? navigator.language : "en")
    : ["en"];

  const bundledSubs = typeof extractBundledSubtitles === "function"
    ? extractBundledSubtitles(config.apiKey, torrentId, torrent.files, prefLangs)
    : [];

  let externalSubs = [];
  if (imdb_id && typeof fetchSubtitles === "function") {
    try {
      externalSubs = await fetchSubtitles(imdb_id, season, episode, media_type, prefLangs);
    } catch (e) {}
  }

  // Combine top 3 preferred subtitles for MPV / VLC launcher to keep startup instant
  const allFilteredSubs = [...bundledSubs, ...externalSubs];
  const subUrls = allFilteredSubs.slice(0, 3).map(s => s.url);

  await storage.set({
    player_bundled_subtitles: bundledSubs,
    last_stream_metadata: {
      imdb_id: imdb_id || "",
      media_type: media_type || "movie",
      season: season ?? 1,
      episode: episode ?? 1,
      torrent_id: torrentId
    }
  });

  const playableInBrowser = isBrowserPlayable(selectedFile.name);

  let launchMethod = "browser"; // default

  if (config.playerPref === "ask") {
    launchMethod = "ask";
  } else if (config.playerPref === "vlc") {
    const vlcSuccess = await tryLaunchPlayer(streamUrl, "vlc", subUrls);
    launchMethod = vlcSuccess ? "vlc" : "url_only";
  } else if (config.playerPref === "mpv") {
    const mpvSuccess = await tryLaunchPlayer(streamUrl, "mpv", subUrls);
    launchMethod = mpvSuccess ? "mpv" : "url_only";
  } else if (config.playerPref === "browser") {
    launchMethod = "browser";
  } else {
    // Auto mode: try mpv for non-browser playable formats or try native helper first
    if (!playableInBrowser) {
      const mpvSuccess = await tryLaunchPlayer(streamUrl, "mpv", subUrls);
      if (mpvSuccess) {
        launchMethod = "mpv";
      } else {
        const vlcSuccess = await tryLaunchPlayer(streamUrl, "vlc", subUrls);
        launchMethod = vlcSuccess ? "vlc" : "browser";
      }
    } else {
      launchMethod = "browser";
    }
  }

  if (launchMethod === "browser") {
    // Open in internal player tab
    const imdbIdParam = imdb_id || (senderTabId && tabInfo[senderTabId] ? tabInfo[senderTabId].imdbId : "");
    const mediaTypeParam = media_type || (senderTabId && tabInfo[senderTabId] ? tabInfo[senderTabId].mediaType : "movie");
    const seasonParam = season ?? (senderTabId && tabInfo[senderTabId] ? tabInfo[senderTabId].season : 1);
    const episodeParam = episode ?? (senderTabId && tabInfo[senderTabId] ? tabInfo[senderTabId].episode : 1);

    let playerUrl = browser.runtime.getURL("player/player.html") +
      `?url=${encodeURIComponent(streamUrl)}` +
      `&title=${encodeURIComponent(selectedFile.name)}` +
      `&torrent_id=${torrentId}`;

    if (imdbIdParam) {
      playerUrl += `&imdb_id=${encodeURIComponent(imdbIdParam)}` +
        `&media_type=${encodeURIComponent(mediaTypeParam)}` +
        `&season=${seasonParam}` +
        `&episode=${episodeParam}`;
    }

    await browser.tabs.create({ url: playerUrl });
  }

  return {
    action: "streaming",
    method: launchMethod,
    url: streamUrl,
    torrent_id: torrentId,
    file_name: selectedFile.name,
    file_size: selectedFile.size_human,
    is_playable_browser: playableInBrowser,
  };
}

// ─── Message Listener ───────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const senderTabId = sender.tab ? sender.tab.id : null;

  switch (msg.type) {
    case "PAGE_INFO":
      if (senderTabId) tabInfo[senderTabId] = msg.data;
      break;

    case "GET_TAB_INFO":
      return browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        return tabs[0] ? (tabInfo[tabs[0].id] || null) : null;
      });

    case "FETCH_TORRENTIO":
      return fetchTorrentio(msg.imdbId, msg.season, msg.episode)
        .then(streams => ({ type: "TORRENTIO_RESULT", streams }))
        .catch(e => ({ type: "TORRENTIO_ERROR", message: e.message }));

    case "CHECK_CACHE":
      return (async () => {
        try {
          const config = await getConfig();
          if (!config.apiKey) {
            return { type: "CACHE_ERROR", message: "TorBox API key missing. Please set it in options." };
          }
          const cacheMap = await torboxCheckCached(config.apiKey, msg.hashes);
          const updatedStreams = msg.streams.map(s => ({
            ...s,
            cached: !!cacheMap[s.info_hash.toLowerCase()],
          }));
          return { type: "CACHE_RESULT", streams: updatedStreams };
        } catch (e) {
          return { type: "CACHE_ERROR", message: e.message };
        }
      })();

    case "START_STREAM":
      return handleStreamRequest(msg.data, sender.tab?.id, (progressMsg) => {
        if (sender.tab?.id) {
          browser.tabs.sendMessage(sender.tab.id, {
            type: "STREAM_PROGRESS",
            message: progressMsg,
          }).catch(() => {});
        }
      }).then(res => ({ type: "STREAM_RESULT", data: res }))
        .catch(e => ({ type: "STREAM_ERROR", message: e.message }));

    case "PICK_FILE":
      return (async () => {
        try {
          const config = await getConfig();
          if (!config.apiKey) throw new Error("TorBox API key missing. Please set it in options.");
          const streamUrl = torboxGetDownloadUrl(config.apiKey, msg.torrentId, msg.fileId);
          if (!streamUrl) throw new Error("Please select a valid torrent file.");
          return { type: "PICK_FILE_RESULT", url: streamUrl };
        } catch (e) {
          return { type: "PICK_FILE_ERROR", message: e.message };
        }
      })();

    case "DELETE_TORRENT":
      return (async () => {
        try {
          const config = await getConfig();
          const success = await torboxDeleteTorrent(config.apiKey, msg.torrentId);
          return { type: "DELETE_RESULT", success };
        } catch (e) {
          return { type: "DELETE_ERROR", message: e.message };
        }
      })();

    case "TRY_MPV":
      return tryLaunchPlayer(msg.url, "mpv", msg.subtitles || []).then(success => ({ success }));

    case "TRY_PLAYER":
      return tryLaunchPlayer(msg.url, msg.player || "mpv", msg.subtitles || []).then(success => ({ success }));

    case "FETCH_SUBTITLE_TEXT":
      return fetchSubtitleText(msg.url)
        .then(text => ({ type: "SUBTITLE_TEXT_RESULT", success: true, text }))
        .catch(e => ({ type: "SUBTITLE_TEXT_RESULT", success: false, error: e.message }));

    case "OPEN_OPTIONS":
      browser.runtime.openOptionsPage();
      sendResponse({ success: true });
      return true;

    case "OPEN_PLAYER_TAB":
      return (async () => {
        const metadata = tabInfo[senderTabId] || {};
        const params = new URLSearchParams({ url: msg.url, title: msg.title || "Stream" });
        const fields = {
          torrent_id: msg.torrentId ?? msg.torrent_id,
          imdb_id: msg.imdb_id ?? msg.imdbId ?? metadata.imdbId,
          media_type: msg.media_type ?? msg.mediaType ?? metadata.mediaType,
          season: msg.season ?? metadata.season,
          episode: msg.episode ?? metadata.episode,
        };
        for (const [key, value] of Object.entries(fields)) {
          if (value != null && value !== "") params.set(key, value);
        }
        const playerUrl = browser.runtime.getURL("player/player.html") + `?${params}`;
        await browser.tabs.create({ url: playerUrl });
        return { success: true };
      })().catch(e => ({ success: false, message: e.message }));
  }
});

async function fetchSubtitleText(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("Invalid subtitle URL.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

// Toolbar icon click → open options page or trigger modal
const actionApi = browser.action || browser.browserAction;
if (actionApi && actionApi.onClicked) {
  actionApi.onClicked.addListener((tab) => {
    browser.tabs.sendMessage(tab.id, { type: "OPEN_MODAL" }).catch(() => {
      browser.runtime.openOptionsPage();
    });
  });
}

// Cleanup tab info on close
browser.tabs.onRemoved.addListener((tabId) => {
  delete tabInfo[tabId];
});
