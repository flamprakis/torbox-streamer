/**
 * TorBox Streamer — Content Script
 * Injects a "Play Now" button on IMDb title pages and shows a modal stream picker.
 */

(function () {
  "use strict";

  var browser = typeof globalThis.browser !== "undefined" ? globalThis.browser : globalThis.chrome;

  // ─── State ────────────────────────────────────────────────────────────────
  let imdbInfo = null;
  let currentStreams = [];
  let currentTorrentId = null;
  let modalEl = null;
  let escHandler = null;

  // ─── IMDb Detection ───────────────────────────────────────────────────────

  function extractImdbInfo() {
    const url = window.location.href;
    const match = url.match(/imdb\.com\/title\/(tt\d{7,})/);
    if (!match) return null;

    let pageImdbId = match[1];
    let mediaType = "movie";
    let title = "";
    let season = 1;
    let episode = 1;

    const titleEl =
      document.querySelector('[data-testid="hero__primary-text"]') ||
      document.querySelector("h1");
    if (titleEl) title = titleEl.textContent.trim();

    // 1. Check for Parent Series Link (Episode Page case)
    const seriesLink =
      document.querySelector('a[data-testid="hero-title-block__series-link"]') ||
      document.querySelector('a[href*="/title/tt"][href*="/episodes"]');

    if (seriesLink) {
      const parentMatch = seriesLink.href.match(/imdb\.com\/title\/(tt\d{7,})/);
      if (parentMatch) {
        mediaType = "series";
        pageImdbId = parentMatch[1]; // Use parent series ID for Torrentio!
      }
    }

    // 2. Season & Episode Detection from Subnav / Header text
    const epLinksEl =
      document.querySelector('[data-testid="hero-subnav-bar-season-episode-links"]') ||
      document.querySelector('[data-testid="hero-subnav-bar-season-episode-link"]');

    const bodyText = document.body ? document.body.innerText : "";
    const pageText = (epLinksEl ? epLinksEl.textContent : "") + " " + (document.title || "");

    const seMatch = pageText.match(/S(\d+)\s*\.\s*E(\d+)/i) ||
                    pageText.match(/Season\s*(\d+)\s*,?\s*Episode\s*(\d+)/i) ||
                    bodyText.match(/S(\d+)\s*\.\s*E(\d+)/i);

    if (seMatch) {
      mediaType = "series";
      season = parseInt(seMatch[1]) || 1;
      episode = parseInt(seMatch[2]) || 1;
    }

    // 3. Fallback Series Detection (Main Series page)
    if (mediaType === "movie") {
      const isSeries =
        epLinksEl ||
        document.querySelector("a[href*='/episodes/']") ||
        url.includes("/episodes/") ||
        (document.title && document.title.toLowerCase().includes("tv series")) ||
        (document.title && document.title.toLowerCase().includes("tv mini series"));

      if (isSeries) mediaType = "series";
    }

    return { imdbId: pageImdbId, mediaType, title, season, episode, url };
  }

  // ─── TMDB Detection & Extraction ──────────────────────────────────────────

  function extractTmdbInfo() {
    const url = window.location.href;
    const isTv = url.includes("/tv/");
    const isMovie = url.includes("/movie/");
    if (!isTv && !isMovie) return null;

    let mediaType = isTv ? "series" : "movie";
    let title = "";
    let year = null;
    let season = 1;
    let episode = 1;
    let tmdbId = null;
    let pageImdbId = null;

    // 1. Extract TMDB numeric ID from URL (always available)
    const tmdbMatch = url.match(/\/(movie|tv)\/(\d+)/);
    if (tmdbMatch) tmdbId = tmdbMatch[2];

    // 2. Parse <title> tag — most reliable source for title + year
    //    Format: "Inception (2010) — The Movie Database (TMDB)"
    //    TV:     "Breaking Bad (TV Series 2008-2013) — The Movie Database (TMDB)"
    const pageTitle = document.title || "";
    const titleMatch = pageTitle.match(/^(.+?)\s*\((?:TV\s*(?:Series|Mini\s*Series)\s*)?(\d{4})/);
    if (titleMatch) {
      title = titleMatch[1].trim();
      year = parseInt(titleMatch[2]);
    }

    // 3. Fallback: try JSON-LD schema (server-rendered, has movie name)
    if (!title) {
      const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of ldScripts) {
        try {
          const ld = JSON.parse(script.textContent);
          if (ld["@type"] === "Movie" || ld["@type"] === "TVSeries") {
            title = ld.name || "";
            if (ld.dateCreated) year = parseInt(ld.dateCreated.slice(0, 4));
            break;
          }
        } catch (e) {}
      }
    }

    // 4. Try to find IMDb link in DOM (may appear after TMDB's JS loads social links)
    const imdbLinks = document.querySelectorAll('a[href*="imdb.com/title/tt"]');
    for (const a of imdbLinks) {
      const match = (a.href || "").match(/(tt\d{7,})/);
      if (match) {
        pageImdbId = match[1];
        break;
      }
    }

    // 5. Season/Episode from URL: /tv/1396/season/1/episode/1
    const epMatch = url.match(/\/season\/(\d+)\/episode\/(\d+)/i);
    if (epMatch) {
      season = parseInt(epMatch[1]) || 1;
      episode = parseInt(epMatch[2]) || 1;
    }

    return { imdbId: pageImdbId, tmdbId, mediaType, title, year, season, episode, url };
  }

  async function resolveImdbIdByTitle(title, year, mediaType) {
    if (!title) return null;
    const cleanTitle = title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, "_").replace(/^_+|_+$/g, "");
    if (!cleanTitle) return null;

    const firstChar = cleanTitle.charAt(0);
    const apiUrl = `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${encodeURIComponent(cleanTitle)}.json`;

    try {
      const res = await fetch(apiUrl);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !Array.isArray(data.d)) return null;

      const targetQids = mediaType === "series"
        ? ["tvSeries", "tvMiniSeries", "tvEpisode"]
        : ["feature", "movie", "tvMovie"];

      // If we have a year, try exact type + year match first
      if (year) {
        for (const item of data.d) {
          if (!item.id || !item.id.startsWith("tt")) continue;
          if (item.qid && targetQids.includes(item.qid) && item.y && Math.abs(item.y - year) <= 1) {
            return item.id;
          }
        }
        // Relax: any tt with matching year
        for (const item of data.d) {
          if (!item.id || !item.id.startsWith("tt")) continue;
          if (item.y && Math.abs(item.y - year) <= 1) {
            return item.id;
          }
        }
      }

      // No year or no year match: fall back to type match
      for (const item of data.d) {
        if (item.id && item.id.startsWith("tt")) {
          if (!item.qid || targetQids.includes(item.qid)) {
            return item.id;
          }
        }
      }

      // Last resort: first tt result
      const fallback = data.d.find(i => i.id && i.id.startsWith("tt"));
      return fallback ? fallback.id : null;
    } catch (e) {
      console.warn("TorBox Streamer: IMDb suggestion lookup failed", e);
      return null;
    }
  }

  async function resolveImdbIdByTmdbId(tmdbId, mediaType = "movie") {
    if (!tmdbId) return null;
    const type = mediaType === "series" ? "series" : "movie";
    try {
      const resp = await fetch(`https://v3-cinemeta.strem.fun/meta/${type}/tmdb:${tmdbId}.json`);
      if (!resp.ok) return null;
      const json = await resp.json();
      if (json && json.meta && json.meta.imdb_id) {
        return json.meta.imdb_id;
      }
    } catch (e) {
      console.warn("TorBox Streamer: Cinemeta TMDB resolution failed", e);
    }
    return null;
  }

  async function ensureImdbId() {
    if (imdbInfo && imdbInfo.imdbId) return imdbInfo;

    imdbInfo = extractTmdbInfo();
    if (imdbInfo && imdbInfo.imdbId) return imdbInfo;

    if (imdbInfo && imdbInfo.tmdbId) {
      const cinemetaId = await resolveImdbIdByTmdbId(imdbInfo.tmdbId, imdbInfo.mediaType);
      if (cinemetaId) {
        imdbInfo.imdbId = cinemetaId;
        return imdbInfo;
      }
    }

    if (imdbInfo && imdbInfo.title) {
      const resolvedId = await resolveImdbIdByTitle(imdbInfo.title, imdbInfo.year, imdbInfo.mediaType);
      if (resolvedId) {
        imdbInfo.imdbId = resolvedId;
        return imdbInfo;
      }
    }

    return imdbInfo;
  }

  function injectTmdbButton() {
    if (document.getElementById("torbox-play-btn")) return;

    const container = document.querySelector("ul.actions") || document.querySelector(".actions ul") || document.querySelector("ul.shortcut_bar") || document.querySelector("div.action_bar") || document.querySelector(".header_info");
    if (!container) {
      setTimeout(injectTmdbButton, 800);
      return;
    }

    const li = document.createElement("li");
    li.className = "chart torbox-action-item";
    li.style.cssText = "display:inline-flex;align-items:center;margin-left:10px;";

    const btn = document.createElement("button");
    btn.id = "torbox-play-btn";
    btn.type = "button";
    btn.title = "Stream with TorBox";
    btn.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:6px;">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="7" stroke="#01b4e4" stroke-width="1.5"/>
          <polygon points="6.5,5 6.5,11 11.5,8" fill="#01b4e4"/>
        </svg>
        <span style="font-weight:700;letter-spacing:0.5px;">Stream with TorBox</span>
      </span>
    `;
    btn.style.cssText = `
      background: rgba(1, 180, 228, 0.15);
      border: 1px solid #01b4e4;
      color: #01b4e4;
      border-radius: 20px;
      padding: 8px 16px;
      cursor: pointer;
      font-size: 14px;
      font-family: Source Sans Pro, Arial, sans-serif;
      transition: all 0.2s ease-in-out;
      display: inline-flex;
      align-items: center;
    `;
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "#01b4e4";
      btn.style.color = "#0d253f";
      const svgFill = btn.querySelector("polygon");
      const svgCircle = btn.querySelector("circle");
      if (svgFill) svgFill.setAttribute("fill", "#0d253f");
      if (svgCircle) svgCircle.setAttribute("stroke", "#0d253f");
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "rgba(1, 180, 228, 0.15)";
      btn.style.color = "#01b4e4";
      const svgFill = btn.querySelector("polygon");
      const svgCircle = btn.querySelector("circle");
      if (svgFill) svgFill.setAttribute("fill", "#01b4e4");
      if (svgCircle) svgCircle.setAttribute("stroke", "#01b4e4");
    });
    btn.addEventListener("click", () => {
      if (!imdbInfo || !imdbInfo.imdbId) {
        imdbInfo = extractTmdbInfo();
      }
      openModal();
    });

    li.appendChild(btn);

    if (container.tagName === "UL") {
      container.appendChild(li);
    } else {
      container.appendChild(li);
    }
  }

  function initTmdb() {
    injectTmdbButton();
    imdbInfo = extractTmdbInfo();
    if (imdbInfo && imdbInfo.imdbId) {
      browser.runtime.sendMessage({ type: "PAGE_INFO", data: imdbInfo });
    } else {
      let retries = 0;
      const interval = setInterval(() => {
        retries++;
        imdbInfo = extractTmdbInfo();
        if ((imdbInfo && imdbInfo.imdbId) || retries > 10) {
          clearInterval(interval);
          if (imdbInfo && imdbInfo.imdbId) {
            browser.runtime.sendMessage({ type: "PAGE_INFO", data: imdbInfo });
          }
        }
      }, 500);
    }
  }

  // ─── Button Injection ─────────────────────────────────────────────────────

  function injectButton() {
    if (document.getElementById("torbox-play-btn")) return;

    const selectors = [
      '[data-testid="hero-subnav-bar"] ul',
      '[data-testid="hero__primary-actions"]',
      '.hero-title-block__actions',
      '.ipc-action-mode-container',
      'ul[class*="ipc-inline-list"]',
      'ul.shortcut_bar',
      '.shortcut_bar',
    ];

    let container = null;
    for (const sel of selectors) {
      container = document.querySelector(sel);
      if (container) break;
    }

    if (!container) {
      setTimeout(injectButton, 1500);
      return;
    }

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
        width: 910px;
        max-width: 96vw;
        max-height: 80vh;
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
      .torbox-search-box { margin-bottom: 10px; }
      .torbox-search-input {
        width: 100%;
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        color: #fff;
        font-size: 12px;
        outline: none;
        box-sizing: border-box;
        transition: all 0.15s ease;
      }
      .torbox-search-input:focus {
        border-color: #00d2ff;
        background: rgba(255, 255, 255, 0.12);
        box-shadow: 0 0 10px rgba(0, 210, 255, 0.3);
      }
      .torbox-badge-cached { background: #1b5e20; color: #a5d6a7; }
      .torbox-badge-uncached { background: #333; color: #999; }
      .torbox-badge-4k { background: linear-gradient(135deg, #f5c518, #ff8c00); color: #000; font-weight: 700; }
      .torbox-badge-1080p { background: #00d2ff; color: #000; font-weight: 700; }
      .torbox-badge-720p { background: #26a69a; color: #fff; }
      .torbox-badge-codec { background: rgba(255, 255, 255, 0.12); color: #b0bec5; border: 1px solid rgba(255, 255, 255, 0.15); }
      .torbox-badge-audio { background: rgba(156, 39, 176, 0.25); color: #ce93d8; border: 1px solid rgba(156, 39, 176, 0.4); }
      .torbox-quality { font-weight: 600; color: #64b5f6; min-width: 50px; font-size: 13px; }
      .torbox-size { color: #ce93d8; min-width: 65px; text-align: right; font-size: 12px; }
      .torbox-seeders { color: #ffd54f; min-width: 40px; text-align: right; font-size: 12px; }
      .torbox-title {
        flex: 1; color: #bbb; font-size: 12px;
        word-break: break-all;
      }
      .torbox-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 12px;
        padding-bottom: 10px;
        border-bottom: 1px solid #2a2a4a;
      }
      .torbox-filter-btn {
        padding: 4px 10px;
        border-radius: 12px;
        border: 1px solid #444;
        background: transparent;
        color: #aaa;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .torbox-filter-btn:hover {
        border-color: #888;
        color: #fff;
      }
      .torbox-filter-btn.active {
        background: #f5c518;
        color: #000;
        border-color: #f5c518;
        font-weight: 600;
      }
      .torbox-filter-group {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .torbox-filter-label {
        font-size: 10px;
        color: #666;
        text-transform: uppercase;
        margin-right: 2px;
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

    // On TMDB pages, use extractTmdbInfo; on IMDb pages, use extractImdbInfo
    if (window.location.hostname.includes("themoviedb.org")) {
      if (!imdbInfo || !imdbInfo.imdbId) {
        imdbInfo = extractTmdbInfo();
      }
    } else {
      imdbInfo = extractImdbInfo();
    }

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
          <div style="display:flex;gap:8px;align-items:center;">
            <button id="torbox-modal-options" title="Settings / Options" style="background:none;border:none;color:#a0a0b0;cursor:pointer;font-size:16px;padding:2px 6px;border-radius:4px;">⚙️</button>
            <button id="torbox-modal-close">&times;</button>
          </div>
        </div>
        <div id="torbox-modal-body"></div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.querySelector("#torbox-modal-options").addEventListener("click", () => {
      browser.runtime.sendMessage({ type: "OPEN_OPTIONS" });
    });
    modalEl.querySelector("#torbox-modal-close").addEventListener("click", closeModal);
    modalEl.addEventListener("click", (e) => {
      if (e.target === modalEl) closeModal();
    });
    escHandler = (e) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", escHandler);

    fetchStreams();
  }

  function closeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
    if (escHandler) {
      document.removeEventListener("keydown", escHandler);
      escHandler = null;
    }
  }

  function setModalBody(html) {
    const body = document.getElementById("torbox-modal-body");
    if (body) {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      body.replaceChildren(...parsed.body.childNodes);
    }
  }

  // ─── Background Messaging ────────────────────────────────────────────────

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "STREAM_PROGRESS") {
      setModalBody(`
        <div class="torbox-loading">
          <div class="torbox-spinner"></div>
          <p>${escapeHtml(msg.message)}</p>
        </div>
      `);
    } else if (msg.type === "OPEN_MODAL") {
      openModal();
    }
  });

  // ─── Renderers ────────────────────────────────────────────────────────────

  let activeFilters = { quality: "all", cachedOnly: false, playerPref: "auto", search: "" };

  async function loadPlayerPref() {
    const res = await browser.storage.local.get(["player_preference", "default_quality_filter"]);
    if (res && res.player_preference) {
      activeFilters.playerPref = res.player_preference;
    }
    if (res && res.default_quality_filter) {
      activeFilters.quality = res.default_quality_filter;
    }
  }

  function getFilteredStreams() {
    let filtered = currentStreams;
    if (activeFilters.quality !== "all") {
      filtered = filtered.filter(s => s.quality === activeFilters.quality);
    }
    if (activeFilters.cachedOnly) {
      filtered = filtered.filter(s => s.cached);
    }
    if (activeFilters.search && activeFilters.search.trim()) {
      const q = activeFilters.search.trim().toLowerCase();
      filtered = filtered.filter(s => 
        (s.title || "").toLowerCase().includes(q) ||
        (s.name || "").toLowerCase().includes(q) ||
        (s.quality || "").toLowerCase().includes(q)
      );
    }
    return filtered;
  }

  function renderMediaBadges(title) {
    if (!title) return "";
    let badges = "";
    if (/4k|2160p|uhd/i.test(title)) badges += `<span class="torbox-badge torbox-badge-4k">4K</span>`;
    else if (/1080p/i.test(title)) badges += `<span class="torbox-badge torbox-badge-1080p">1080p</span>`;
    else if (/720p/i.test(title)) badges += `<span class="torbox-badge torbox-badge-720p">720p</span>`;

    if (/hevc|x265|h\.?265/i.test(title)) badges += `<span class="torbox-badge torbox-badge-codec">HEVC</span>`;
    else if (/x264|h\.?264/i.test(title)) badges += `<span class="torbox-badge torbox-badge-codec">x264</span>`;

    if (/atmos/i.test(title)) badges += `<span class="torbox-badge torbox-badge-audio">Atmos</span>`;
    else if (/5\.1|7\.1/i.test(title)) badges += `<span class="torbox-badge torbox-badge-audio">5.1</span>`;

    return badges;
  }

  function renderStreams() {
    let html = "";

    if (imdbInfo && imdbInfo.mediaType === "series") {
      const currentS = imdbInfo.season || 1;
      const currentE = imdbInfo.episode || 1;
      html += `
        <div class="torbox-episode-picker">
          <label>S</label><input id="torbox-season" type="number" min="1" value="${currentS}">
          <label>E</label><input id="torbox-episode" type="number" min="1" value="${currentE}">
          <button id="torbox-ep-go">Go</button>
        </div>
      `;
    }

    if (!Array.isArray(currentStreams)) {
      currentStreams = [];
    }

    const qualities = ["all", ...new Set(currentStreams.map(s => s.quality).filter(Boolean))];
    const cachedCount = currentStreams.filter(s => s.cached).length;

    html += `
      <div class="torbox-search-box">
        <input id="torbox-stream-search" type="text" class="torbox-search-input" placeholder="🔍 Search streams (YTS, 1080p, QxR, Atmos...)" value="${escapeHtml(activeFilters.search || "")}">
      </div>
    `;

    html += `<div class="torbox-filters">`;
    html += `<div class="torbox-filter-group"><span class="torbox-filter-label">Quality</span>`;
    qualities.forEach(q => {
      const label = q === "all" ? "All" : q;
      const active = activeFilters.quality === q ? "active" : "";
      html += `<button class="torbox-filter-btn ${active}" data-filter-quality="${q}">${label}</button>`;
    });
    html += `</div>`;

    html += `<div class="torbox-filter-group"><span class="torbox-filter-label">Player</span>`;
    ["auto", "ask", "browser", "mpv", "vlc"].forEach(p => {
      const label = p === "auto" ? "Auto" : (p === "ask" ? "ASK" : p.toUpperCase());
      const active = activeFilters.playerPref === p ? "active" : "";
      html += `<button class="torbox-filter-btn ${active}" data-filter-player="${p}">${label}</button>`;
    });
    html += `</div>`;

    html += `<div class="torbox-filter-group"><span class="torbox-filter-label">Status</span>`;
    html += `<button class="torbox-filter-btn ${activeFilters.cachedOnly ? 'active' : ''}" data-filter-cached="true">Cached Only (${cachedCount})</button>`;
    html += `</div></div>`;

    const filtered = getFilteredStreams();
    html += `<div class="torbox-stats">Showing ${filtered.length} of ${currentStreams.length} streams &bull; ${cachedCount} cached ✅</div>`;

    filtered.forEach((s, i) => {
      const origIdx = currentStreams.indexOf(s);
      html += `
        <div class="torbox-stream-item ${s.cached ? "cached" : "uncached"}" data-idx="${origIdx}">
          <span class="torbox-badge ${s.cached ? "torbox-badge-cached" : "torbox-badge-uncached"}">${s.cached ? "CACHED" : "—"}</span>
          <span class="torbox-quality">${escapeHtml(s.quality || "???")}</span>
          ${renderMediaBadges(s.title || s.name)}
          <span class="torbox-size">${escapeHtml(s.size_human || "?")}</span>
          <span class="torbox-seeders">👤${s.seeders != null ? s.seeders : "?"}</span>
          <span class="torbox-title">${escapeHtml(s.title || "")}</span>
        </div>
      `;
    });

    if (filtered.length === 0) {
      html += `<div class="torbox-error">No streams match the current filters.</div>`;
    }

    setModalBody(html);

    const searchInput = document.getElementById("torbox-stream-search");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        activeFilters.search = e.target.value;
        renderStreams();
        const newSearch = document.getElementById("torbox-stream-search");
        if (newSearch) {
          newSearch.focus();
          newSearch.setSelectionRange(newSearch.value.length, newSearch.value.length);
        }
      });
    }

    const epBtn = document.getElementById("torbox-ep-go");
    if (epBtn) {
      epBtn.addEventListener("click", () => { activeFilters.quality = "all"; activeFilters.cachedOnly = false; fetchStreams(); });
    }

    document.querySelectorAll("[data-filter-quality]").forEach(btn => {
      btn.addEventListener("click", () => {
        activeFilters.quality = btn.dataset.filterQuality;
        renderStreams();
      });
    });
    document.querySelectorAll("[data-filter-player]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const pref = btn.dataset.filterPlayer;
        activeFilters.playerPref = pref;
        await browser.storage.local.set({ player_preference: pref });
        renderStreams();
      });
    });
    document.querySelectorAll("[data-filter-cached]").forEach(btn => {
      btn.addEventListener("click", () => {
        activeFilters.cachedOnly = !activeFilters.cachedOnly;
        renderStreams();
      });
    });

    document.querySelectorAll(".torbox-stream-item").forEach(el => {
      el.addEventListener("click", () => {
        const idx = parseInt(el.dataset.idx);
        pickStream(currentStreams[idx]);
      });
    });
  }

  function renderFilePicker(torrentId, files) {
    currentTorrentId = torrentId;
    let html = '<p style="color:#8899aa;margin-bottom:10px;">Pick a file to stream:</p>';
    files.forEach((f) => {
      const isVideo = VIDEO_EXTS.has(getFileExt(f.name));
      const icon = isVideo ? "🎬" : "📎";
      html += `<div class="torbox-file-item" data-file-id="${f.id}">${icon} ${escapeHtml(f.name)} <span style="color:#888;font-size:11px;">(${escapeHtml(f.size_human)})</span></div>`;
    });
    html += '<div style="text-align:center;margin-top:10px;"><button class="torbox-btn torbox-btn-secondary" id="torbox-cancel-files">Cancel</button></div>';
    setModalBody(html);

    document.querySelectorAll(".torbox-file-item").forEach((el) => {
      el.addEventListener("click", async () => {
        setModalBody('<div class="torbox-loading"><div class="torbox-spinner"></div><p>Getting stream URL...</p></div>');
        const fileId = parseInt(el.dataset.fileId);
        try {
          const resp = await browser.runtime.sendMessage({ type: "PICK_FILE", torrentId: currentTorrentId, fileId });
          if (resp && resp.url) {
            handleStreamSuccess({
              method: "url_only",
              url: resp.url,
              torrent_id: currentTorrentId,
              file_name: "Selected File",
            });
          }
        } catch (e) {
          setModalBody(`<div class="torbox-error">⚠ ${escapeHtml(e.message)}</div>`);
        }
      });
    });

    document.getElementById("torbox-cancel-files").addEventListener("click", () => {
      renderStreams();
    });
  }

  function handleStreamSuccess(data) {
    currentTorrentId = data.torrent_id;

    let statusIcon = "🎬";
    let statusText = "Stream Ready!";

    if (data.method === "browser") {
      statusIcon = "🎬";
      statusText = "Playing in Browser Tab!";
    } else if (data.method === "mpv") {
      statusIcon = "🍿";
      statusText = "Playing in MPV!";
    } else if (data.method === "vlc") {
      statusIcon = "🟧";
      statusText = "Playing in VLC!";
    } else if (data.method === "ask") {
      statusIcon = "⚡";
      statusText = "Stream Ready — Choose Player!";
    }

    setModalBody(`
      <div class="torbox-success">
        <p style="font-size:28px;margin-bottom:8px;">${statusIcon}</p>
        <p><strong>${statusText}</strong></p>
        <p style="font-size:12px;margin-top:6px;opacity:0.8;">${escapeHtml(data.file_name || "")} (${data.file_size || ""})</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;align-items:center;margin-top:12px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
          <button class="torbox-btn torbox-btn-primary" id="torbox-try-browser-btn">🌐 Open in Browser Tab</button>
          <button class="torbox-btn torbox-btn-primary" id="torbox-try-mpv-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" style="vertical-align:text-bottom;margin-right:4px;"><circle cx="12" cy="12" r="11" fill="#8d004e"/><circle cx="12" cy="12" r="8.5" stroke="#ffffff" stroke-width="1.5" fill="none"/><path d="M10 8.5l5.5 3.5-5.5 3.5v-7z" fill="#ffffff"/></svg>Open in MPV
          </button>
          <button class="torbox-btn torbox-btn-primary" id="torbox-try-vlc-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" style="vertical-align:text-bottom;margin-right:4px;"><path d="M10.5 2h3l1.8 6.5h-6.6L10.5 2z" fill="#ff7f00"/><path d="M7.8 10.5h8.4l1.2 4H6.6l1.2-4z" fill="#ffffff"/><path d="M8.7 8.5h6.6l.9 3.5H7.8l.9-3.5z" fill="#ff7f00"/><path d="M5.4 16h13.2l1.4 4.5H4L5.4 16z" fill="#ff7f00"/><path d="M6.6 14.5h10.8l.9 3H5.7l.9-3z" fill="#ffffff"/><path d="M2 21h20v1.5H2V21z" fill="#d96600"/></svg>Open in VLC
          </button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
          <button class="torbox-btn torbox-btn-secondary" id="torbox-back-btn">← Back to Streams</button>
          <button class="torbox-btn torbox-btn-secondary" id="torbox-copy-btn">📋 Copy Stream Link</button>
          <button class="torbox-btn torbox-btn-danger" id="torbox-del-btn">🗑️ Delete Torrent</button>
          <button class="torbox-btn torbox-btn-secondary" id="torbox-done-btn">Done</button>
        </div>
      </div>
    `);

    document.getElementById("torbox-try-browser-btn").addEventListener("click", async () => {
      await browser.runtime.sendMessage({
        type: "OPEN_PLAYER_TAB",
        url: data.url,
        title: data.file_name,
        torrentId: data.torrent_id,
      });
    });

    document.getElementById("torbox-try-mpv-btn").addEventListener("click", async () => {
      const mpvBtn = document.getElementById("torbox-try-mpv-btn");
      mpvBtn.textContent = "Launching MPV...";
      const resp = await browser.runtime.sendMessage({ type: "TRY_PLAYER", player: "mpv", url: data.url });
      if (resp && resp.success) {
        mpvBtn.textContent = "Launched in MPV! 🍿";
      } else {
        alert("Helper script not installed or MPV binary missing. Run 'helpers/install.sh' (or 'install.bat' on Windows) to enable.");
        mpvBtn.textContent = "🚀 Open in MPV";
      }
    });

    document.getElementById("torbox-try-vlc-btn").addEventListener("click", async () => {
      const vlcBtn = document.getElementById("torbox-try-vlc-btn");
      vlcBtn.textContent = "Launching VLC...";
      const resp = await browser.runtime.sendMessage({ type: "TRY_PLAYER", player: "vlc", url: data.url });
      if (resp && resp.success) {
        vlcBtn.textContent = "Launched in VLC! 🍿";
      } else {
        alert("Helper script not installed or VLC binary missing. Run 'helpers/install.sh' (or 'install.bat' on Windows) to enable.");
        vlcBtn.textContent = "🍊 Open in VLC";
      }
    });

    const copyBtn = document.getElementById("torbox-copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(data.url);
        copyBtn.textContent = "Copied!";
        setTimeout(() => copyBtn.textContent = "📋 Copy Stream Link", 2000);
      });
    }

    const backBtn = document.getElementById("torbox-back-btn");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        renderStreams();
      });
    }

    const delBtn = document.getElementById("torbox-del-btn");
    if (delBtn) {
      delBtn.addEventListener("click", async () => {
        setModalBody('<div class="torbox-loading"><div class="torbox-spinner"></div><p>Deleting torrent...</p></div>');
        const resp = await browser.runtime.sendMessage({ type: "DELETE_TORRENT", torrentId: currentTorrentId });
        if (resp && resp.success) {
          setModalBody(`
            <div class="torbox-success">
              <p>✅ Torrent deleted from TorBox.</p>
            </div>
            <div style="text-align:center;">
              <button class="torbox-btn torbox-btn-secondary" id="torbox-done-btn2">Close</button>
            </div>
          `);
          document.getElementById("torbox-done-btn2").addEventListener("click", closeModal);
        } else {
          setModalBody(`<div class="torbox-error">Failed to delete torrent.</div>`);
        }
      });
    }

    const doneBtn = document.getElementById("torbox-done-btn");
    if (doneBtn) doneBtn.addEventListener("click", closeModal);
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  async function fetchStreams() {
    setModalBody('<div class="torbox-loading"><div class="torbox-spinner"></div><p>Resolving title info & fetching streams...</p></div>');

    if (window.location.hostname.includes("themoviedb.org")) {
      await ensureImdbId();
    } else if (!imdbInfo || !imdbInfo.imdbId) {
      imdbInfo = extractImdbInfo();
    }

    if (!imdbInfo || !imdbInfo.imdbId) {
      setModalBody(`
        <div class="torbox-error">
          ⚠ Could not resolve IMDb ID for this title.<br>
          <span style="font-size:12px;opacity:0.8;margin-top:6px;display:block;">Try refreshing the page or ensuring external links are loaded.</span>
        </div>
      `);
      return;
    }

    let targetSeason = imdbInfo.season || 1;
    let targetEpisode = imdbInfo.episode || 1;

    const sEl = document.getElementById("torbox-season");
    const eEl = document.getElementById("torbox-episode");
    if (sEl && eEl) {
      targetSeason = parseInt(sEl.value) || targetSeason;
      targetEpisode = parseInt(eEl.value) || targetEpisode;
      imdbInfo.season = targetSeason;
      imdbInfo.episode = targetEpisode;
    }

    setModalBody('<div class="torbox-loading"><div class="torbox-spinner"></div><p>Fetching streams from Torrentio...</p></div>');

    const msg = { type: "FETCH_TORRENTIO", imdbId: imdbInfo.imdbId };
    if (imdbInfo.mediaType === "series") {
      msg.season = targetSeason;
      msg.episode = targetEpisode;
    }

    try {
      const resp = await browser.runtime.sendMessage(msg);
      if (!resp) {
        setModalBody(`
          <div class="torbox-error">⚠ No response from background script. Please check your extension settings or reload the extension.</div>
          <div style="text-align:center;margin-top:12px;">
            <button class="torbox-btn torbox-btn-primary" id="torbox-retry-btn">Retry</button>
          </div>
        `);
        document.getElementById("torbox-retry-btn").addEventListener("click", fetchStreams);
        return;
      }
      if (resp.type === "TORRENTIO_ERROR") {
        setModalBody(`
          <div class="torbox-error">⚠ ${escapeHtml(resp.message)}</div>
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

        setModalBody(`<div class="torbox-loading"><div class="torbox-spinner"></div><p>Checking TorBox cache for ${resp.streams.length} streams...</p></div>`);
        
        const cacheResp = await browser.runtime.sendMessage({
          type: "CHECK_CACHE",
          hashes: resp.streams.map(s => s.info_hash),
          streams: resp.streams,
        });

        if (cacheResp.type === "CACHE_ERROR") {
          setModalBody(`
            <div class="torbox-error">⚠ ${escapeHtml(cacheResp.message)}</div>
            <div style="text-align:center;margin-top:12px;">
              <button class="torbox-btn torbox-btn-primary" id="torbox-opts-btn">Open Settings</button>
            </div>
          `);
          document.getElementById("torbox-opts-btn").addEventListener("click", () => {
            browser.runtime.sendMessage({ type: "OPEN_OPTIONS" });
          });
          return;
        }

        currentStreams = (cacheResp && Array.isArray(cacheResp.streams)) ? cacheResp.streams : [];
        await loadPlayerPref();
        renderStreams();
      }
    } catch (e) {
      setModalBody(`<div class="torbox-error">⚠ ${escapeHtml(e.message || "Communication error")}</div>`);
    }
  }

  async function pickStream(stream) {
    setModalBody(`<div class="torbox-loading"><div class="torbox-spinner"></div><p>${stream.cached ? "✅ Cached — preparing stream..." : "❌ Not cached — downloading on TorBox..."}</p></div>`);

    const streamData = {
      hash: stream.info_hash,
      file_idx: stream.file_idx,
      is_cached: !!stream.cached,
      imdb_id: imdbInfo ? imdbInfo.imdbId : null,
      media_type: imdbInfo ? (imdbInfo.mediaType || "movie") : "movie",
    };

    if (imdbInfo && imdbInfo.mediaType === "series") {
      streamData.season = imdbInfo.season || 1;
      streamData.episode = imdbInfo.episode || 1;
    }

    try {
      const resp = await browser.runtime.sendMessage({ type: "START_STREAM", data: streamData });
      if (!resp) return;

      if (resp.type === "STREAM_ERROR") {
        setModalBody(`
          <div class="torbox-error">⚠ ${escapeHtml(resp.message)}</div>
          <div style="text-align:center;margin-top:12px;">
            <button class="torbox-btn torbox-btn-primary" id="torbox-retry-stream">Retry</button>
            <button class="torbox-btn torbox-btn-secondary" id="torbox-cancel-stream">Cancel</button>
          </div>
        `);
        document.getElementById("torbox-retry-stream").addEventListener("click", () => pickStream(stream));
        document.getElementById("torbox-cancel-stream").addEventListener("click", () => renderStreams());
        return;
      }

      if (resp.type === "STREAM_RESULT") {
        const res = resp.data;
        if (res.action === "pick_file") {
          renderFilePicker(res.torrent_id, res.files);
        } else {
          handleStreamSuccess(res);
        }
      }
    } catch (e) {
      setModalBody(`<div class="torbox-error">⚠ ${escapeHtml(e.message)}</div>`);
    }
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  const VIDEO_EXTS = new Set([".mkv", ".mp4", ".avi", ".webm", ".mov", ".m4v", ".wmv", ".flv", ".ts", ".m2ts"]);
  function getFileExt(filename) {
    const dot = filename.lastIndexOf(".");
    return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    if (window.location.hostname.includes("themoviedb.org")) {
      initTmdb();
    } else {
      imdbInfo = extractImdbInfo();
      if (imdbInfo) {
        browser.runtime.sendMessage({ type: "PAGE_INFO", data: imdbInfo });
        injectButton();
      }
    }

    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (window.location.hostname.includes("themoviedb.org")) {
          initTmdb();
        } else {
          imdbInfo = extractImdbInfo();
          if (imdbInfo) setTimeout(injectButton, 500);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
