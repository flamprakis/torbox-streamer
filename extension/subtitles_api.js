/**
 * Subtitles API & WebVTT Converter for TorBox Streamer
 */

const LANG_MAP = {
  eng: "English",
  en: "English",
  ell: "Greek",
  el: "Greek",
  gre: "Greek",
  spa: "Spanish",
  es: "Spanish",
  fre: "French",
  fra: "French",
  fr: "French",
  ger: "German",
  deu: "German",
  de: "German",
  ita: "Italian",
  it: "Italian",
  por: "Portuguese",
  pt: "Portuguese",
  pob: "Portuguese (BR)",
  rus: "Russian",
  ru: "Russian",
  nld: "Dutch",
  nl: "Dutch",
  pol: "Polish",
  pl: "Polish",
  tur: "Turkish",
  tr: "Turkish",
  ara: "Arabic",
  ar: "Arabic",
  zho: "Chinese",
  zh: "Chinese",
  jpn: "Japanese",
  ja: "Japanese",
  kor: "Korean",
  ko: "Korean",
  swe: "Swedish",
  sv: "Swedish",
  nor: "Norwegian",
  no: "Norwegian",
  fin: "Finnish",
  fi: "Finnish",
  dan: "Danish",
  da: "Danish",
  hun: "Hungarian",
  hu: "Hungarian",
  ces: "Czech",
  cs: "Czech",
  ron: "Romanian",
  ro: "Romanian",
  bul: "Bulgarian",
  bg: "Bulgarian",
  ukr: "Ukrainian",
  uk: "Ukrainian",
  heb: "Hebrew",
  he: "Hebrew"
};

/**
 * Converts SubRip (.srt) text content into standard WebVTT format.
 * @param {string} srtText 
 * @returns {string} WebVTT formatted text
 */
function parseSrtToVtt(srtText) {
  if (!srtText) return "WEBVTT\n\n";

  let vtt = "WEBVTT\n\n";
  const cleanText = srtText.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = cleanText.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    let timeIndex = 0;
    // Skip optional block index line if it's numeric
    if (/^\d+$/.test(lines[0].trim())) {
      timeIndex = 1;
    }

    if (!lines[timeIndex] || !lines[timeIndex].includes("-->")) continue;

    // Convert comma timestamp (00:00:00,000) to dot (00:00:00.000)
    const timeLine = lines[timeIndex].replace(/,/g, ".");
    const textLines = lines.slice(timeIndex + 1).join("\n");

    vtt += `${timeLine}\n${textLines}\n\n`;
  }

  return vtt;
}

/**
 * Creates an inline Blob URL for WebVTT text content.
 * @param {string} vttText 
 * @returns {string} Blob URL
 */
function createVttBlobUrl(vttText) {
  const blob = new Blob([vttText], { type: "text/vtt;charset=utf-8" });
  return URL.createObjectURL(blob);
}

/**
 * Resolves human-readable language label from language code.
 * @param {string} code 
 * @returns {string}
 */
function getLanguageLabel(code) {
  if (!code) return "Unknown Language";
  const cleanCode = code.toLowerCase().trim();
  return LANG_MAP[cleanCode] || code.toUpperCase();
}

/**
 * Fetches subtitles from OpenSubtitles / Stremio Subtitles API.
 * @param {string} imdbId 
 * @param {number|string} [season] 
 * @param {number|string} [episode] 
 * @returns {Promise<Array<{id: string, lang: string, label: string, url: string, format: string}>>}
 */
async function fetchSubtitles(imdbId, season, episode) {
  if (!imdbId) return [];

  let endpoint = `https://subtitles.strem.fun/subtitles/movie/${imdbId}.json`;
  if (season && episode) {
    endpoint = `https://subtitles.strem.fun/subtitles/series/${imdbId}:${season}:${episode}.json`;
  }

  try {
    const resp = await fetch(endpoint);
    if (!resp.ok) return [];

    const json = await resp.json();
    if (!json.subtitles || !Array.isArray(json.subtitles)) return [];

    return json.subtitles.map((sub, idx) => {
      const langCode = sub.lang || sub.id || "unk";
      const label = getLanguageLabel(langCode);
      return {
        id: sub.id || `sub-${idx}`,
        lang: langCode,
        label: `${label}${sub.lang ? ` (${sub.lang})` : ""}`,
        url: sub.url,
        format: sub.url && sub.url.endsWith(".vtt") ? "vtt" : "srt"
      };
    });
  } catch (err) {
    console.warn("[TorBox Streamer] Subtitle fetch error:", err);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseSrtToVtt,
    createVttBlobUrl,
    getLanguageLabel,
    fetchSubtitles,
    LANG_MAP
  };
}
