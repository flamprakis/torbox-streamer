/**
 * TorBox Streamer — Content Script
 * Runs on IMDb title pages. Extracts the IMDb ID and page type,
 * then notifies the background script that a streamable page is active.
 */

(function () {
  "use strict";

  function extractImdbInfo() {
    const url = window.location.href;
    const match = url.match(/imdb\.com\/title\/(tt\d{7,})/);
    if (!match) return null;

    const imdbId = match[1];

    // Determine if it's a movie or series by checking the page
    // IMDb uses different URL patterns and page elements
    let mediaType = "movie"; // default
    let title = "";

    // Try to get the title from the page
    const titleEl =
      document.querySelector('[data-testid="hero__primary-text"]') ||
      document.querySelector("h1[data-testid='hero__primary-text']") ||
      document.querySelector("h1");
    if (titleEl) {
      title = titleEl.textContent.trim();
    }

    // Check if it's a series (look for episode/season indicators)
    const isSeries =
      document.querySelector('[data-testid="hero-subnav-bar-season-episode-links"]') ||
      document.querySelector("a[href*='/episodes/']") ||
      document.querySelector("[data-testid='title-series']") ||
      url.includes("/episodes/") ||
      (document.title && document.title.toLowerCase().includes("tv series"));

    if (isSeries) {
      mediaType = "series";
    }

    return { imdbId, mediaType, title, url };
  }

  function init() {
    const info = extractImdbInfo();
    if (!info) return;

    // Store in page so popup can access it
    window.__torboxStreamerInfo = info;

    // Notify background that we're on a streamable page
    browser.runtime.sendMessage({
      type: "PAGE_INFO",
      data: info,
    });
  }

  // Listen for messages from popup asking for page info
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "GET_PAGE_INFO") {
      const info = extractImdbInfo();
      return Promise.resolve(info);
    }
  });

  // Run on load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
