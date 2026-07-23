/**
 * TorBox Streamer — Content Script
 * Injects a "Play Now" button on IMDb title pages and shows a modal stream picker.
 */

(function () {
  "use strict";

  // ─── State ────────────────────────────────────────────────────────────────
  let imdbInfo = null;
  let currentStreams = [];
  let currentTorrentId = null;
  let modalEl = null;

  // ─── IMDb Detection ───────────────────────────────────────────────────────

  function extractImdbInfo() {
    const url = window.location.href;
    const match = url.match(/imdb\.com\/title\/(tt\d{7,})/);
    if (!match) return null;

    const imdbId = match[1];
    let mediaType = "movie";
    let title = "";

    const titleEl =
      document.querySelector('[data-testid="hero__primary-text"]') ||
      document.querySelector("h1");
    if (titleEl) title = titleEl.textContent.trim();

    const isSeries =
      document.querySelector('[data-testid="hero-subnav-bar-season-episode-links"]') ||
      document.querySelector("a[href*='/episodes/']") ||
      url.includes("/episodes/") ||
      (document.title && document.title.toLowerCase().includes("tv series"));

    if (isSeries) mediaType = "series";
    return { imdbId, mediaType, title, url };
  }

  // ─── Button Injection ─────────────────────────────────────────────────────

  function injectButton() {
    if (document.getElementById("torbox-play-btn")) return;

    // IMDb's action bar (where Watchlist button lives)
    const selectors = [
      '[data-testid="hero-subnav-bar"] ul',
      '[data-testid="hero__primary-actions"]',
      '.ipc-action-mode-container',
      'ul[class*="ipc-inline-list"]',
    ];

    let container = null;
    for (const sel of selectors) {
      container = document.querySelector(sel);
      if (container) break;
    }

    if (!container) {
      // Fallback: retry after a delay (IMDb loads React components async)
      setTimeout(injectButton, 1500);
      return;
    }

    // Create list item matching IMDb's style
    const li = document.createElement("li");
    li.className = "ipc-inline-list__item";
    li.style.cssText = "display:flex;align-items:center;";

    const btn = document.createElement("button");
    btn.id = "torbox-play-btn";
    btn.type = "button";
    btn.innerHTML = `
      <span class="ipc-btn--center-align" style="display:inline-flex;align-items:center;gap:6px;">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="7" stroke="#f5c518" stroke-width="1.5"/>
          <polygon points="6.5,5 6.5,11 11.5,8" fill="#f5c518"/>
        </svg>
        <span style="font-weight:600;">Play Now</span>
      </span>
    `;
    btn.style.cssText = `
      background: rgba(245,197,24,0.1);
      border: 1px solid #f5c518;
      color: #f5c518;
      border-radius: 8px;
      padding: 8px 16px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
    `;
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "#f5c518";
      btn.style.color = "#000";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "rgba(245,197,24,0.1)";
      btn.style.color = "#f5c518";
    });
    btn.addEventListener("click", () => openModal());

    li.appendChild(btn);

    // Insert at the beginning of the action list
    if (container.tagName === "UL") {
      container.insertBefore(li, container.firstChild);
    } else {
      container.prepend(li);
    }
  }

  // ─── Modal ────────────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById("torbox-styles")) return;
    const style = document.createElement("style");
    style.id = "torbox-styles";
    style.textContent = `
      #torbox-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.75);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        animation: torbox-fade-in 0.2s ease;
      }
      @keyframes torbox-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      #torbox-modal {
        background: #1a1a2e;
        border: 1px solid #333;
        border-radius: 12px;
        width: 520px;
        max-width: 92vw;
        max-height: 75vh;
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        animation: torbox-slide-up 0.25s ease;
      }
      @keyframes torbox-slide-up {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      #torbox-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid #2a2a4a;
      }
      #torbox-modal-header h3 {
        margin: 0;
        color: #fff;
        font-size: 16px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #torbox-modal-close {
        background: none;
        border: none;
        color: #888;
        font-size: 22px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
      }
      #torbox-modal-close:hover { color: #fff; background: #333; }
      #torbox-modal-body {
        padding: 16px 20px;
      }
      .torbox-loading {
        text-align: center;
        padding: 30px 0;
        color: #8899aa;
      }
      .torbox-spinner {
        width: 32px; height: 32px;
        border: 3px solid #333;
        border-top-color: #f5c518;
        border-radius: 50%;
        animation: torbox-spin 0.8s linear infinite;
        margin: 0 auto 12px;
      }
      @keyframes torbox-spin { to { transform: rotate(360deg); } }
      .torbox-stats {
        font-size: 12px;
        color: #8899aa;
        margin-bottom: 12px;
      }
      .torbox-episode-picker {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
      }
      .torbox-episode-picker label { color: #ccc; font-size: 13px; }
      .torbox-episode-picker input {
        width: 50px;
        padding: 4px 8px;
        background: #16213e;
        border: 1px solid #0f3460;
        border-radius: 4px;
        color: #fff;
        font-size: 13px;
      }
      .torbox-episode-picker button {
        padding: 4px 12px;
        background: #f5c518;
        color: #000;
        border: none;
        border-radius: 4px;
        font-weight: 600;
        cursor: pointer;
      }
      .torbox-stream-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 8px;
        cursor: pointer;
        border: 1px solid transparent;
        margin-bottom: 4px;
        transition: all 0.15s;
      }
      .torbox-stream-item:hover {
        background: #16213e;
        border-color: #0f3460;
      }
      .torbox-stream-item.cached { border-left: 3px solid #4caf50; }
      .torbox-stream-item.uncached { border-left: 3px solid #555; opacity: 0.75; }
      .torbox-badge {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 3px;
        white-space: nowrap;
      }
      .torbox-badge-cached { background: #1b5e20; color: #a5d6a7; }
      .torbox-badge-uncached { background: #333; color: #999; }
      .torbox-quality { font-weight: 600; color: #64b5f6; min-width: 50px; font-size: 13px; }
      .torbox-size { color: #ce93d8; min-width: 65px; text-align: right; font-size: 12px; }
      .torbox-seeders { color: #ffd54f; min-width: 40px; text-align: right; font-size: 12px; }
      .torbox-title {
        flex: 1; overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap; color: #999; font-size: 11px;
      }
      .torbox-file-item {
        padding: 8px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        color: #ddd;
        margin-bottom: 3px;
      }
      .torbox-file-item:hover { background: #16213e; }
      .torbox-success {
        background: #1b5e20;
        border-radius: 8px;
        padding: 16px;
        color: #a5d6a7;
        text-align: center;
        margin-bottom: 12px;
      }
      .torbox-error {
        color: #ef9a9a;
        text-align: center;
        padding: 20px 0;
      }
      .torbox-btn {
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        margin: 4px;
      }
      .torbox-btn-primary { background: #f5c518; color: #000; }
      .torbox-btn-danger { background: #b71c1c; color: #fff; }
      .torbox-btn-secondary { background: #333; color: #ccc; }
      .torbox-btn:hover { filter: brightness(1.15); }
    `;
    document.head.appendChild(style);
  }

  function openModal() {
    if (modalEl) return;
    injectStyles();

    modalEl = document.createElement("div");
    modalEl.id = "torbox-modal-overlay";
    modalEl.innerHTML = `
      <div id="torbox-modal">
        <div id="torbox-modal-header">
          <h3>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="#f5c518" stroke-width="1.5"/>
              <polygon points="6.5,5 6.5,11 11.5,8" fill="#f5c518"/>
            </svg>
            TorBox Streamer
          </h3>
          <button id="torbox-modal-close">&times;</button>
        </div>
        <div id="torbox-modal-body"></div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.querySelector("#torbox-modal-close").addEventListener("click", closeModal);
    modalEl.addEventListener("click", (e) => {
      if (e.target === modalEl) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });

    fetchStreams();
  }

  function closeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }

  function setModalBody(html) {
    const body = document.getElementById("torbox-modal-body");
    if (body) body.innerHTML = html;
  }

  // ─── Native Messaging (via background) ────────────────────────────────────

  function sendNative(msg) {
    browser.runtime.sendMessage({ type: "NATIVE_REQUEST", data: msg });
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "NATIVE_RESPONSE") {
      handleNativeResponse(msg.data);
    } else if (msg.type === "NATIVE_ERROR") {
      setModalBody(`<div class="torbox-error">\u26a0 ${escapeHtml(msg.data.message || "Connection error")}</div>`);
    } else if (msg.type === "OPEN_MODAL") {
      openModal();
    }
  });

  function handleNativeResponse(resp) {
    if (!modalEl) return;

    if (resp.status === "progress") {
      setModalBody(`
        <div class="torbox-loading">
          <div class="torbox-spinner"></div>
          <p>${escapeHtml(resp.message)}</p>
        </div>
      `);
      return;
    }

    if (resp.status === "error") {
      setModalBody(`
        <div class="torbox-error">\u26a0 ${escapeHtml(resp.message)}</div>
        <div style="text-align:center;margin-top:12px;">
          <button class="torbox-btn torbox-btn-primary" onclick="document.dispatchEvent(new Event('torbox-retry'))">Retry</button>
          <button class="torbox-btn torbox-btn-secondary" onclick="document.dispatchEvent(new Event('torbox-close'))">Close</button>
        </div>
      `);
      document.addEventListener("torbox-retry", () => fetchStreams(), { once: true });
      document.addEventListener("torbox-close", () => closeModal(), { once: true });
      return;
    }

    if (resp.status === "ok") {
      const data = resp.data;
      if (data.streams) {
        currentStreams = data.streams;
        renderStreams(data);
      } else if (data.action === "streaming") {
        currentTorrentId = data.torrent_id;
        setModalBody(`
          <div class="torbox-success">
            <p style="font-size:28px;margin-bottom:8px;">\ud83c\udfac</p>
            <p><strong>Now streaming in mpv!</strong></p>
            <p style="font-size:12px;margin-top:6px;opacity:0.8;">${escapeHtml(data.file_name || "")} (${data.file_size || ""})</p>
          </div>
          <div style="text-align:center;">
            <button class="torbox-btn torbox-btn-danger" id="torbox-del-btn">Delete from TorBox</button>
            <button class="torbox-btn torbox-btn-secondary" id="torbox-done-btn">Done</button>
          </div>
        `);
        document.getElementById("torbox-del-btn").addEventListener("click", () => {
          sendNative({ action: "delete_torrent", torrent_id: currentTorrentId });
        });
        document.getElementById("torbox-done-btn").addEventListener("click", closeModal);
      } else if (data.action === "url_only") {
        setModalBody(`
          <div class="torbox-success" style="background:#333;">
            <p>mpv not found. Copy the stream URL:</p>
          </div>
          <textarea readonly style="width:100%;height:60px;background:#111;color:#aaa;border:1px solid #444;border-radius:6px;padding:8px;font-size:11px;resize:none;">${escapeHtml(data.url)}</textarea>
          <div style="text-align:center;margin-top:8px;">
            <button class="torbox-btn torbox-btn-secondary" id="torbox-copy-btn">Copy URL</button>
          </div>
        `);
        document.getElementById("torbox-copy-btn").addEventListener("click", () => {
          navigator.clipboard.writeText(data.url);
          document.getElementById("torbox-copy-btn").textContent = "Copied!";
        });
      } else if (data.action === "pick_file") {
        currentTorrentId = data.torrent_id;
        renderFilePicker(data.files);
      } else if (data.deleted) {
        setModalBody(`
          <div class="torbox-success">
            <p>\u2705 Torrent deleted from TorBox.</p>
          </div>
          <div style="text-align:center;">
            <button class="torbox-btn torbox-btn-secondary" id="torbox-done-btn2">Close</button>
          </div>
        `);
        document.getElementById("torbox-done-btn2").addEventListener("click", closeModal);
      }
    }
  }

  // ─── Renderers ────────────────────────────────────────────────────────────

  function renderStreams(data) {
    let html = "";

    // Episode picker for series
    if (imdbInfo && imdbInfo.mediaType === "series") {
      html += `
        <div class="torbox-episode-picker">
          <label>S</label><input id="torbox-season" type="number" min="1" value="1">
          <label>E</label><input id="torbox-episode" type="number" min="1" value="1">
          <button id="torbox-ep-go">Go</button>
        </div>
      `;
    }

    html += `<div class="torbox-stats">${data.count} streams &bull; ${data.cached_count} cached \u2705 &bull; ${data.count - data.cached_count} uncached</div>`;

    data.streams.forEach((s, i) => {
      html += `
        <div class="torbox-stream-item ${s.cached ? "cached" : "uncached"}" data-idx="${i}">
          <span class="torbox-badge ${s.cached ? "torbox-badge-cached" : "torbox-badge-uncached"}">${s.cached ? "CACHED" : "\u2014"}</span>
          <span class="torbox-quality">${escapeHtml(s.quality || "???")}</span>
          <span class="torbox-size">${escapeHtml(s.size_human || "?")}</span>
          <span class="torbox-seeders">\ud83d\udc64${s.seeders != null ? s.seeders : "?"}</span>
          <span class="torbox-title">${escapeHtml(s.title || "")}</span>
        </div>
      `;
    });

    setModalBody(html);

    // Bind episode picker
    const epBtn = document.getElementById("torbox-ep-go");
    if (epBtn) {
      epBtn.addEventListener("click", () => fetchStreams());
    }

    // Bind stream clicks
    document.querySelectorAll(".torbox-stream-item").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = parseInt(el.dataset.idx);
        pickStream(currentStreams[idx]);
      });
    });
  }

  function renderFilePicker(files) {
    let html = '<p style="color:#8899aa;margin-bottom:10px;">Pick a file to stream:</p>';
    files.forEach((f) => {
      const icon = f.is_video ? "\ud83c\udfac" : "\ud83d\udcce";
      html += `<div class="torbox-file-item" data-file-id="${f.id}">${icon} ${escapeHtml(f.name)} <span style="color:#888;font-size:11px;">(${escapeHtml(f.size_human)})</span></div>`;
    });
    html += '<div style="text-align:center;margin-top:10px;"><button class="torbox-btn torbox-btn-secondary" id="torbox-cancel-files">Cancel</button></div>';
    setModalBody(html);

    document.querySelectorAll(".torbox-file-item").forEach((el) => {
      el.addEventListener("click", () => {
        setModalBody('<div class="torbox-loading"><div class="torbox-spinner"></div><p>Getting stream URL...</p></div>');
        sendNative({ action: "pick_file", torrent_id: currentTorrentId, file_id: parseInt(el.dataset.fileId) });
      });
    });
    document.getElementById("torbox-cancel-files").addEventListener("click", () => {
      renderStreams({ streams: currentStreams, count: currentStreams.length, cached_count: currentStreams.filter(s => s.cached).length });
    });
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  function fetchStreams() {
    if (!imdbInfo) return;
    setModalBody('<div class="torbox-loading"><div class="torbox-spinner"></div><p>Fetching streams from Torrentio...</p></div>');

    const msg = { type: "FETCH_TORRENTIO", imdbId: imdbInfo.imdbId };
    if (imdbInfo.mediaType === "series") {
      const sEl = document.getElementById("torbox-season");
      const eEl = document.getElementById("torbox-episode");
      msg.season = sEl ? parseInt(sEl.value) || 1 : 1;
      msg.episode = eEl ? parseInt(eEl.value) || 1 : 1;
    }

    browser.runtime.sendMessage(msg).then((resp) => {
      if (!resp) return;
      if (resp.type === "TORRENTIO_ERROR") {
        setModalBody(`
          <div class="torbox-error">\u26a0 ${escapeHtml(resp.message)}</div>
          <div style="text-align:center;margin-top:12px;">
            <button class="torbox-btn torbox-btn-primary" id="torbox-retry-btn">Retry</button>
          </div>
        `);
        document.getElementById("torbox-retry-btn").addEventListener("click", fetchStreams);
        return;
      }
      if (resp.type === "TORRENTIO_RESULT") {
        if (!resp.streams || resp.streams.length === 0) {
          setModalBody('<div class="torbox-error">No streams found for this title.</div>');
          return;
        }
        // Now check cache via native host
        setModalBody(`<div class="torbox-loading"><div class="torbox-spinner"></div><p>Checking TorBox cache for ${resp.streams.length} streams...</p></div>`);
        sendNative({ action: "check_cache", hashes: resp.streams.map(s => s.info_hash), streams: resp.streams });
      }
    }).catch((e) => {
      setModalBody(`<div class="torbox-error">\u26a0 ${escapeHtml(e.message || "Communication error")}</div>`);
    });
  }

  function pickStream(stream) {
    setModalBody(`<div class="torbox-loading"><div class="torbox-spinner"></div><p>${stream.cached ? "\u2705 Cached \u2014 adding torrent (instant)..." : "\u274c Not cached \u2014 downloading on TorBox..."}</p></div>`);

    const msg = { action: "stream", hash: stream.info_hash, file_idx: stream.file_idx, is_cached: !!stream.cached };
    if (imdbInfo && imdbInfo.mediaType === "series") {
      const sEl = document.getElementById("torbox-season");
      const eEl = document.getElementById("torbox-episode");
      msg.season = sEl ? parseInt(sEl.value) || 1 : 1;
      msg.episode = eEl ? parseInt(eEl.value) || 1 : 1;
    }
    sendNative(msg);
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    imdbInfo = extractImdbInfo();
    if (!imdbInfo) return;

    // Notify background
    browser.runtime.sendMessage({ type: "PAGE_INFO", data: imdbInfo });

    // Inject the Play Now button (with retry for async IMDb rendering)
    injectButton();

    // Watch for IMDb SPA navigation (it's a React app)
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        imdbInfo = extractImdbInfo();
        if (imdbInfo) setTimeout(injectButton, 500);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
