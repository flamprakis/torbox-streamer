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

  // Load existing options
  const config = await storage.get([
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

  if (config.torbox_api_key) apiKeyEl.value = config.torbox_api_key;
  if (config.player_preference) playerPrefEl.value = config.player_preference;
  if (config.default_quality_filter) qualityPrefEl.value = config.default_quality_filter;
  if (config.mpv_path) mpvPathEl.value = config.mpv_path;
  if (config.vlc_path) vlcPathEl.value = config.vlc_path;
  if (config.max_per_quality) maxPerQualEl.value = config.max_per_quality;

  const enabledQuals = config.enabled_qualities || ["4K", "1080p", "720p", "480p"];
  qual4kEl.checked = enabledQuals.includes("4K");
  qual1080pEl.checked = enabledQuals.includes("1080p");
  qual720pEl.checked = enabledQuals.includes("720p");
  qual480pEl.checked = enabledQuals.includes("480p");

  subtitleLangsEl.value = config.subtitle_languages || "en, browser";
  torrentioUrlEl.value = config.torrentio_base_url || "https://torrentio.strem.fun";
  maxResultsEl.value = config.max_results || 20;

  toggleKeyEl.addEventListener("click", () => {
    if (apiKeyEl.type === "password") {
      apiKeyEl.type = "text";
      toggleKeyEl.textContent = "Hide";
    } else {
      apiKeyEl.type = "password";
      toggleKeyEl.textContent = "Show";
    }
  });

  saveBtnEl.addEventListener("click", async () => {
    const key = apiKeyEl.value.trim();
    const pref = playerPrefEl.value;
    const qualPref = qualityPrefEl.value;
    const mpvPath = mpvPathEl.value.trim();
    const vlcPath = vlcPathEl.value.trim();
    const url = torrentioUrlEl.value.trim() || "https://torrentio.strem.fun";
    const subLangs = subtitleLangsEl.value.trim() || "en, browser";
    const maxRes = parseInt(maxResultsEl.value) || 20;

    const enabledQualities = [];
    if (qual4kEl.checked) enabledQualities.push("4K");
    if (qual1080pEl.checked) enabledQualities.push("1080p");
    if (qual720pEl.checked) enabledQualities.push("720p");
    if (qual480pEl.checked) enabledQualities.push("480p");

    const maxPerQual = parseInt(maxPerQualEl.value) || 5;

    await storage.set({
      torbox_api_key: key,
      player_preference: pref,
      default_quality_filter: qualPref,
      enabled_qualities: enabledQualities,
      max_per_quality: maxPerQual,
      mpv_path: mpvPath,
      vlc_path: vlcPath,
      torrentio_base_url: url,
      subtitle_languages: subLangs,
      max_results: maxRes,
    });

    statusMsgEl.textContent = "Saved!";
    statusMsgEl.className = "success";
    setTimeout(() => {
      statusMsgEl.textContent = "";
    }, 2500);
  });
});
