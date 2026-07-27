var browser = typeof globalThis.browser !== "undefined" ? globalThis.browser : globalThis.chrome;

function srtToVtt(srtText, delaySec = 0) {
  let vtt = "WEBVTT\n\n";
  const normalized = srtText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split("\n\n");

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    let timeLineIdx = lines[0].includes("-->") ? 0 : 1;
    if (lines.length <= timeLineIdx || !lines[timeLineIdx].includes("-->")) continue;

    let timeLine = lines[timeLineIdx].replace(/,/g, ".");
    if (delaySec !== 0) {
      timeLine = adjustVttTimeline(timeLine, delaySec);
    }

    const cueText = lines.slice(timeLineIdx + 1).join("\n");
    vtt += `${timeLine}\n${cueText}\n\n`;
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
  const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
  if (!match) return timeStr;

  let totalMs =
    parseInt(match[1]) * 3600000 +
    parseInt(match[2]) * 60000 +
    parseInt(match[3]) * 1000 +
    parseInt(match[4]);

  totalMs = Math.max(0, totalMs + Math.round(delaySec * 1000));

  const h = String(Math.floor(totalMs / 3600000)).padStart(2, "0");
  const m = String(Math.floor((totalMs % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((totalMs % 60000) / 1000)).padStart(2, "0");
  const ms = String(totalMs % 1000).padStart(3, "0");

  return `${h}:${m}:${s}.${ms}`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const streamUrl = params.get("url");
  const streamTitle = params.get("title") || "Stream";
  const torrentId = params.get("torrent_id");
  const imdbId = params.get("imdb_id");
  const season = parseInt(params.get("season")) || 1;
  const episode = parseInt(params.get("episode")) || 1;
  const mediaType = params.get("media_type") || "movie";

  const video = document.getElementById("video-player");
  const titleEl = document.getElementById("title");
  const btnMpv = document.getElementById("btn-mpv");
  const btnVlc = document.getElementById("btn-vlc");
  const btnCopy = document.getElementById("btn-copy");
  const btnDelete = document.getElementById("btn-delete");

  const subSelect = document.getElementById("sub-select");
  const btnSubMinus = document.getElementById("btn-sub-minus");
  const btnSubPlus = document.getElementById("btn-sub-plus");

  let currentSubtitles = [];
  let rawSubTexts = {};
  let currentDelay = 0;
  let activeTrackBlobUrl = null;

  titleEl.textContent = streamTitle;

  if (streamUrl) {
    video.src = streamUrl;
  } else {
    titleEl.textContent = "Error: No stream URL provided.";
  }

  video.addEventListener("error", () => {
    titleEl.textContent = `${streamTitle} (Format/Codec not natively supported by browser. Try opening in MPV or VLC.)`;
  });

  // Load Subtitles
  if (imdbId) {
    try {
      const config = await browser.storage.local.get(["subtitle_languages"]);
      const prefLangsStr = config.subtitle_languages || "en, browser";

      const prefLangs = parsePreferredLanguages(prefLangsStr, navigator.language);
      currentSubtitles = await fetchSubtitles(imdbId, season, episode, mediaType, prefLangs);

      if (currentSubtitles.length > 0 && subSelect) {
        currentSubtitles.forEach((sub, idx) => {
          const opt = document.createElement("option");
          opt.value = idx;
          opt.textContent = `${sub.label} (${sub.lang.toUpperCase()})`;
          subSelect.appendChild(opt);
        });
      }
    } catch (e) {}
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
        const resp = await fetch(sub.url);
        rawSubTexts[sub.url] = await resp.text();
      } catch (e) {
        return;
      }
    }

    const srtText = rawSubTexts[sub.url];
    const vttContent = srtToVtt(srtText, delay);
    const blob = new Blob([vttContent], { type: "text/vtt" });
    activeTrackBlobUrl = URL.createObjectURL(blob);

    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = sub.label;
    track.srclang = sub.lang;
    track.src = activeTrackBlobUrl;
    track.default = true;

    video.appendChild(track);
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

  btnCopy.addEventListener("click", () => {
    if (streamUrl) {
      navigator.clipboard.writeText(streamUrl);
      btnCopy.textContent = "Copied!";
      setTimeout(() => btnCopy.textContent = "Copy Stream URL", 2000);
    }
  });

  btnMpv.addEventListener("click", async () => {
    if (!streamUrl) return;
    btnMpv.textContent = "Launching MPV...";
    const subUrls = currentSubtitles.map(s => s.url);
    const resp = await browser.runtime.sendMessage({ type: "TRY_PLAYER", player: "mpv", url: streamUrl, subtitles: subUrls });
    if (resp && resp.success) {
      btnMpv.textContent = "Launched in MPV!";
      video.pause();
    } else {
      btnMpv.textContent = "MPV helper not found";
      alert("Helper script not installed or MPV binary missing. Run 'helpers/install.sh' (or 'install.bat' on Windows) to enable.");
    }
    setTimeout(() => btnMpv.textContent = "Try in MPV", 3000);
  });

  if (btnVlc) {
    btnVlc.addEventListener("click", async () => {
      if (!streamUrl) return;
      btnVlc.textContent = "Launching VLC...";
      const subUrls = currentSubtitles.map(s => s.url);
      const resp = await browser.runtime.sendMessage({ type: "TRY_PLAYER", player: "vlc", url: streamUrl, subtitles: subUrls });
      if (resp && resp.success) {
        btnVlc.textContent = "Launched in VLC!";
        video.pause();
      } else {
        btnVlc.textContent = "VLC helper not found";
        alert("Helper script not installed or VLC binary missing. Run 'helpers/install.sh' (or 'install.bat' on Windows) to enable.");
      }
      setTimeout(() => btnVlc.textContent = "Try in VLC", 3000);
    });
  }

  // Drag and Drop Subtitle File Support (.srt / .vtt)
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
});
