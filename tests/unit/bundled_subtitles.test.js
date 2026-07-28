import { describe, expect, it } from 'vitest';

const SUB_EXTS = new Set([".srt", ".vtt", ".ass", ".ssa", ".sub"]);

function getFileExt(filename) {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

function extractBundledSubtitles(apiKey, torrentId, files) {
  if (!files || !Array.isArray(files)) return [];
  const subs = [];

  for (const f of files) {
    const ext = getFileExt(f.name || "");
    if (SUB_EXTS.has(ext)) {
      const url = `https://api.torbox.app/v1/api/torrents/requestdl?token=${encodeURIComponent(apiKey)}&torrent_id=${torrentId}&file_id=${f.id}&redirect=true`;
      
      // Clean label
      let label = f.name.replace(/^[\s/]+/, "");
      if (label.toLowerCase().startsWith("subs/")) {
        label = label.slice(5);
      }
      
      subs.push({
        id: `torrent-sub-${f.id}`,
        label: `Torrent: ${label}`,
        lang: "torrent",
        url: url,
        format: ext.slice(1)
      });
    }
  }

  return subs;
}

function parseAssToVtt(assText) {
  if (!assText) return "WEBVTT\n\n";
  let vtt = "WEBVTT\n\n";

  const lines = assText.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("Dialogue:")) {
      const parts = line.split(",");
      if (parts.length >= 10) {
        const start = formatAssTimestamp(parts[1].trim());
        const end = formatAssTimestamp(parts[2].trim());
        const text = parts.slice(9).join(",").replace(/\\N/g, "\n").replace(/\{[^}]+\}/g, "").trim();

        if (start && end && text) {
          vtt += `${start} --> ${end}\n${text}\n\n`;
        }
      }
    }
  }

  return vtt;
}

function formatAssTimestamp(ts) {
  // Format H:MM:SS.cs (e.g. 0:01:30.50 -> 00:01:30.500)
  const match = ts.match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!match) return null;

  const h = String(parseInt(match[1])).padStart(2, "0");
  const m = match[2];
  const s = match[3];
  const ms = match[4] + "0";

  return `${h}:${m}:${s}.${ms}`;
}

describe('Bundled Torrent Subtitles Suite', () => {
  it('should extract subtitle files (.srt, .vtt, .ass) from torrent files list with TorBox download URLs', () => {
    const files = [
      { id: 1, name: "Movie.1080p.mkv", size: 2500000000 },
      { id: 2, name: "Subs/2_English.srt", size: 45000 },
      { id: 3, name: "Subs/3_Greek.ass", size: 55000 },
      { id: 4, name: "sample.mp4", size: 15000000 }
    ];

    const bundled = extractBundledSubtitles("test_key", 12345, files);

    expect(bundled.length).toBe(2);
    expect(bundled[0].label).toBe("Torrent: 2_English.srt");
    expect(bundled[0].url).toContain("torrent_id=12345");
    expect(bundled[0].url).toContain("file_id=2");
    expect(bundled[0].format).toBe("srt");

    expect(bundled[1].label).toBe("Torrent: 3_Greek.ass");
    expect(bundled[1].url).toContain("file_id=3");
    expect(bundled[1].format).toBe("ass");
  });

  it('should convert ASS subtitle format lines into WEBVTT format', () => {
    const ass = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:01:20.50,0:01:25.00,Default,,0,0,0,,{\\b1}Hello world!{\\b0}
Dialogue: 0,0:01:30.00,0:01:34.25,Default,,0,0,0,,Line 2\\NLine 3`;

    const vtt = parseAssToVtt(ass);

    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain("00:01:20.500 --> 00:01:25.000");
    expect(vtt).toContain("Hello world!");
    expect(vtt).toContain("00:01:30.000 --> 00:01:34.250");
    expect(vtt).toContain("Line 2\nLine 3");
  });
});
