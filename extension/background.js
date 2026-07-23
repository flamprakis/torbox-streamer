/**
 * TorBox Streamer — Background Script (v2 Pure Extension)
 * - Fetches Torrentio streams
 * - Executes TorBox API calls directly via torbox_api.js
 * - Handles optional native helper for launching mpv
 * - Routes playback (browser tab vs mpv helper)
 */

const NATIVE_HOST = "com.torbox_streamer.host";
let nativePort = null;
let isNativeConnected = false;

const tabInfo = {};
let torrentioBaseUrl = "https://torrentio.strem.fun";

// ─── Settings & Storage ────────────────────────────────────────────────────

async function getConfig() {
  const stored = await browser.storage.local.get([
    "torbox_api_key",
    "player_preference",
    "torrentio_base_url",
    "max_results",
  ]);
  return {
    apiKey: stored.torbox_api_key || "",
    playerPref: stored.player_preference || "auto", // "auto", "browser", "mpv"
    torrentioBaseUrl: stored.torrentio_base_url || "https://torrentio.strem.fun",
    maxResults: stored.max_results || 20,
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

async function tryLaunchPlayer(streamUrl, player = "mpv") {
  const config = await getConfig();
  const customPath = player === "vlc" ? config.vlc_path : config.mpv_path;

  return new Promise((resolve) => {
    try {
      const port = browser.runtime.connectNative(NATIVE_HOST);
      let resolved = false;

      port.onMessage.addListener((msg) => {
        if (!resolved) {
          resolved = true;
          port.disconnect();
          resolve(msg && msg.status === "ok");
        }
      });

      port.onDisconnect.addListener(() => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });

      port.postMessage({ action: "launch_player", player, custom_path: customPath || null, url: streamUrl });
    } catch (e) {
      resolve(false);
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
  if (season && episode) {
    path = `stream/series/${imdbId}/${season}/${episode}.json`;
  } else {
    path = `stream/movie/${imdbId}.json`;
  }

  const url = `${config.torrentioBaseUrl}/${path}`;

  try {
    const resp = await fetch(url, {
      headers: { "Accept": "application/json" },
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const text = await resp.text();

    if (text.includes("<!DOCTYPE") || text.includes("cf-error") || text.includes("Cloudflare")) {
      throw new Error("Torrentio blocked by Cloudflare. Try updating Torrentio base URL in options.");
    }

    const data = JSON.parse(text);
    const streams = (data.streams || []).filter(s => s.infoHash);

    return streams.slice(0, config.maxResults).map((s, idx) => {
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
  } catch (e) {
    throw new Error(`Torrentio fetch failed: ${e.message}`);
  }
}

// ─── Parsing Helpers ────────────────────────────────────────────────────────

function parseQuality(text) {
  const t = text.toLowerCase();
  for (const q of ["2160p", "4k", "1080p", "720p", "480p", "360p"]) {
    if (t.includes(q)) return q === "4k" ? "4K" : q;
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

  const { hash, file_idx, is_cached, season, episode } = data;
  const magnet = `magnet:?xt=urn:btih:${hash}`;

  sendProgress("Adding torrent to TorBox...");
  const torrentId = await torboxCreateTorrent(config.apiKey, magnet);
  if (!torrentId) {
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
  const selectedFile = autoPickFile(torrent.files, file_idx, season, episode);

  if (!selectedFile) {
    // Return file list for manual picking if auto-pick returned nothing
    return {
      action: "pick_file",
      torrent_id: torrentId,
      files: torrent.files,
    };
  }

  // Get stream URL
  const streamUrl = torboxGetDownloadUrl(config.apiKey, torrentId, selectedFile.id);
  const playableInBrowser = isBrowserPlayable(selectedFile.name);

  let launchMethod = "browser"; // default

  if (config.playerPref === "vlc") {
    const vlcSuccess = await tryLaunchPlayer(streamUrl, "vlc");
    launchMethod = vlcSuccess ? "vlc" : "url_only";
  } else if (config.playerPref === "mpv") {
    const mpvSuccess = await tryLaunchPlayer(streamUrl, "mpv");
    launchMethod = mpvSuccess ? "mpv" : "url_only";
  } else if (config.playerPref === "browser") {
    launchMethod = "browser";
  } else {
    // Auto mode: try mpv for non-browser playable formats or try native helper first
    if (!playableInBrowser) {
      const mpvSuccess = await tryLaunchPlayer(streamUrl, "mpv");
      if (mpvSuccess) {
        launchMethod = "mpv";
      } else {
        const vlcSuccess = await tryLaunchPlayer(streamUrl, "vlc");
        launchMethod = vlcSuccess ? "vlc" : "browser";
      }
    } else {
      launchMethod = "browser";
    }
  }

  if (launchMethod === "browser") {
    // Open in internal player tab
    const playerUrl = browser.runtime.getURL("player/player.html") +
      `?url=${encodeURIComponent(streamUrl)}` +
      `&title=${encodeURIComponent(selectedFile.name)}` +
      `&torrent_id=${torrentId}`;
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
      browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        sendResponse(tabs[0] ? (tabInfo[tabs[0].id] || null) : null);
      });
      return true;

    case "FETCH_TORRENTIO":
      fetchTorrentio(msg.imdbId, msg.season, msg.episode)
        .then(streams => sendResponse({ type: "TORRENTIO_RESULT", streams }))
        .catch(e => sendResponse({ type: "TORRENTIO_ERROR", message: e.message }));
      return true;

    case "CHECK_CACHE":
      (async () => {
        try {
          const config = await getConfig();
          if (!config.apiKey) {
            sendResponse({ type: "CACHE_ERROR", message: "TorBox API key missing. Please set it in options." });
            return;
          }
          const cacheMap = await torboxCheckCached(config.apiKey, msg.hashes);
          const updatedStreams = msg.streams.map(s => ({
            ...s,
            cached: !!cacheMap[s.info_hash],
          }));
          sendResponse({ type: "CACHE_RESULT", streams: updatedStreams });
        } catch (e) {
          sendResponse({ type: "CACHE_ERROR", message: e.message });
        }
      })();
      return true;

    case "START_STREAM":
      (async () => {
        try {
          const res = await handleStreamRequest(msg.data, senderTabId, (progressMsg) => {
            if (senderTabId) {
              browser.tabs.sendMessage(senderTabId, {
                type: "STREAM_PROGRESS",
                message: progressMsg,
              }).catch(() => {});
            }
          });
          sendResponse({ type: "STREAM_RESULT", data: res });
        } catch (e) {
          sendResponse({ type: "STREAM_ERROR", message: e.message });
        }
      })();
      return true;

    case "PICK_FILE":
      (async () => {
        try {
          const config = await getConfig();
          const streamUrl = torboxGetDownloadUrl(config.apiKey, msg.torrentId, msg.fileId);
          sendResponse({ type: "PICK_FILE_RESULT", url: streamUrl });
        } catch (e) {
          sendResponse({ type: "PICK_FILE_ERROR", message: e.message });
        }
      })();
      return true;

    case "DELETE_TORRENT":
      (async () => {
        try {
          const config = await getConfig();
          const success = await torboxDeleteTorrent(config.apiKey, msg.torrentId);
          sendResponse({ type: "DELETE_RESULT", success });
        } catch (e) {
          sendResponse({ type: "DELETE_ERROR", message: e.message });
        }
      })();
      return true;

    case "TRY_MPV":
      tryLaunchPlayer(msg.url, "mpv").then(success => {
        sendResponse({ success });
      });
      return true;

    case "TRY_PLAYER":
      tryLaunchPlayer(msg.url, msg.player || "mpv").then(success => {
        sendResponse({ success });
      });
      return true;

    case "OPEN_OPTIONS":
      browser.runtime.openOptionsPage();
      sendResponse({ success: true });
      return true;

    case "OPEN_PLAYER_TAB":
      const playerUrl = browser.runtime.getURL("player/player.html") +
        `?url=${encodeURIComponent(msg.url)}` +
        `&title=${encodeURIComponent(msg.title || "Stream")}` +
        `&torrent_id=${msg.torrentId || ""}`;
      browser.tabs.create({ url: playerUrl });
      sendResponse({ success: true });
      return true;
  }
});

// Toolbar icon click → open options page or trigger modal
browser.browserAction.onClicked.addListener((tab) => {
  browser.tabs.sendMessage(tab.id, { type: "OPEN_MODAL" }).catch(() => {
    browser.runtime.openOptionsPage();
  });
});

// Cleanup tab info on close
browser.tabs.onRemoved.addListener((tabId) => {
  delete tabInfo[tabId];
});
