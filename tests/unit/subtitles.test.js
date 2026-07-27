import { describe, expect, it } from 'vitest';

function parsePreferredLanguages(prefString, userBrowserLang = "en") {
  const defaultLangs = ["en"];
  if (userBrowserLang) {
    const shortLang = userBrowserLang.slice(0, 2).toLowerCase();
    if (!defaultLangs.includes(shortLang)) defaultLangs.push(shortLang);
  }

  if (!prefString || typeof prefString !== "string") return defaultLangs;

  const result = new Set();
  const tokens = prefString.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);

  for (const token of tokens) {
    if (token === "browser") {
      if (userBrowserLang) result.add(userBrowserLang.slice(0, 2).toLowerCase());
    } else {
      result.add(token.slice(0, 3));
    }
  }

  result.add("en");
  return Array.from(result);
}

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

describe('Subtitle Unit Tests', () => {
  describe('parsePreferredLanguages', () => {
    it('should default to English and user browser language', () => {
      const langs = parsePreferredLanguages("en, browser", "el-GR");
      expect(langs).toContain("en");
      expect(langs).toContain("el");
    });

    it('should parse custom language codes and ensure English is present', () => {
      const langs = parsePreferredLanguages("es, fr, de", "en");
      expect(langs).toEqual(expect.arrayContaining(["es", "fr", "de", "en"]));
    });
  });

  describe('srtToVtt', () => {
    it('should convert standard SRT block into WEBVTT format', () => {
      const srt = "1\n00:00:01,500 --> 00:00:04,000\nHello world!";
      const vtt = srtToVtt(srt);
      expect(vtt).toContain("WEBVTT");
      expect(vtt).toContain("00:00:01.500 --> 00:00:04.000");
      expect(vtt).toContain("Hello world!");
    });

    it('should apply subtitle delay shift correctly', () => {
      const srt = "1\n00:00:01,500 --> 00:00:04,000\nDelayed text";
      const vtt = srtToVtt(srt, 2.0); // +2.0s delay
      expect(vtt).toContain("00:00:03.500 --> 00:00:06.000");
    });
  });
});
