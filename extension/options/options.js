const storage = {
  get: (keys) => {
    return new Promise((resolve, reject) => {
      try {
        if (typeof globalThis.browser !== "undefined" && globalThis.browser.storage) {
          globalThis.browser.storage.local.get(keys).then(resolve, reject);
        } else if (typeof globalThis.chrome !== "undefined" && globalThis.chrome.storage) {
          globalThis.chrome.storage.local.get(keys, (res) => {
            const error = globalThis.chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(res || {});
          });
        } else {
          reject(new Error("Extension storage is unavailable."));
        }
      } catch (e) {
        reject(e);
      }
    });
  },
  set: (items) => {
    return new Promise((resolve, reject) => {
      try {
        if (typeof globalThis.browser !== "undefined" && globalThis.browser.storage) {
          globalThis.browser.storage.local.set(items).then(resolve, reject);
        } else if (typeof globalThis.chrome !== "undefined" && globalThis.chrome.storage) {
          globalThis.chrome.storage.local.set(items, () => {
            const error = globalThis.chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve();
          });
        } else {
          reject(new Error("Extension storage is unavailable."));
        }
      } catch (e) {
        reject(e);
      }
    });
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  const apiKeyEl = document.getElementById("api-key");
  const toggleKeyEl = document.getElementById("toggle-key");
  const playerPrefEl = document.getElementById("player-pref");
  const torrentioUrlEl = document.getElementById("torrentio-url");
  const maxResultsEl = document.getElementById("max-results");
  const saveBtnEl = document.getElementById("save-btn");
  const statusMsgEl = document.getElementById("status-msg");

  const mpvPathEl = document.getElementById("mpv-path");
  const vlcPathEl = document.getElementById("vlc-path");

  const qualityPrefEl = document.getElementById("quality-pref");
  const qual4kEl = document.getElementById("qual-4k");
  const qual1080pEl = document.getElementById("qual-1080p");
  const qual720pEl = document.getElementById("qual-720p");
  const qual480pEl = document.getElementById("qual-480p");
  const maxPerQualEl = document.getElementById("max-per-quality");

  const subtitleLangsEl = document.getElementById("subtitle-langs");
  const formEl = document.getElementById("options-form");
  let statusTimer;

  function showStatus(message, success = false) {
    clearTimeout(statusTimer);
    statusMsgEl.textContent = message;
    statusMsgEl.className = success ? "success" : "error";
    if (success) statusTimer = setTimeout(() => { statusMsgEl.textContent = ""; }, 2500);
  }

  function loadSelect(select, value, fallback) {
    select.value = Array.from(select.options).some(option => option.value === value) ? value : fallback;
  }

  function loadNumber(input, value, fallback) {
    const number = Number(value);
    input.value = Number.isInteger(number) && number >= Number(input.min) && number <= Number(input.max)
      ? number : fallback;
  }

  // Load existing options
  saveBtnEl.disabled = true;
  let config;
  try {
    config = await storage.get([
    "torbox_api_key",
    "player_preference",
    "default_quality_filter",
    "enabled_qualities",
    "max_per_quality",
    "mpv_path",
    "vlc_path",
    "torrentio_base_url",
    "subtitle_languages",
    "max_results",
    ]);
  } catch (error) {
    showStatus(`Could not load settings: ${error.message}. Reload this page to try again.`);
    return;
  }

  if (config.torbox_api_key) apiKeyEl.value = config.torbox_api_key;
  loadSelect(playerPrefEl, config.player_preference, "auto");
  loadSelect(qualityPrefEl, config.default_quality_filter, "all");
  if (config.mpv_path) mpvPathEl.value = config.mpv_path;
  if (config.vlc_path) vlcPathEl.value = config.vlc_path;
  loadNumber(maxPerQualEl, config.max_per_quality, 5);

  const enabledQuals = Array.isArray(config.enabled_qualities) && config.enabled_qualities.some(q => ["4K", "1080p", "720p", "480p"].includes(q))
    ? config.enabled_qualities : ["4K", "1080p", "720p", "480p"];
  qual4kEl.checked = enabledQuals.includes("4K");
  qual1080pEl.checked = enabledQuals.includes("1080p");
  qual720pEl.checked = enabledQuals.includes("720p");
  qual480pEl.checked = enabledQuals.includes("480p");

  subtitleLangsEl.value = config.subtitle_languages || "en, browser";
  torrentioUrlEl.value = config.torrentio_base_url || "https://torrentio.strem.fun";
  loadNumber(maxResultsEl, config.max_results, 20);
  saveBtnEl.disabled = false;

  toggleKeyEl.addEventListener("click", () => {
    if (apiKeyEl.type === "password") {
      apiKeyEl.type = "text";
      toggleKeyEl.textContent = "Hide";
    } else {
      apiKeyEl.type = "password";
      toggleKeyEl.textContent = "Show";
    }
  });

  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saveBtnEl.disabled) return;
    const key = apiKeyEl.value.trim();
    const pref = playerPrefEl.value;
    const qualPref = qualityPrefEl.value;
    const mpvPath = mpvPathEl.value.trim();
    const vlcPath = vlcPathEl.value.trim();
    const url = torrentioUrlEl.value.trim() || "https://torrentio.strem.fun";
    const subLangs = subtitleLangsEl.value.trim() || "en, browser";
    const maxRes = Number(maxResultsEl.value);

    const enabledQualities = [];
    if (qual4kEl.checked) enabledQualities.push("4K");
    if (qual1080pEl.checked) enabledQualities.push("1080p");
    if (qual720pEl.checked) enabledQualities.push("720p");
    if (qual480pEl.checked) enabledQualities.push("480p");

    const maxPerQual = Number(maxPerQualEl.value);

    if (!formEl.reportValidity()) return;
    try {
      const parsedUrl = new URL(url);
      if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
        throw new Error("invalid URL");
      }
    } catch {
      showStatus("Enter an HTTP or HTTPS Torrentio URL without credentials, a query, or a fragment.");
      torrentioUrlEl.focus();
      return;
    }
    if (!enabledQualities.length) {
      showStatus("Select at least one included resolution.");
      qual4kEl.focus();
      return;
    }
    if (qualPref !== "all" && !enabledQualities.includes(qualPref)) {
      showStatus("Include the resolution selected by your quality filter.");
      qualityPrefEl.focus();
      return;
    }

    saveBtnEl.disabled = true;
    try {
      await storage.set({
        torbox_api_key: key,
        player_preference: pref,
        default_quality_filter: qualPref,
        enabled_qualities: enabledQualities,
        max_per_quality: maxPerQual,
        mpv_path: mpvPath,
        vlc_path: vlcPath,
        torrentio_base_url: url.replace(/\/+$/, ""),
        subtitle_languages: subLangs,
        max_results: maxRes,
      });
      showStatus("Saved!", true);
    } catch (error) {
      showStatus(`Could not save settings: ${error.message}`);
    } finally {
      saveBtnEl.disabled = false;
    }
  });
});
