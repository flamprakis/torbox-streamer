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

  // Load existing options
  const config = await browser.storage.local.get([
    "torbox_api_key",
    "player_preference",
    "default_quality_filter",
    "mpv_path",
    "vlc_path",
    "torrentio_base_url",
    "max_results",
  ]);

  if (config.torbox_api_key) apiKeyEl.value = config.torbox_api_key;
  if (config.player_preference) playerPrefEl.value = config.player_preference;
  if (config.default_quality_filter) qualityPrefEl.value = config.default_quality_filter;
  if (config.mpv_path) mpvPathEl.value = config.mpv_path;
  if (config.vlc_path) vlcPathEl.value = config.vlc_path;
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
    const maxRes = parseInt(maxResultsEl.value) || 20;

    await browser.storage.local.set({
      torbox_api_key: key,
      player_preference: pref,
      default_quality_filter: qualPref,
      mpv_path: mpvPath,
      vlc_path: vlcPath,
      torrentio_base_url: url,
      max_results: maxRes,
    });

    statusMsgEl.textContent = "Saved!";
    statusMsgEl.className = "success";
    setTimeout(() => {
      statusMsgEl.textContent = "";
    }, 2500);
  });
});
