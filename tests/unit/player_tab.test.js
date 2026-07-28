import { describe, expect, it } from 'vitest';

function buildPlayerUrl(baseUrl, streamUrl, selectedFileName, torrentId, metadata = {}) {
  const params = new URLSearchParams();
  if (streamUrl) params.set("url", streamUrl);
  if (selectedFileName) params.set("title", selectedFileName);
  if (torrentId) params.set("torrent_id", torrentId);
  if (metadata.imdbId) params.set("imdb_id", metadata.imdbId);
  if (metadata.mediaType) params.set("media_type", metadata.mediaType);
  if (metadata.season) params.set("season", metadata.season);
  if (metadata.episode) params.set("episode", metadata.episode);

  return `${baseUrl}?${params.toString()}`;
}

function populateSubtitleDropdown(selectElement, subtitles) {
  if (!selectElement || !Array.isArray(subtitles)) return 0;
  
  // Clear options except first default 'Off'
  while (selectElement.children.length > 1) {
    selectElement.removeChild(selectElement.lastChild);
  }

  subtitles.forEach((sub, idx) => {
    const opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = `${sub.label} (${sub.lang.toUpperCase()})`;
    selectElement.appendChild(opt);
  });

  return selectElement.children.length - 1;
}

describe('Browser Player & Subtitle Integration Suite', () => {
  it('should include imdb_id, media_type, season, and episode in buildPlayerUrl', () => {
    const url = buildPlayerUrl(
      'chrome-extension://abc/player/player.html',
      'https://torbox.app/stream/video.mkv',
      'Breaking.Bad.S01E01.mkv',
      '12345',
      { imdbId: 'tt0903747', mediaType: 'series', season: 1, episode: 1 }
    );

    const parsed = new URL(url);
    expect(parsed.searchParams.get('url')).toBe('https://torbox.app/stream/video.mkv');
    expect(parsed.searchParams.get('title')).toBe('Breaking.Bad.S01E01.mkv');
    expect(parsed.searchParams.get('torrent_id')).toBe('12345');
    expect(parsed.searchParams.get('imdb_id')).toBe('tt0903747');
    expect(parsed.searchParams.get('media_type')).toBe('series');
    expect(parsed.searchParams.get('season')).toBe('1');
    expect(parsed.searchParams.get('episode')).toBe('1');
  });

  it('should populate subtitle select dropdown element with subtitle tracks', () => {
    // Mock DOM select element
    const selectEl = {
      children: [{ value: '', textContent: 'Off' }],
      appendChild(child) {
        this.children.push(child);
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
      },
      get lastChild() {
        return this.children[this.children.length - 1];
      }
    };

    // Helper document.createElement
    globalThis.document = {
      createElement: (tag) => ({ tag, value: '', textContent: '' })
    };

    const dummySubs = [
      { label: 'English', lang: 'en', url: 'https://subtitles.org/en.srt' },
      { label: 'Spanish', lang: 'es', url: 'https://subtitles.org/es.srt' },
    ];

    const count = populateSubtitleDropdown(selectEl, dummySubs);
    expect(count).toBe(2);
    expect(selectEl.children.length).toBe(3);
    expect(selectEl.children[1].textContent).toBe('English (EN)');
    expect(selectEl.children[2].textContent).toBe('Spanish (ES)');
  });
});
