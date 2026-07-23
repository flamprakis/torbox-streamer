/**
 * TorBox Streamer — Popup Logic
 * Handles the UI flow: detect page -> fetch streams -> pick -> stream
 */

// ─── State ──────────────────────────────────────────────────────────────────

let currentInfo = null;   // {imdbId, mediaType, title}
let currentStreams = [];  // stream results from native host
let currentTorrentId = null;

// ─── DOM Helpers ────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function showState(stateId) {
  document.querySelectorAll(".state").forEach((el) => el.classList.add("hidden"));
  const el = $(stateId);
  if (el) el.classList.remove("hidden");
}

function setLoadingText(text) {
  $("loading-text").textContent = text;
}

// ─── Native Messaging ───────────────────────────────────────────────────────

function sendNative(msg) {
  browser.runtime.sendMessage({ type: "NATIVE_REQUEST", data: msg });
}

// Listen for responses from native host (routed through background)
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "NATIVE_RESPONSE") {
    handleNativeResponse(msg.data);
  } else if (msg.type === "NATIVE_ERROR") {
    showError(msg.data.message || "Native host error");
  }
});

function handleNativeResponse(resp) {
  if (resp.status === "progress") {
    setLoadingText(resp.message);
    return;
  }

  if (resp.status === "error") {
    showError(resp.message);
    return;
  }

  if (resp.status === "ok") {
    const data = resp.data;
    if (data.streams) {
      // Stream list response
      currentStreams = data.streams;
      renderStreams(data);
    } else if (data.action === "streaming") {
      showStreaming(data);
    } else if (data.action === "url_only") {
      showUrlOnly(data);
    } else if (data.action === "pick_file") {
      currentTorrentId = data.torrent_id;
      renderFilePicker(data.files);
    } else if (data.deleted) {
      showError("Torrent deleted.");
      setTimeout(() => fetchStreams(), 1000);
    }
  }
}

// ─── UI Renderers ───────────────────────────────────────────────────────────

function renderStreams(data) {
  $("movie-title").textContent = currentInfo ? currentInfo.title || data.imdb_id : data.imdb_id;
  $("movie-id").textContent = data.imdb_id;
  $("stats-bar").textContent =
    `${data.count} streams | ${data.cached_count} cached \u2705 | ${data.count - data.cached_count} uncached`;

  // Show episode picker for series
  if (currentInfo && currentInfo.mediaType === "series") {
    $("episode-picker").classList.remove("hidden");
  } else {
    $("episode-picker").classList.add("hidden");
  }

  const list = $("stream-list");
  list.innerHTML = "";

  data.streams.forEach((s, idx) => {
    const item = document.createElement("div");
    item.className = `stream-item ${s.cached ? "cached" : "uncached"}`;
    item.innerHTML = `
      <span class="stream-badge ${s.cached ? "badge-cached" : "badge-uncached"}">
        ${s.cached ? "CACHED" : "---"}
      </span>
      <span class="stream-quality">${s.quality || "???"}</span>
      <span class="stream-size">${s.size_human || "?"}</span>
      <span class="stream-seeders">\ud83d\udc64${s.seeders != null ? s.seeders : "?"}</span>
      <span class="stream-title">${escapeHtml(s.title || "")}</span>
    `;
    item.addEventListener("click", () => pickStream(s));
    list.appendChild(item);
  });

  showState("state-results");
}

function renderFilePicker(files) {
  const list = $("file-list");
  list.innerHTML = "";

  files.forEach((f) => {
    const item = document.createElement("div");
    item.className = `file-item ${f.is_video ? "video" : "other"}`;
    item.textContent = `${f.is_video ? "\ud83c\udfac" : "\ud83d\udcce"} ${f.name} (${f.size_human})`;
    item.addEventListener("click", () => {
      showState("state-loading");
      setLoadingText("Getting stream URL...");
      sendNative({
        action: "pick_file",
        torrent_id: currentTorrentId,
        file_id: f.id,
      });
    });
    list.appendChild(item);
  });

  showState("state-files");
}

function showStreaming(data) {
  $("stream-file").textContent = `${data.file_name || ""} (${data.file_size || ""})`;
  currentTorrentId = data.torrent_id;
  showState("state-streaming");
}

function showUrlOnly(data) {
  $("url-output").value = data.url;
  showState("state-url");
}

function showError(message) {
  $("error-text").textContent = message;
  showState("state-error");
}

// ─── Actions ────────────────────────────────────────────────────────────────

function fetchStreams() {
  if (!currentInfo) {
    showState("state-not-imdb");
    return;
  }

  showState("state-loading");
  setLoadingText("Fetching streams from Torrentio...");

  const msg = { action: "get_streams", imdb_id: currentInfo.imdbId };

  if (currentInfo.mediaType === "series") {
    msg.season = parseInt($("inp-season").value) || 1;
    msg.episode = parseInt($("inp-episode").value) || 1;
  }

  sendNative(msg);
}

function pickStream(stream) {
  showState("state-loading");
  setLoadingText(
    stream.cached
      ? "\u2705 Cached \u2014 adding torrent (instant)..."
      : "\u274c Not cached \u2014 adding torrent (downloading)..."
  );

  const msg = {
    action: "stream",
    hash: stream.info_hash,
    file_idx: stream.file_idx,
  };

  if (currentInfo && currentInfo.mediaType === "series") {
    msg.season = parseInt($("inp-season").value) || 1;
    msg.episode = parseInt($("inp-episode").value) || 1;
  }

  sendNative(msg);
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ─── Event Listeners ────────────────────────────────────────────────────────

$("btn-retry").addEventListener("click", fetchStreams);

$("btn-fetch-ep").addEventListener("click", fetchStreams);

$("btn-cancel-files").addEventListener("click", () => {
  showState("state-results");
});

$("btn-delete").addEventListener("click", () => {
  if (currentTorrentId) {
    sendNative({ action: "delete_torrent", torrent_id: currentTorrentId });
  }
});

$("btn-copy-url").addEventListener("click", () => {
  const textarea = $("url-output");
  textarea.select();
  document.execCommand("copy");
  $("btn-copy-url").textContent = "Copied!";
  setTimeout(() => { $("btn-copy-url").textContent = "Copy URL"; }, 1500);
});

// ─── Init ───────────────────────────────────────────────────────────────────

async function init() {
  try {
    // Ask background for current tab info
    const info = await browser.runtime.sendMessage({ type: "GET_TAB_INFO" });
    if (info && info.imdbId) {
      currentInfo = info;
      fetchStreams();
    } else {
      showState("state-not-imdb");
    }
  } catch (e) {
    showState("state-not-imdb");
  }
}

init();
