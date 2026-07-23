/**
 * TorBox Streamer — Background Script
 * - Fetches Torrentio streams (from browser, bypasses Cloudflare)
 * - Routes TorBox API calls to native host
 * - Uses tab-targeted messaging (not broadcast) for reliability
 */

const NATIVE_HOST = "com.torbox_streamer.host";
let nativePort = null;
let isConnected = false;

const tabInfo = {};
let activeTabId = null; // Track which tab is using the native host
let torrentioBaseUrl = "https://torrentio.strem.fun";

// Load saved Torrentio base URL from storage
browser.storage.local.get("torrentio_base_url").then(stored => {
  if (stored.torrentio_base_url) torrentioBaseUrl = stored.torrentio_base_url;
}).catch(() => {});

// ─── Native Messaging ───────────────────────────────────────────────────────

function connectNativeHost() {
  if (nativePort) {
    try { nativePort.disconnect(); } catch (e) {}
  }

  nativePort = browser.runtime.connectNative(NATIVE_HOST);
  isConnected = true;

  nativePort.onMessage.addListener((msg) => {
    // Send response back to the specific tab that made the request
    if (activeTabId) {
      browser.tabs.sendMessage(activeTabId, { type: "NATIVE_RESPONSE", data: msg })
        .catch((e) => console.warn("tabs.sendMessage failed:", e));
    }
  });

  nativePort.onDisconnect.addListener((port) => {
    isConnected = false;
    const error = port.error ? port.error.message : "unknown";
    console.warn(`Native host disconnected: ${error}`);
    if (activeTabId) {
      browser.tabs.sendMessage(activeTabId, {
        type: "NATIVE_ERROR",
        data: { message: `Native host error: ${error}` },
      }).catch(() => {});
    }
  });
}

function sendToNative(msg, tabId) {
  activeTabId = tabId; // Remember which tab to respond to
  if (!isConnected || !nativePort) {
    connectNativeHost();
  }
  try {
    nativePort.postMessage(msg);
  } catch (e) {
    connectNativeHost();
    nativePort.postMessage(msg);
  }
}

// ─── Torrentio Fetch (browser-side, passes Cloudflare) ─────────────────────

async function fetchTorrentio(imdbId, season, episode) {
  let path;
  if (season && episode) {
    path = `stream/series/${imdbId}/${season}/${episode}.json`;
  } else {
    path = `stream/movie/${imdbId}.json`;
  }

  const baseUrl = torrentioBaseUrl;
  const url = `${baseUrl}/${path}`;

  try {
    const resp = await fetch(url, {
      headers: { "Accept": "application/json" },
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const text = await resp.text();

    // Detect Cloudflare block
    if (text.includes("<!DOCTYPE") || text.includes("cf-error") || text.includes("Cloudflare")) {
      throw new Error("Torrentio blocked by Cloudflare. Try another instance.");
    }

    const data = JSON.parse(text);
    const streams = (data.streams || []).filter(s => s.infoHash);

    return streams.map((s, idx) => {
      const fullText = `${s.name || ""} ${s.title || ""}`;
      return {
        info_hash: s.infoHash.toLowerCase(),
        file_idx: s.fileIdx != null ? s.fileIdx : null,
        title: (s.title || "").trim(),
        quality: parseQuality(fullText),
        size_bytes: parseSize(fullText),
        size_human: parseSizeHuman(fullText),
        seeders: parseSeeders(fullText),
        original_index: idx, // Preserve Torrentio's ranking order
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

// ─── Message Routing ────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((msg, sender) => {
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
      // Content script wants Torrentio data — fetch from browser context
      return fetchTorrentio(msg.imdbId, msg.season, msg.episode)
        .then(streams => ({ type: "TORRENTIO_RESULT", streams }))
        .catch(e => ({ type: "TORRENTIO_ERROR", message: e.message }));

    case "NATIVE_REQUEST":
      // Forward to native host, remembering which tab to respond to
      sendToNative(msg.data, senderTabId);
      break;

    case "CONNECT_NATIVE":
      connectNativeHost();
      break;
  }
});

// Toolbar icon click
browser.browserAction.onClicked.addListener((tab) => {
  browser.tabs.sendMessage(tab.id, { type: "OPEN_MODAL" }).catch(() => {});
});

// Cleanup
browser.tabs.onRemoved.addListener((tabId) => {
  delete tabInfo[tabId];
  if (activeTabId === tabId) activeTabId = null;
});

// Startup
connectNativeHost();
