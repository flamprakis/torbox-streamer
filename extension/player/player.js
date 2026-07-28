var browser = typeof globalThis.browser !== "undefined" ? globalThis.browser : globalThis.chrome;

function srtToVtt(srtText, delaySec = 0) {
  if (!srtText) return "WEBVTT\n\n";
  if (srtText.trim().startsWith("WEBVTT")) {
    return srtText;
  }

  let vtt = "WEBVTT\n\n";
  const clean = srtText.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const timeRegex = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{1,3})/;

  const blocks = clean.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    let timeIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      if (timeRegex.test(lines[i])) {
        timeIdx = i;
        break;
      }
    }

    if (timeIdx === -1) continue;

    let timeLine = lines[timeIdx].replace(/,/g, ".");
    if (delaySec !== 0) {
      timeLine = adjustVttTimeline(timeLine, delaySec);
    }

    const textLines = lines.slice(timeIdx + 1).filter(l => !/^\d+$/.test(l.trim()));
    const cueText = textLines.join("\n").replace(/\{[^}]+\}/g, "").trim();

    if (cueText) {
      vtt += `${timeLine}\n${cueText}\n\n`;
    }
  }

  return vtt;
}

function adjustVttTimeline(timeLine, delaySec) {
  const parts = timeLine.split("-->");
  if (parts.length !== 2) return timeLine;

  const start = shiftVttTime(parts[0].trim(), delaySec);
  const end = shiftVttTime(parts[1].trim(), delaySec);
  return `${start} --> ${end}`;
}

function shiftVttTime(timeStr, delaySec) {
  const match = timeStr.match(/(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})/);
  if (!match) return timeStr;

  const hours = parseInt(match[1] || "0");
  const mins = parseInt(match[2]);
  const secs = parseInt(match[3]);
  const ms = parseInt(match[4]);

  let totalMs = hours * 3600000 + mins * 60000 + secs * 1000 + ms;
  totalMs = Math.max(0, totalMs + Math.round(delaySec * 1000));

  const h = String(Math.floor(totalMs / 3600000)).padStart(2, "0");
  const m = String(Math.floor((totalMs % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((totalMs % 60000) / 1000)).padStart(2, "0");
  const millis = String(totalMs % 1000).padStart(3, "0");

  return `${h}:${m}:${s}.${millis}`;
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const sStr = String(s).padStart(2, "0");
  if (h > 0) {
    const mStr = String(m).padStart(2, "0");
    return `${h}:${mStr}:${sStr}`;
  }
  return `${m}:${sStr}`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const streamUrl = params.get("url");
  const streamTitle = params.get("title") || "Stream";
  const torrentId = params.get("torrent_id");
  const imdbId = params.get("imdb_id");
  const mediaType = params.get("media_type") || "movie";
  const isSeries = mediaType === "series";
  const season = isSeries ? (parseInt(params.get("season")) || 1) : null;
  const episode = isSeries ? (parseInt(params.get("episode")) || 1) : null;

  const container = document.getElementById("player-container");
  const video = document.getElementById("video-player");
  const titleEl = document.getElementById("title");
  const btnMpv = document.getElementById("btn-mpv");
  const btnVlc = document.getElementById("btn-vlc");
  const btnCopy = document.getElementById("btn-copy");
  const btnDelete = document.getElementById("btn-delete");

  const subSelect = document.getElementById("sub-select");
  const btnSubMinus = document.getElementById("btn-sub-minus");
  const btnSubPlus = document.getElementById("btn-sub-plus");
  const btnReloadSubs = document.getElementById("btn-reload-subs");

  // Modern Control Elements
  const topOverlay = document.getElementById("top-overlay");
  const bottomOverlay = document.getElementById("bottom-overlay");
  const btnPlayPause = document.getElementById("btn-play-pause");
  const iconPlay = document.getElementById("icon-play");
  const iconPause = document.getElementById("icon-pause");

  const btnVolume = document.getElementById("btn-volume");
  const iconVolHigh = document.getElementById("icon-vol-high");
  const iconVolMute = document.getElementById("icon-vol-mute");
  const volumeSlider = document.getElementById("volume-slider");

  const timeCurrent = document.getElementById("time-current");
  const timeDuration = document.getElementById("time-duration");

  const seekbarWrapper = document.getElementById("seekbar-wrapper");
  const progressBar = document.getElementById("progress-bar");
  const bufferBar = document.getElementById("buffer-bar");
  const timeTooltip = document.getElementById("time-tooltip");

  const btnFullscreen = document.getElementById("btn-fullscreen");
  const iconFsEnter = document.getElementById("icon-fs-enter");
  const iconFsExit = document.getElementById("icon-fs-exit");

  const btnExitPlayer = document.getElementById("btn-exit-player");
  const speedSelect = document.getElementById("speed-select");
  const btnPip = document.getElementById("btn-pip");

  if (btnExitPlayer) {
    btnExitPlayer.addEventListener("click", () => {
      window.close();
    });
  }

  if (speedSelect) {
    speedSelect.addEventListener("change", (e) => {
      video.playbackRate = parseFloat(e.target.value) || 1.0;
    });
  }

  if (btnPip) {
    btnPip.addEventListener("click", async () => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled && !video.disablePictureInPicture) {
          await video.requestPictureInPicture();
        }
      } catch (err) {}
    });
  }

  const centerFlash = document.getElementById("center-play-flash");
  const flashSvgPlay = document.getElementById("flash-svg-play");
  const flashSvgPause = document.getElementById("flash-svg-pause");

  let currentSubtitles = [];
  let rawSubTexts = {};
  let currentDelay = 0;
  let activeTrackBlobUrl = null;
  let idleTimer = null;
  let isSeeking = false;

  titleEl.textContent = streamTitle;

  if (streamUrl) {
    video.src = streamUrl;
  } else {
    titleEl.textContent = "Error: No stream URL provided.";
  }

  video.addEventListener("error", () => {
    titleEl.textContent = `${streamTitle} (Format/Codec not natively supported by browser. Try opening in MPV or VLC.)`;
  });

  // Controls UI Logic & Play/Pause
  function togglePlayPause() {
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  function updatePlayIcons() {
    if (video.paused) {
      if (iconPlay) iconPlay.classList.remove("hidden");
      if (iconPause) iconPause.classList.add("hidden");
      showOverlays();
    } else {
      if (iconPlay) iconPlay.classList.add("hidden");
      if (iconPause) iconPause.classList.remove("hidden");
      resetIdleTimer();
    }
  }

  function flashPlayState() {
    if (!centerFlash) return;
    if (video.paused) {
      if (flashSvgPlay) flashSvgPlay.classList.add("hidden");
      if (flashSvgPause) flashSvgPause.classList.remove("hidden");
    } else {
      if (flashSvgPlay) flashSvgPlay.classList.remove("hidden");
      if (flashSvgPause) flashSvgPause.classList.add("hidden");
    }
    centerFlash.classList.remove("hidden");
    setTimeout(() => {
      centerFlash.classList.add("hidden");
    }, 400);
  }

  if (btnPlayPause) {
    btnPlayPause.addEventListener("click", () => {
      togglePlayPause();
      flashPlayState();
    });
  }

  video.addEventListener("play", updatePlayIcons);
  video.addEventListener("pause", updatePlayIcons);

  video.addEventListener("click", () => {
    togglePlayPause();
    flashPlayState();
  });

  video.addEventListener("dblclick", () => {
    toggleFullscreen();
  });

  // Volume & Mute Controls
  if (volumeSlider) {
    volumeSlider.addEventListener("input", (e) => {
      video.volume = parseFloat(e.target.value);
      video.muted = video.volume === 0;
      updateVolumeIcons();
    });
  }

  if (btnVolume) {
    btnVolume.addEventListener("click", () => {
      video.muted = !video.muted;
      updateVolumeIcons();
    });
  }

  function updateVolumeIcons() {
    if (!iconVolHigh || !iconVolMute) return;
    if (video.muted || video.volume === 0) {
      iconVolHigh.classList.add("hidden");
      iconVolMute.classList.remove("hidden");
      if (volumeSlider) volumeSlider.value = 0;
    } else {
      iconVolHigh.classList.remove("hidden");
      iconVolMute.classList.add("hidden");
      if (volumeSlider) volumeSlider.value = video.volume;
    }
  }

  // Seekbar & Time Progress
  video.addEventListener("loadedmetadata", () => {
    if (timeDuration) timeDuration.textContent = formatTime(video.duration);
  });

  video.addEventListener("timeupdate", () => {
    if (!isSeeking && timeCurrent && video.duration) {
      timeCurrent.textContent = formatTime(video.currentTime);
      const pct = (video.currentTime / video.duration) * 100;
      if (progressBar) progressBar.style.width = `${pct}%`;
    }
  });

  video.addEventListener("progress", () => {
    if (video.buffered.length > 0 && video.duration) {
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      const pct = (bufferedEnd / video.duration) * 100;
      if (bufferBar) bufferBar.style.width = `${pct}%`;
    }
  });

  if (seekbarWrapper) {
    const handleSeek = (e) => {
      const rect = seekbarWrapper.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (video.duration) {
        video.currentTime = pct * video.duration;
        if (progressBar) progressBar.style.width = `${pct * 100}%`;
        if (timeCurrent) timeCurrent.textContent = formatTime(video.currentTime);
      }
    };

    seekbarWrapper.addEventListener("mousedown", (e) => {
      isSeeking = true;
      handleSeek(e);
    });

    window.addEventListener("mousemove", (e) => {
      if (isSeeking) handleSeek(e);
    });

    window.addEventListener("mouseup", () => {
      if (isSeeking) isSeeking = false;
    });

    seekbarWrapper.addEventListener("mousemove", (e) => {
      const rect = seekbarWrapper.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (video.duration && timeTooltip) {
        const hoverTime = pct * video.duration;
        timeTooltip.textContent = formatTime(hoverTime);
        timeTooltip.style.left = `${pct * 100}%`;
        timeTooltip.classList.remove("hidden");
      }
    });

    seekbarWrapper.addEventListener("mouseleave", () => {
      if (timeTooltip) timeTooltip.classList.add("hidden");
    });
  }

  // Fullscreen Controls
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  if (btnFullscreen) {
    btnFullscreen.addEventListener("click", toggleFullscreen);
  }

  document.addEventListener("fullscreenchange", () => {
    if (!iconFsEnter || !iconFsExit) return;
    if (document.fullscreenElement) {
      iconFsEnter.classList.add("hidden");
      iconFsExit.classList.remove("hidden");
    } else {
      iconFsEnter.classList.remove("hidden");
      iconFsExit.classList.add("hidden");
    }
  });

  // Auto-Hiding Controls Overlay
  function showOverlays() {
    if (topOverlay) topOverlay.classList.remove("idle-hide");
    if (bottomOverlay) bottomOverlay.classList.remove("idle-hide");
    container.style.cursor = "default";
  }

  function resetIdleTimer() {
    showOverlays();
    if (idleTimer) clearTimeout(idleTimer);
    if (!video.paused) {
      idleTimer = setTimeout(() => {
        if (topOverlay) topOverlay.classList.add("idle-hide");
        if (bottomOverlay) bottomOverlay.classList.add("idle-hide");
        container.style.cursor = "none";
      }, 3000);
    }
  }

  container.addEventListener("mousemove", resetIdleTimer);
  container.addEventListener("click", resetIdleTimer);

  // Keyboard Shortcuts
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.code === "Space" || e.code === "KeyK") {
      e.preventDefault();
      togglePlayPause();
      flashPlayState();
    } else if (e.code === "KeyF") {
      e.preventDefault();
      toggleFullscreen();
    } else if (e.code === "KeyM") {
      e.preventDefault();
      video.muted = !video.muted;
      updateVolumeIcons();
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - 5);
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
    }
  });

  // Subtitles & Storage
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
    }
  };

  async function initSubtitles() {
    if (subSelect) {
      subSelect.innerHTML = '<option value="">Off</option>';
    }

    try {
      const stored = await storage.get(["torbox_api_key", "subtitle_languages", "player_bundled_subtitles", "last_stream_metadata"]);
      const apiKey = stored.torbox_api_key;
      let bundled = stored.player_bundled_subtitles || [];

      const lastMeta = stored.last_stream_metadata || {};
      const effectiveImdbId = imdbId || lastMeta.imdb_id || "";
      const effectiveMediaType = mediaType || lastMeta.media_type || "movie";
      const effectiveSeason = season || lastMeta.season || 1;
      const effectiveEpisode = episode || lastMeta.episode || 1;
      const effectiveTorrentId = torrentId || lastMeta.torrent_id || "";

      const prefLangsStr = stored.subtitle_languages || "en, browser";
      const prefLangs = typeof parsePreferredLanguages === "function"
        ? parsePreferredLanguages(prefLangsStr, navigator.language)
        : ["en"];

      if (bundled.length === 0 && effectiveTorrentId && apiKey && typeof torboxGetTorrentList === "function") {
        try {
          const torrents = await torboxGetTorrentList(apiKey, effectiveTorrentId);
          if (torrents && torrents.length > 0 && torrents[0].files) {
            bundled = extractBundledSubtitles(apiKey, effectiveTorrentId, torrents[0].files, prefLangs);
          }
        } catch (err) {}
      }

      let external = [];
      if (effectiveImdbId) {
        external = await fetchSubtitles(effectiveImdbId, effectiveSeason, effectiveEpisode, effectiveMediaType, prefLangs);
      }

      currentSubtitles = [...bundled, ...external];

      if (currentSubtitles.length > 0 && subSelect) {
        currentSubtitles.forEach((sub, idx) => {
          const opt = document.createElement("option");
          opt.value = idx;
          opt.textContent = sub.label;
          subSelect.appendChild(opt);
        });

        subSelect.value = "0";
        await loadSelectedSubtitle(0, currentDelay);
      }
    } catch (e) {}
  }

  await initSubtitles();

  if (btnReloadSubs) {
    btnReloadSubs.addEventListener("click", async () => {
      btnReloadSubs.textContent = "⏳";
      await initSubtitles();
      btnReloadSubs.textContent = "🔄";
    });
  }

  async function loadSelectedSubtitle(index, delay = 0) {
    if (activeTrackBlobUrl) {
      URL.revokeObjectURL(activeTrackBlobUrl);
      activeTrackBlobUrl = null;
    }
    const existingTracks = video.querySelectorAll("track");
    existingTracks.forEach(t => t.remove());

    if (index === "" || index < 0 || !currentSubtitles[index]) return;

    const sub = currentSubtitles[index];
    if (!rawSubTexts[sub.url]) {
      try {
        const res = await browser.runtime.sendMessage({ type: "FETCH_SUBTITLE_TEXT", url: sub.url });
        if (res && res.success && res.text) {
          rawSubTexts[sub.url] = res.text;
        } else {
          const resp = await fetch(sub.url);
          rawSubTexts[sub.url] = await resp.text();
        }
      } catch (e) {
        return;
      }
    }

    const subText = rawSubTexts[sub.url];
    let vttContent;
    if (sub.format === "ass" || sub.format === "ssa") {
      vttContent = typeof parseAssToVtt === "function" ? parseAssToVtt(subText) : srtToVtt(subText, delay);
    } else if (sub.format === "vtt") {
      vttContent = subText;
    } else {
      vttContent = srtToVtt(subText, delay);
    }

    const blob = new Blob([vttContent], { type: "text/vtt;charset=utf-8" });
    activeTrackBlobUrl = URL.createObjectURL(blob);

    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = sub.label;
    track.srclang = sub.lang;
    track.src = activeTrackBlobUrl;
    track.default = true;

    video.appendChild(track);

    if (track.track) {
      track.track.mode = "showing";
    }
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = "showing";
    }
  }

  if (subSelect) {
    subSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val === "") {
        loadSelectedSubtitle(-1);
      } else {
        loadSelectedSubtitle(parseInt(val), currentDelay);
      }
    });
  }

  if (btnSubMinus) {
    btnSubMinus.addEventListener("click", () => {
      if (subSelect && subSelect.value !== "") {
        currentDelay -= 0.5;
        btnSubMinus.textContent = `${currentDelay.toFixed(1)}s`;
        loadSelectedSubtitle(parseInt(subSelect.value), currentDelay);
      }
    });
  }

  if (btnSubPlus) {
    btnSubPlus.addEventListener("click", () => {
      if (subSelect && subSelect.value !== "") {
        currentDelay += 0.5;
        btnSubPlus.textContent = `${currentDelay > 0 ? '+' : ''}${currentDelay.toFixed(1)}s`;
        loadSelectedSubtitle(parseInt(subSelect.value), currentDelay);
      }
    });
  }

  if (btnCopy) {
    btnCopy.addEventListener("click", () => {
      if (streamUrl) {
        navigator.clipboard.writeText(streamUrl);
        btnCopy.textContent = "Copied!";
        setTimeout(() => btnCopy.textContent = "📋 Copy", 2000);
      }
    });
  }

  if (btnMpv) {
    btnMpv.addEventListener("click", async () => {
      if (!streamUrl) return;
      btnMpv.textContent = "Launching...";
      const subUrls = currentSubtitles.map(s => s.url);
      const resp = await browser.runtime.sendMessage({ type: "TRY_PLAYER", player: "mpv", url: streamUrl, subtitles: subUrls });
      if (resp && resp.success) {
        btnMpv.textContent = "Launched!";
        video.pause();
      } else {
        btnMpv.textContent = "MPV missing";
        alert("Helper script not installed or MPV binary missing. Run 'helpers/install.sh' (or 'install.bat' on Windows) to enable.");
      }
      setTimeout(() => btnMpv.textContent = "🚀 MPV", 3000);
    });
  }

  if (btnVlc) {
    btnVlc.addEventListener("click", async () => {
      if (!streamUrl) return;
      btnVlc.textContent = "Launching...";
      const subUrls = currentSubtitles.map(s => s.url);
      const resp = await browser.runtime.sendMessage({ type: "TRY_PLAYER", player: "vlc", url: streamUrl, subtitles: subUrls });
      if (resp && resp.success) {
        btnVlc.textContent = "Launched!";
        video.pause();
      } else {
        btnVlc.textContent = "VLC missing";
        alert("Helper script not installed or VLC binary missing. Run 'helpers/install.sh' (or 'install.bat' on Windows) to enable.");
      }
      setTimeout(() => btnVlc.textContent = "🍊 VLC", 3000);
    });
  }

  video.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  video.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;

    const file = e.dataTransfer.files[0];
    if (!file.name.endsWith(".srt") && !file.name.endsWith(".vtt")) {
      alert("Please drop a valid .srt or .vtt subtitle file.");
      return;
    }

    try {
      const text = await file.text();
      const vttContent = file.name.endsWith(".vtt") ? text : parseSrtToVtt(text);
      const blob = new Blob([vttContent], { type: "text/vtt" });
      if (activeTrackBlobUrl) URL.revokeObjectURL(activeTrackBlobUrl);
      activeTrackBlobUrl = URL.createObjectURL(blob);

      const existingTracks = video.querySelectorAll("track");
      existingTracks.forEach(t => t.remove());

      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = `Local: ${file.name}`;
      track.srclang = "custom";
      track.src = activeTrackBlobUrl;
      track.default = true;

      video.appendChild(track);

      if (subSelect) {
        const opt = document.createElement("option");
        opt.value = currentSubtitles.length;
        opt.textContent = `Local: ${file.name}`;
        opt.selected = true;
        subSelect.appendChild(opt);
      }
    } catch (err) {
      alert("Failed to load local subtitle file.");
    }
  });

  if (btnDelete) {
    btnDelete.addEventListener("click", async () => {
      if (!torrentId) return;
      if (confirm("Are you sure you want to delete this torrent from TorBox?")) {
        const resp = await browser.runtime.sendMessage({ type: "DELETE_TORRENT", torrentId });
        if (resp && resp.success) {
          alert("Torrent deleted from TorBox.");
          window.close();
        } else {
          alert("Failed to delete torrent.");
        }
      }
    });
  }
});
