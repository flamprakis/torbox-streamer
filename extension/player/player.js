document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const streamUrl = params.get("url");
  const streamTitle = params.get("title") || "Stream";
  const torrentId = params.get("torrent_id");

  const video = document.getElementById("video-player");
  const titleEl = document.getElementById("title");
  const btnMpv = document.getElementById("btn-mpv");
  const btnCopy = document.getElementById("btn-copy");
  const btnDelete = document.getElementById("btn-delete");

  titleEl.textContent = streamTitle;

  if (streamUrl) {
    video.src = streamUrl;
  } else {
    titleEl.textContent = "Error: No stream URL provided.";
  }

  video.addEventListener("error", () => {
    titleEl.textContent = `${streamTitle} (Format/Codec not natively supported by browser. Try opening in MPV or VLC.)`;
  });

  btnCopy.addEventListener("click", () => {
    if (streamUrl) {
      navigator.clipboard.writeText(streamUrl);
      btnCopy.textContent = "Copied!";
      setTimeout(() => btnCopy.textContent = "Copy Stream URL", 2000);
    }
  });

  const btnVlc = document.getElementById("btn-vlc");

  btnMpv.addEventListener("click", async () => {
    if (!streamUrl) return;
    btnMpv.textContent = "Launching MPV...";
    const resp = await browser.runtime.sendMessage({ type: "TRY_PLAYER", player: "mpv", url: streamUrl });
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
      const resp = await browser.runtime.sendMessage({ type: "TRY_PLAYER", player: "vlc", url: streamUrl });
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
