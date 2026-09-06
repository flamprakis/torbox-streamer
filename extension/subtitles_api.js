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
  dut: "Dutch",
  nl: "Dutch",
  pol: "Polish",
  pl: "Polish",
  tur: "Turkish",
  tr: "Turkish",
  ara: "Arabic",
  ar: "Arabic",
  zho: "Chinese",
  chi: "Chinese",
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
  cze: "Czech",
  cs: "Czech",
  ron: "Romanian",
  rum: "Romanian",
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

/** Match ISO language aliases and the language names used in bundled filenames. */
function filterSubtitlesByLanguage(subtitles, preferredLangs = ["en"]) {
  if (!Array.isArray(subtitles) || subtitles.length === 0) return [];
  if (!preferredLangs || preferredLangs.length === 0) return [];

  const normalize = (code) => String(code || "").trim().toLowerCase().split(/[-_]/)[0];
  const targetLangs = preferredLangs.map(normalize);
  if (targetLangs.includes("all")) return subtitles;
  const targetNames = new Set(targetLangs.map(code => LANG_MAP[code] || code));

  const matched = subtitles.filter(sub => {
    const lang = normalize(sub.lang || "");
    const cleanLabel = (sub.label || "").replace(/^torrent:\s*/i, "").toLowerCase();
    // A declared ISO language wins over release names (e.g. English.Patient).
    if (/^[a-z]{2,3}$/.test(lang) && !["und", "unk"].includes(lang)) {
      return targetNames.has(LANG_MAP[lang] || lang);
    }
    const tokens = cleanLabel.split(/[^a-z]+/).filter(Boolean);
    return tokens.some(token => targetNames.has(LANG_MAP[token] || token)) ||
      [...targetNames].some(name => tokens.includes(name.toLowerCase()));
  });

  return matched;
}

/**
 * Fetches external subtitles from OpenSubtitles via Stremio v3 provider.
 * @param {string} imdbId 
 * @param {number|string} [season] 
 * @param {number|string} [episode] 
 * @param {string} [mediaType] 
 * @param {string[]} [preferredLangs]
 * @returns {Promise<Array<{id: string, lang: string, label: string, url: string, format: string}>>}
 */
async function fetchSubtitles(imdbId, season, episode, mediaType = "movie", preferredLangs = ["en"], { reportErrors = false } = {}) {
  if (!imdbId) return [];

  let endpoint = `https://opensubtitles-v3.strem.io/subtitles/movie/${encodeURIComponent(imdbId)}.json`;
  if (mediaType === "series" && season != null && episode != null) {
    endpoint = `https://opensubtitles-v3.strem.io/subtitles/series/${encodeURIComponent(imdbId)}:${encodeURIComponent(season)}:${encodeURIComponent(episode)}.json`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(endpoint, { signal: controller.signal });
    if (!resp.ok) throw new Error(`OpenSubtitles returned HTTP ${resp.status}.`);

    const json = await resp.json();
    if (!Array.isArray(json.subtitles)) throw new Error("OpenSubtitles returned an invalid subtitle list.");

    const subs = json.subtitles.filter(sub => sub && typeof sub.url === "string" && /^https?:\/\//i.test(sub.url)).map((sub, idx) => {
      const langCode = typeof sub.lang === "string" ? sub.lang : "und";
      const label = getLanguageLabel(langCode);
      const release = sub.subtitleFileName || sub.movieReleaseName || sub.release || "";
      const fps = Number(sub.fpsMilli) / 1000;
      return {
        id: sub.id || `sub-${idx}`,
        lang: langCode,
        label: `OpenSubtitles: ${label} (${langCode})${release ? ` — ${release}` : ""}${Number.isFinite(fps) && fps > 0 ? ` · ${fps} fps` : ""} [${sub.id || idx + 1}]`,
        url: sub.url,
        format: /\.vtt(?:[?#]|$)/i.test(sub.url) ? "vtt" : "srt"
      };
    });

    return uniqueSubtitleChoices(filterSubtitlesByLanguage(subs, preferredLangs));
  } catch (err) {
    if (reportErrors) throw new Error(err.name === "AbortError" ? "OpenSubtitles timed out. Try Reload Subtitles." : err.message);
    console.warn("[TorBox Streamer] Subtitle fetch error:", err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Keep every distinct file, even for the same language. Identity is the URL,
// never the language; duplicate display labels receive an unambiguous suffix.
function uniqueSubtitleChoices(subtitles) {
  const seen = new Set();
  const choices = subtitles.filter(sub => {
    const identity = sub?.textTrack || (typeof sub?.url === "string" ? sub.url : null);
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  const labels = new Map();
  for (const sub of choices) labels.set(sub.label, (labels.get(sub.label) || 0) + 1);
  return choices.map((sub, index) => ({ ...sub,
    label: labels.get(sub.label) > 1 ? `${sub.label} [track ${index + 1}]` : sub.label,
  }));
}

/**
 * Converts Advanced SubStation Alpha (.ass / .ssa) text into WEBVTT format.
 * @param {string} assText 
 * @returns {string} WEBVTT formatted text
 */
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
  const match = ts.match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!match) return null;

  const h = String(parseInt(match[1])).padStart(2, "0");
  const m = match[2];
  const s = match[3];
  const ms = match[4] + "0";

  return `${h}:${m}:${s}.${ms}`;
}

// .sub may contain binary VobSub or MicroDVD cues; neither is WebVTT-compatible.
const BUNDLED_SUB_EXTS = new Set([".srt", ".vtt", ".ass", ".ssa"]);

/**
 * Extracts bundled subtitle files (.srt, .vtt, .ass) from torrent files list.
 * @param {string} apiKey 
 * @param {number|string} torrentId 
 * @param {Array<object>} files 
 * @returns {Array<object>} List of subtitle track objects with TorBox download URLs
 */
function extractBundledSubtitles(apiKey, torrentId, files, preferredLangs = ["en"]) {
  if (!files || !Array.isArray(files) || !apiKey || torrentId == null || String(torrentId).trim() === "") return [];
  const subs = [];

  for (const f of files) {
    const name = (f.name || f.short_name || f.path || f.s3_path || f.filename || "").replace(/\\/g, "/");
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";

    if (BUNDLED_SUB_EXTS.has(ext)) {
      const fileId = f.id != null ? f.id : (f.file_id != null ? f.file_id : null);
      if (fileId == null || !Number.isInteger(Number(fileId)) || Number(fileId) < 0) continue;

      const url = `${TORBOX_API}/torrents/requestdl?token=${encodeURIComponent(apiKey)}&torrent_id=${encodeURIComponent(torrentId)}&file_id=${fileId}&redirect=true`;
      
      let cleanLabel = name.replace(/^[\s/]+/, "");
      const slashIdx = cleanLabel.lastIndexOf("/");
      if (slashIdx >= 0) {
        const parentFolder = cleanLabel.slice(0, slashIdx).split("/").pop();
        const fileName = cleanLabel.slice(slashIdx + 1);
        cleanLabel = (parentFolder.toLowerCase() === "subs" || parentFolder.toLowerCase() === "subtitles")
          ? fileName
          : `${parentFolder}/${fileName}`;
      }

      subs.push({
        id: `torrent-sub-${fileId}`,
        label: `Torrent: ${cleanLabel}`,
        lang: cleanLabel.toLowerCase(),
        url,
        format: ext.slice(1)
      });
    }
  }

  return filterSubtitlesByLanguage(subs, preferredLangs);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseSrtToVtt,
    parseAssToVtt,
    extractBundledSubtitles,
    createVttBlobUrl,
    getLanguageLabel,
    fetchSubtitles,
    filterSubtitlesByLanguage,
    LANG_MAP
  };
}
