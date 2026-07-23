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

  btnMpv.addEventListener("click", async () => {
    if (!streamUrl) return;
    btnMpv.textContent = "Launching MPV...";
    const resp = await browser.runtime.sendMessage({ type: "TRY_MPV", url: streamUrl });
    if (resp && resp.success) {
      btnMpv.textContent = "Launched in MPV!";
      video.pause();
    } else {
      btnMpv.textContent = "MPV helper not found";
      alert("MPV helper script not installed or mpv binary missing. Run 'python3 helpers/install.py' to enable.");
    }
    setTimeout(() => btnMpv.textContent = "Try in MPV", 3000);
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
