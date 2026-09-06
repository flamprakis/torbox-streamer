var browser = typeof globalThis.browser !== "undefined" ? globalThis.browser : globalThis.chrome;

function srtToVtt(srtText, delaySec = 0) {
  if (!srtText) return "WEBVTT\n\n";
  const clean = srtText.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (clean.trim().startsWith("WEBVTT")) {
    return delaySec === 0 ? clean : clean.split("\n").map(line =>
      line.includes("-->") ? adjustVttTimeline(line, delaySec) : line
    ).join("\n");
  }

  let vtt = "WEBVTT\n\n";
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

    const textLines = lines.slice(timeIdx + 1);
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

  // Replace timestamps only, preserving WebVTT positioning and alignment settings.
  return timeLine.replace(/(?:(\d+):)?\d{2}:\d{2}[.,]\d{1,3}/g,
    timestamp => shiftVttTime(timestamp, delaySec));
}

function shiftVttTime(timeStr, delaySec) {
  const match = timeStr.match(/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (!match) return timeStr;

  const hours = parseInt(match[1] || "0");
  const mins = parseInt(match[2]);
  const secs = parseInt(match[3]);
  const ms = parseInt(match[4].padEnd(3, "0"));

  let totalMs = hours * 3600000 + mins * 60000 + secs * 1000 + ms;
  totalMs = Math.max(0, totalMs + Math.round(delaySec * 1000));

  const h = String(Math.floor(totalMs / 3600000)).padStart(2, "0");
  const m = String(Math.floor((totalMs % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((totalMs % 60000) / 1000)).padStart(2, "0");
  const millis = String(totalMs % 1000).padStart(3, "0");

  return `${h}:${m}:${s}.${millis}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
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
  const mediaTypeParam = params.get("media_type");
  const mediaType = ["movie", "series"].includes(mediaTypeParam) ? mediaTypeParam : null;
  const seasonParam = params.has("season") ? Number(params.get("season")) : NaN;
  const episodeParam = params.has("episode") ? Number(params.get("episode")) : NaN;
  const season = Number.isInteger(seasonParam) && seasonParam >= 0 ? seasonParam : null;
  const episode = Number.isInteger(episodeParam) && episodeParam > 0 ? episodeParam : null;

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
  const subStatus = document.getElementById("sub-status");
  const subtitleOverlay = document.getElementById("subtitle-overlay");

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
  let selectedTextTrack = null;
  let subtitleProviderError = "";
  let preferredSubtitleLanguages = ["en"];
  let subtitleListLoading = true;
  const nativeTrackIds = new WeakMap();
  const downloadedTrackChoices = new WeakMap();
  let nextNativeTrackId = 0;
  let subtitleListRequest = 0;
  let subtitleLoadRequest = 0;
  let userSelectedSubtitle = false;
  let localSubtitleId = 0;
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
    } else if (e.code === "KeyP") {
      e.preventDefault();
      btnPip?.click();
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

  function setSubtitleStatus(message) {
    if (subStatus) subStatus.textContent = [message, subtitleProviderError].filter(Boolean).join(" — ");
  }

  function clearSubtitleTrack() {
    selectedTextTrack = null;
    subtitleOverlay?.replaceChildren();
    if (activeTrackBlobUrl) {
      URL.revokeObjectURL(activeTrackBlobUrl);
      activeTrackBlobUrl = null;
    }
    for (const track of video.textTracks) {
      if (["subtitles", "captions"].includes(track.kind)) track.mode = "disabled";
    }
    video.querySelectorAll("track[data-torbox-subtitle]").forEach(track => track.remove());
  }

  function nativeSubtitleChoices() {
    const managed = new Set([...video.querySelectorAll("track[data-torbox-subtitle]")].map(el => el.track));
    const choices = [...video.textTracks].filter(track =>
      ["subtitles", "captions"].includes(track.kind) && !managed.has(track)).map(track => {
      if (!nativeTrackIds.has(track)) {
        nativeTrackIds.set(track, ++nextNativeTrackId);
        track.addEventListener("cuechange", renderSubtitleCues);
      }
      const id = nativeTrackIds.get(track);
      return { id: `embedded-${id}`, textTrack: track, lang: track.language || "und",
        label: `Embedded: ${track.label || getLanguageLabel(track.language)} (${track.language || "und"}) [track ${id}]` };
    });
    return filterSubtitlesByLanguage(choices, preferredSubtitleLanguages);
  }

  function populateSubtitleSelect(selected) {
    subSelect.replaceChildren(new Option("Off", ""));
    currentSubtitles.forEach((sub, index) => subSelect.add(new Option(sub.label, String(index))));
    const index = currentSubtitles.findIndex(sub => selected &&
      (selected.textTrack ? sub.textTrack === selected.textTrack : sub.url === selected.url));
    subSelect.value = index >= 0 ? String(index) : "";
    return index;
  }

  function refreshNativeSubtitles() {
    if (subtitleListLoading) return;
    const previous = subSelect.value === "" ? null : currentSubtitles[Number(subSelect.value)];
    currentSubtitles = uniqueSubtitleChoices([...currentSubtitles.filter(sub => !sub.textTrack), ...nativeSubtitleChoices()]);
    const index = populateSubtitleSelect(previous);
    if (previous && index < 0) void loadSelectedSubtitle(-1);
    else if (!previous && !userSelectedSubtitle && currentSubtitles.length) {
      subSelect.value = "0";
      void loadSelectedSubtitle(0, currentDelay);
    }
    syncSubtitleRendering();
  }

  function renderSubtitleCues() {
    if (!subtitleOverlay) return;
    subtitleOverlay.replaceChildren();
    // Native controls own native caption rendering. Custom controls use a DOM
    // layer because Chromium can suppress native captions without controls.
    if (video.controls || document.pictureInPictureElement === video || !selectedTextTrack) return;
    for (const cue of selectedTextTrack.activeCues || []) {
      const line = document.createElement("div");
      const caption = document.createElement("span");
      // getCueAsHTML parses WebVTT markup without interpreting arbitrary HTML.
      caption.textContent = cue.getCueAsHTML ? cue.getCueAsHTML().textContent : cue.text;
      line.appendChild(caption);
      subtitleOverlay.appendChild(line);
    }
  }

  function syncSubtitleRendering() {
    const native = video.controls || document.pictureInPictureElement === video;
    for (const track of video.textTracks) {
      if (!["subtitles", "captions"].includes(track.kind)) continue;
      const mode = track === selectedTextTrack ? (native ? "showing" : "hidden") : "disabled";
      if (track.mode !== mode) track.mode = mode;
    }
    renderSubtitleCues();
    for (const button of [btnSubMinus, btnSubPlus]) {
      if (button) {
        button.disabled = !!selectedTextTrack && nativeTrackIds.has(selectedTextTrack);
        button.title = button.disabled ? "Timing adjustment is available for external subtitle files only" : "Adjust subtitle timing";
      }
    }
  }

  const controlsObserver = new MutationObserver(syncSubtitleRendering);
  controlsObserver.observe(video, { attributes: true, attributeFilter: ["controls"] });
  const controlsSizeObserver = new ResizeObserver(() => {
    subtitleOverlay?.style.setProperty("--subtitle-controls-height", `${bottomOverlay.offsetHeight}px`);
  });
  if (bottomOverlay) controlsSizeObserver.observe(bottomOverlay);
  video.addEventListener("enterpictureinpicture", syncSubtitleRendering);
  video.addEventListener("leavepictureinpicture", syncSubtitleRendering);
  video.addEventListener("timeupdate", renderSubtitleCues);
  video.addEventListener("seeked", renderSubtitleCues);
  video.textTracks.addEventListener("addtrack", refreshNativeSubtitles);
  video.textTracks.addEventListener("removetrack", refreshNativeSubtitles);
  video.textTracks.addEventListener("change", () => {
    if (video.controls || document.pictureInPictureElement === video) {
      const showing = [...video.textTracks].find(track =>
        ["subtitles", "captions"].includes(track.kind) && track.mode === "showing" && track !== selectedTextTrack);
      if (showing) {
        const downloaded = downloadedTrackChoices.get(showing);
        const index = currentSubtitles.findIndex(sub => sub.textTrack === showing ||
          (downloaded && sub.url === downloaded.url));
        if (index >= 0) {
          userSelectedSubtitle = true;
          subSelect.value = String(index);
          void loadSelectedSubtitle(index, currentDelay);
          return;
        }
      }
      if (!showing && selectedTextTrack?.mode === "disabled") {
        selectedTextTrack = null;
        subSelect.value = "";
        userSelectedSubtitle = true;
        setSubtitleStatus("Subtitles off");
      }
    }
    syncSubtitleRendering();
  });

  async function initSubtitles(reload = false) {
    subtitleListLoading = true;
    subtitleProviderError = "";
    const request = ++subtitleListRequest;
    ++subtitleLoadRequest;
    const previous = subSelect && subSelect.value !== ""
      ? currentSubtitles[Number(subSelect.value)] : null;
    clearSubtitleTrack();
    currentSubtitles = [];
    if (reload) rawSubTexts = {};
    if (subSelect) {
      subSelect.innerHTML = '<option value="">Off</option>';
      subSelect.disabled = true;
    }
    if (btnReloadSubs) btnReloadSubs.disabled = true;
    setSubtitleStatus("Loading subtitles…");

    try {
      const stored = await storage.get(["torbox_api_key", "subtitle_languages", "player_bundled_subtitles", "last_stream_metadata"]);
      const apiKey = stored.torbox_api_key;
      // Storage is shared across player tabs. Only use metadata for this torrent.
      const savedMeta = stored.last_stream_metadata || {};
      const sameTorrent = torrentId != null && String(torrentId) !== "" && String(savedMeta.torrent_id) === String(torrentId);
      const lastMeta = sameTorrent ? savedMeta : {};
      const effectiveImdbId = imdbId || lastMeta.imdb_id || "";
      const effectiveMediaType = mediaType || lastMeta.media_type || "movie";
      const effectiveSeason = season ?? lastMeta.season ?? 1;
      const effectiveEpisode = episode ?? lastMeta.episode ?? 1;
      const prefLangs = parsePreferredLanguages(stored.subtitle_languages || "en, browser", navigator.language);
      preferredSubtitleLanguages = prefLangs;
      let bundled = sameTorrent && Array.isArray(stored.player_bundled_subtitles)
        ? filterSubtitlesByLanguage(stored.player_bundled_subtitles, prefLangs) : [];

      const getBundled = async () => {
        if ((reload || bundled.length === 0) && torrentId != null && String(torrentId) !== "" && apiKey) {
          try {
            const torrents = await torboxGetTorrentList(apiKey, torrentId);
            const torrent = torrents.find(item => String(item.id) === String(torrentId));
            bundled = torrent ? extractBundledSubtitles(apiKey, torrentId, torrent.files, prefLangs) : [];
          } catch (err) {
            // Previously fetched subtitles remain usable if the torrent API is down.
            console.warn("[TorBox Streamer] Bundled subtitle lookup failed:", err);
          }
        }
        return bundled;
      };
      const getExternal = async () => {
        if (!effectiveImdbId) return [];
        try {
          const response = await browser.runtime.sendMessage({ type: "FETCH_SUBTITLES", imdbId: effectiveImdbId,
            season: effectiveSeason, episode: effectiveEpisode, mediaType: effectiveMediaType, languages: prefLangs });
          if (!response?.success) throw new Error(response?.error || "OpenSubtitles did not respond. Try Reload Subtitles.");
          return response.subtitles;
        } catch (error) {
          if (request === subtitleListRequest) subtitleProviderError = `OpenSubtitles: ${error.message}`;
          return [];
        }
      };
      const [bundledSubs, external] = await Promise.all([
        getBundled(),
        getExternal(),
      ]);
      if (request !== subtitleListRequest) return;

      currentSubtitles = uniqueSubtitleChoices([...bundledSubs, ...external, ...nativeSubtitleChoices()]);
      if (subSelect) {
        const previousIndex = populateSubtitleSelect(previous);
        subSelect.disabled = false;
        const nextIndex = userSelectedSubtitle ? previousIndex : (currentSubtitles.length ? 0 : -1);
        subSelect.value = nextIndex >= 0 ? String(nextIndex) : "";
        void loadSelectedSubtitle(nextIndex, currentDelay);
      }
    } catch (error) {
      if (request === subtitleListRequest) setSubtitleStatus("Subtitles could not be loaded. Try Reload Subtitles.");
      console.warn("[TorBox Streamer] Subtitle initialization failed:", error);
    } finally {
      if (request === subtitleListRequest) {
        subtitleListLoading = false;
        if (subSelect) subSelect.disabled = false;
        if (btnReloadSubs) btnReloadSubs.disabled = false;
      }
    }
  }

  if (btnReloadSubs) {
    btnReloadSubs.addEventListener("click", () => initSubtitles(true));
  }

  async function loadSelectedSubtitle(index, delay = 0) {
    const request = ++subtitleLoadRequest;
    clearSubtitleTrack();
    syncSubtitleRendering();

    if (index === "" || index < 0 || !currentSubtitles[index]) {
      setSubtitleStatus(currentSubtitles.length ? "Subtitles off" : "No subtitles found. Try Reload Subtitles or drop an SRT/VTT file.");
      return;
    }

    const sub = currentSubtitles[index];
    if (sub.textTrack) {
      selectedTextTrack = sub.textTrack;
      syncSubtitleRendering();
      setSubtitleStatus(sub.label);
      return;
    }
    setSubtitleStatus(`Loading ${sub.label}…`);
    try {
      if (!Object.hasOwn(rawSubTexts, sub.url)) {
        let response;
        try {
          response = await browser.runtime.sendMessage({ type: "FETCH_SUBTITLE_TEXT", url: sub.url });
        } catch (error) {
          // Direct fetch also supports player pages without a connected background.
        }
        let text;
        if (response?.success && typeof response.text === "string") {
          text = response.text;
        } else {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10000);
          try {
            const resp = await fetch(sub.url, { signal: controller.signal });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            text = await resp.text();
          } finally {
            clearTimeout(timer);
          }
        }
        if (request !== subtitleLoadRequest) return;
        rawSubTexts[sub.url] = text;
      }

      const text = rawSubTexts[sub.url];
      const converted = sub.format === "ass" || sub.format === "ssa" ? parseAssToVtt(text) : text;
      const vttContent = srtToVtt(converted, delay);
      if (!vttContent.includes("-->")) throw new Error("No supported subtitle cues found.");
      if (request !== subtitleLoadRequest) return;

      const blob = new Blob([vttContent], { type: "text/vtt;charset=utf-8" });
      activeTrackBlobUrl = URL.createObjectURL(blob);
      const track = document.createElement("track");
      track.dataset.torboxSubtitle = "true";
      track.kind = "subtitles";
      track.label = sub.label;
      track.srclang = /^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(sub.lang) ? sub.lang : "und";
      track.src = activeTrackBlobUrl;
      track.addEventListener("cuechange", renderSubtitleCues);
      track.addEventListener("load", () => {
        if (request === subtitleLoadRequest) syncSubtitleRendering();
      });
      track.addEventListener("error", () => {
        if (request === subtitleLoadRequest) setSubtitleStatus("Subtitle could not be decoded. Choose another track.");
      });
      selectedTextTrack = track.track;
      downloadedTrackChoices.set(selectedTextTrack, sub);
      video.appendChild(track);
      syncSubtitleRendering();
      setSubtitleStatus(`${sub.label}${delay ? ` (${delay > 0 ? "+" : ""}${delay.toFixed(1)}s)` : ""}`);
    } catch (error) {
      if (request === subtitleLoadRequest) setSubtitleStatus("Subtitle could not be loaded. Choose another subtitle or try Reload Subtitles.");
    }
  }

  if (subSelect) {
    subSelect.addEventListener("change", (e) => {
      userSelectedSubtitle = true;
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
    btnCopy.addEventListener("click", async () => {
      if (streamUrl) {
        try {
          await navigator.clipboard.writeText(streamUrl);
          btnCopy.textContent = "Copied!";
        } catch (error) {
          btnCopy.textContent = "Copy failed";
        }
        setTimeout(() => btnCopy.textContent = "📋 Copy", 2000);
      }
    });
  }

  const MPV_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" style="vertical-align:text-bottom;margin-right:3px;"><circle cx="12" cy="12" r="11" fill="#8d004e"/><circle cx="12" cy="12" r="8.5" stroke="#ffffff" stroke-width="1.5" fill="none"/><path d="M10 8.5l5.5 3.5-5.5 3.5v-7z" fill="#ffffff"/></svg>MPV';
  const VLC_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" style="vertical-align:text-bottom;margin-right:3px;"><path d="M10.5 2h3l1.8 6.5h-6.6L10.5 2z" fill="#ff7f00"/><path d="M7.8 10.5h8.4l1.2 4H6.6l1.2-4z" fill="#ffffff"/><path d="M8.7 8.5h6.6l.9 3.5H7.8l.9-3.5z" fill="#ff7f00"/><path d="M5.4 16h13.2l1.4 4.5H4L5.4 16z" fill="#ff7f00"/><path d="M6.6 14.5h10.8l.9 3H5.7l.9-3z" fill="#ffffff"/><path d="M2 21h20v1.5H2V21z" fill="#d96600"/></svg>VLC';

  async function launchExternalPlayer(button, player, icon) {
    if (!streamUrl) return;
    button.textContent = "Launching...";
    button.disabled = true;
    try {
      const subUrls = currentSubtitles.filter(sub => /^https?:\/\//i.test(sub.url)).map(sub => sub.url);
      const resp = await browser.runtime.sendMessage({ type: "TRY_PLAYER", player, url: streamUrl, subtitles: subUrls });
      if (!resp?.success) throw new Error("Native player unavailable");
      button.textContent = "Launched!";
      video.pause();
    } catch (error) {
      button.textContent = `${player.toUpperCase()} missing`;
      alert(`Helper script not installed or ${player.toUpperCase()} binary missing. Run 'helpers/install.sh' (or 'install.bat' on Windows) to enable.`);
    } finally {
      button.disabled = false;
      setTimeout(() => button.innerHTML = icon, 3000);
    }
  }

  if (btnMpv) btnMpv.addEventListener("click", () => launchExternalPlayer(btnMpv, "mpv", MPV_SVG));
  if (btnVlc) {
    btnVlc.addEventListener("click", () => launchExternalPlayer(btnVlc, "vlc", VLC_SVG));
  }

  video.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  video.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;

    const file = e.dataTransfer.files[0];
    if (!/\.(srt|vtt)$/i.test(file.name)) {
      alert("Please drop a valid .srt or .vtt subtitle file.");
      return;
    }

    try {
      const text = await file.text();
      const sub = {
        id: `local-${++localSubtitleId}`,
        label: `Local: ${file.name}`,
        lang: "und",
        url: `local:${localSubtitleId}`,
        format: file.name.toLowerCase().endsWith(".vtt") ? "vtt" : "srt",
      };
      currentSubtitles.push(sub);
      rawSubTexts[sub.url] = text;
      userSelectedSubtitle = true;
      if (subSelect) {
        const opt = document.createElement("option");
        opt.value = currentSubtitles.length - 1;
        opt.textContent = sub.label;
        opt.selected = true;
        subSelect.appendChild(opt);
      }
      await loadSelectedSubtitle(currentSubtitles.length - 1, currentDelay);
    } catch (err) {
      alert("Failed to load local subtitle file.");
    }
  });

  if (btnDelete) {
    btnDelete.addEventListener("click", async () => {
      if (torrentId == null || String(torrentId) === "") return;
      if (confirm("Are you sure you want to delete this torrent from TorBox?")) {
        try {
          const resp = await browser.runtime.sendMessage({ type: "DELETE_TORRENT", torrentId });
          if (!resp?.success) throw new Error("Delete failed");
          alert("Torrent deleted from TorBox.");
          window.close();
        } catch (error) {
          alert("Failed to delete torrent.");
        }
      }
    });
  }

  // Bind controls before doing network I/O, including when providers are slow.
  void initSubtitles();
  window.addEventListener("pagehide", () => {
    controlsObserver.disconnect();
    controlsSizeObserver.disconnect();
    ++subtitleListRequest;
    ++subtitleLoadRequest;
    clearSubtitleTrack();
    clearTimeout(idleTimer);
  });
});
