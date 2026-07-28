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
  if (!srtText) return "WEBVTT\n\n";
  let vtt = "WEBVTT\n\n";
  const cleanText = srtText.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = cleanText.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    let timeLineIdx = 0;
    if (/^\d+$/.test(lines[0].trim())) {
      timeLineIdx = 1;
    }
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

function filterSubtitlesByLanguage(subtitles, preferredLangs = ["en"]) {
  if (!Array.isArray(subtitles) || subtitles.length === 0) return [];
  if (!preferredLangs || preferredLangs.length === 0) return subtitles;

  const normalize = (code) => (code || "").toLowerCase().slice(0, 3);
  const targetLangs = preferredLangs.map(normalize);

  const matched = subtitles.filter(sub => {
    const lang = normalize(sub.lang || "");
    const cleanLabel = (sub.label || "").replace(/^torrent:\s*/i, "").toLowerCase();
    const url = (sub.url || "").toLowerCase();

    return targetLangs.some(target => 
      lang === target ||
      cleanLabel.includes(`.${target}.`) ||
      cleanLabel.includes(`(${target})`) ||
      cleanLabel.includes(`_${target}_`) ||
      url.includes(`.${target}.`) ||
      (target === "en" && (cleanLabel.includes("english") || lang === "eng")) ||
      (target === "el" && (cleanLabel.includes("greek") || lang === "gre" || lang === "ell")) ||
      (target === "es" && (cleanLabel.includes("spanish") || lang === "spa")) ||
      (target === "fr" && (cleanLabel.includes("french") || lang === "fre" || lang === "fra")) ||
      (target === "de" && (cleanLabel.includes("german") || lang === "ger" || lang === "deu"))
    );
  });

  return matched.length > 0 ? matched : subtitles.slice(0, 5);
}

describe('Subtitle Unit Tests', () => {
  describe('parsePreferredLanguages & filterSubtitlesByLanguage', () => {
    it('should default to English and user browser language', () => {
      const langs = parsePreferredLanguages("en, browser", "el-GR");
      expect(langs).toContain("en");
      expect(langs).toContain("el");
    });

    it('should parse custom language codes and ensure English is present', () => {
      const langs = parsePreferredLanguages("es, fr, de", "en");
      expect(langs).toEqual(expect.arrayContaining(["es", "fr", "de", "en"]));
    });

    it('should filter subtitles list according to preferred languages', () => {
      const allSubs = [
        { lang: "eng", label: "Torrent: English.eng.srt", url: "http://test/eng.srt" },
        { lang: "gre", label: "Torrent: Greek.ell.srt", url: "http://test/ell.srt" },
        { lang: "spa", label: "Torrent: Spanish.spa.srt", url: "http://test/spa.srt" },
        { lang: "fre", label: "Torrent: French.fra.srt", url: "http://test/fra.srt" }
      ];

      const filteredEnEl = filterSubtitlesByLanguage(allSubs, ["en", "el"]);
      expect(filteredEnEl.length).toBe(2);
      expect(filteredEnEl.map(s => s.lang)).toEqual(["eng", "gre"]);
    });

    it('should fallback to top 5 subtitles if no preferred language matches', () => {
      const allSubs = Array.from({ length: 10 }, (_, i) => ({
        lang: "jpn", label: `Japanese ${i}.srt`, url: `http://test/jp${i}.srt`
      }));

      const filtered = filterSubtitlesByLanguage(allSubs, ["en"]);
      expect(filtered.length).toBe(5);
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

    it('should strip BOM markers and parse multi-newline blocks', () => {
      const srt = "\uFEFF1\r\n00:00:01,500 --> 00:00:04,000\r\nBOM line\r\n\r\n2\r\n00:00:05,000 --> 00:00:08,000\r\nSecond line";
      const vtt = srtToVtt(srt);
      expect(vtt).toContain("WEBVTT");
      expect(vtt).toContain("BOM line");
      expect(vtt).toContain("Second line");
    });

    it('should apply subtitle delay shift correctly', () => {
      const srt = "1\n00:00:01,500 --> 00:00:04,000\nDelayed text";
      const vtt = srtToVtt(srt, 2.0); // +2.0s delay
      expect(vtt).toContain("00:00:03.500 --> 00:00:06.000");
    });
  });

  describe('fetchSubtitles Endpoint Construction', () => {
    it('should construct movie subtitle endpoint for movie media_type even if season/episode are 1', async () => {
      const globalFetch = globalThis.fetch;
      let requestedUrl = "";
      globalThis.fetch = async (url) => {
        requestedUrl = url;
        return {
          ok: true,
          json: async () => ({ subtitles: [{ id: "sub1", lang: "en", url: "https://sub.test/1.vtt" }] })
        };
      };

      // Import fetchSubtitles logic
      const fetchSubtitles = async (imdbId, season, episode, mediaType) => {
        if (!imdbId) return [];
        let endpoint = `https://opensubtitles-v3.strem.io/subtitles/movie/${imdbId}.json`;
        if (mediaType === "series" && season && episode) {
          endpoint = `https://opensubtitles-v3.strem.io/subtitles/series/${imdbId}:${season}:${episode}.json`;
        }
        const resp = await globalThis.fetch(endpoint);
        const json = await resp.json();
        return json.subtitles;
      };

      const subsMovie = await fetchSubtitles("tt0111161", 1, 1, "movie");
      expect(requestedUrl).toBe("https://opensubtitles-v3.strem.io/subtitles/movie/tt0111161.json");
      expect(subsMovie.length).toBe(1);

      const subsSeries = await fetchSubtitles("tt0903747", 1, 2, "series");
      expect(requestedUrl).toBe("https://opensubtitles-v3.strem.io/subtitles/series/tt0903747:1:2.json");
      expect(subsSeries.length).toBe(1);

      globalThis.fetch = globalFetch;
    });
  });
});
