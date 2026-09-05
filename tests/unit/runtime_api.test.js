import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Execute the shipped scripts in their manifest order. Only extension/browser
// boundaries are fake; parsing, filtering, dispatch and API calls are production.
function runtime({ stored = {}, fetch = vi.fn(), nativePort } = {}) {
  const listeners = {};
  const browser = {
    storage: { local: {
      get: vi.fn(async keys => Object.fromEntries(keys.filter(key => key in stored).map(key => [key, stored[key]]))),
      set: vi.fn(async values => Object.assign(stored, values)),
    } },
    runtime: {
      onMessage: { addListener: listener => { listeners.message = listener; } },
      connectNative: vi.fn(() => { if (!nativePort) throw new Error('Native host not installed'); return nativePort; }),
      getURL: path => `moz-extension://test/${path}`,
      openOptionsPage: vi.fn(),
    },
    tabs: {
      create: vi.fn(async () => ({ id: 100 })),
      query: vi.fn(async () => [{ id: 5 }]),
      sendMessage: vi.fn(async () => undefined),
      onRemoved: { addListener: listener => { listeners.remove = listener; } },
    },
    browserAction: { onClicked: { addListener: listener => { listeners.click = listener; } } },
  };
  const sandbox = vm.createContext({
    browser, fetch, URL, URLSearchParams, AbortController, Blob, Date, setTimeout, clearTimeout,
    console: { warn: vi.fn(), error: vi.fn(), log: vi.fn() }, navigator: { language: 'el-GR' },
    document: { addEventListener: vi.fn() },
  });
  for (const file of ['torbox_api.js', 'subtitles_api.js', 'background.js', 'player/player.js']) {
    const filename = path.resolve('extension', file);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  }
  return { api: sandbox, browser, fetch, stored, listeners,
    message: (msg, sender = { tab: { id: 5 } }) => listeners.message(msg, sender, vi.fn()) };
}

function json(data, status = 200) {
  return { ok: status >= 200 && status < 300, status,
    json: async () => data, text: async () => JSON.stringify(data) };
}

function port(response) {
  let message;
  let disconnect;
  return {
    onMessage: { addListener: callback => { message = callback; } },
    onDisconnect: { addListener: callback => { disconnect = callback; } },
    postMessage: vi.fn(() => { if (response !== undefined) queueMicrotask(() => message(response)); }),
    disconnect: vi.fn(() => disconnect?.()),
  };
}

const video = (id, name, size = 900_000_000) => ({ id, name, size });
const bundled = [video(11, 'Show.S02E01.mp4'), video(42, 'Show.S02E05.mp4'),
  video(55, 'Subs/English.srt', 1000), video(66, 'Subs/Greek.ass', 2000), video(77, 'Subs/Spanish.vtt', 3000)];

function playbackRuntime(config = {}, { files = bundled, nativePort, state = 'cached' } = {}) {
  return runtime({
    stored: { torbox_api_key: 'test & token', player_preference: 'browser', subtitle_languages: 'es', ...config },
    nativePort,
    fetch: vi.fn(async url => {
      if (url.includes('/createtorrent')) return json({ success: true, data: { torrent_id: 23 } });
      if (url.includes('/mylist')) return json({ success: true, data: [{ id: 23, download_state: state, files }] });
      if (url.includes('/subtitles/')) return json({ subtitles: [{ id: 'external', lang: 'spa', url: 'https://subs.test/es.srt' }] });
      throw new Error(`Unexpected request: ${url}`);
    }),
  });
}

afterEach(() => { vi.useRealTimers(); });

describe('shipped subtitle API', () => {
  it('extracts and filters actual torrent files without a prepopulated subtitle cache', () => {
    const { api } = runtime();
    const subtitles = api.extractBundledSubtitles('a & b', 23, bundled, ['el', 'en']);
    expect(subtitles.map(sub => sub.label)).toEqual(['Torrent: English.srt', 'Torrent: Greek.ass']);
    expect(new URL(subtitles[0].url).searchParams.get('token')).toBe('a & b');
    expect(new URL(subtitles[1].url).searchParams.get('file_id')).toBe('66');
  });

  it.each([['de', 'deu'], ['deu', 'ger'], ['el', 'ell'], ['el', 'gre'], ['fr', 'fra'], ['nl', 'nld'], ['ja', 'jpn'], ['ro', 'ron']])(
    'matches preferred %s with provider language %s', (preferred, language) => {
      const { api } = runtime();
      const tracks = [{ lang: 'en', label: 'English' }, { lang: language, label: language }];
      expect(api.filterSubtitlesByLanguage(tracks, [preferred])).toEqual([tracks[1]]);
    });

  it('accepts all languages, bounded fallback, empty input and Windows filename aliases', () => {
    const { api } = runtime();
    const tracks = Array.from({ length: 9 }, (_, index) => ({ lang: 'jpn', label: `Japanese ${index}` }));
    expect(api.filterSubtitlesByLanguage(tracks, ['all'])).toHaveLength(9);
    expect(api.filterSubtitlesByLanguage(tracks, ['en'])).toHaveLength(5);
    expect(api.filterSubtitlesByLanguage(null, ['en'])).toEqual([]);
    expect(api.filterSubtitlesByLanguage(tracks, [])).toHaveLength(9);
    const result = api.extractBundledSubtitles('key', 1, [
      { file_id: 2, path: 'Collection\\Subs\\film.deu.srt' },
      { id: 3, name: 'bad.sub' }, { id: 'bad', name: 'bad.srt' }, { name: 'missing-id.srt' },
    ], ['de']);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Torrent: film.deu.srt');
    expect(api.extractBundledSubtitles('', 1, bundled)).toEqual([]);
  });

  it('keeps zero torrent IDs usable for bundled subtitle links', () => {
    const { api } = runtime();
    const subtitles = api.extractBundledSubtitles('key', 0, [{ id: 2, name: 'English.srt' }], ['en']);
    expect(subtitles).toHaveLength(1);
    expect(new URL(subtitles[0].url).searchParams.get('torrent_id')).toBe('0');
  });

  it('parses configured/browser languages and deduplicates region codes', () => {
    const { api } = runtime();
    expect(api.parsePreferredLanguages('el, browser, pt-BR, el', 'el-GR')).toEqual(['el', 'pt', 'en']);
    expect(api.parsePreferredLanguages(undefined, 'de-DE')).toEqual(['en', 'de']);
    expect(api.getLanguageLabel(' FRA ')).toBe('French');
    expect(api.getLanguageLabel('xyz')).toBe('XYZ');
    expect(api.getLanguageLabel('')).toBe('Unknown Language');
  });

  it('uses the shipped provider, filters malformed entries and recognizes VTT query strings', async () => {
    const { api, fetch } = runtime({ fetch: vi.fn(async () => json({ subtitles: [
      null, { lang: 'en' }, { lang: 'en', url: 'javascript:alert(1)' },
      { id: 'en-1', lang: 'eng', url: 'https://subs.test/en.vtt?download=1' },
      { id: 'fr-1', lang: 'fra', url: 'https://subs.test/fr.srt' },
    ] })) });
    const tracks = await api.fetchSubtitles('tt123', 1, 2, 'movie', ['en']);
    expect(fetch.mock.calls[0][0]).toBe('https://opensubtitles-v3.strem.io/subtitles/movie/tt123.json');
    expect(tracks).toEqual([{ id: 'en-1', lang: 'eng', label: 'English (eng)', url: 'https://subs.test/en.vtt?download=1', format: 'vtt' }]);
    await api.fetchSubtitles('tt123', 0, 2, 'series', ['fr']);
    expect(fetch.mock.calls[1][0]).toBe('https://opensubtitles-v3.strem.io/subtitles/series/tt123:0:2.json');
  });

  it.each([json({}, 503), json({ subtitles: {} }), json({ subtitles: [] })])('handles unusable provider response %#', async response => {
    const { api } = runtime({ fetch: vi.fn(async () => response) });
    expect(await api.fetchSubtitles('tt1')).toEqual([]);
  });

  it('aborts an unresponsive provider and clears its timeout after normal responses', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Aborted')));
    }));
    const { api } = runtime({ fetch });
    const pending = api.fetchSubtitles('tt1');
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toEqual([]);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(await api.fetchSubtitles('')).toEqual([]);
  });

  it('converts real ASS and SRT text, preserving commas and multiline dialogue', () => {
    const { api } = runtime();
    const ass = '[Events]\nDialogue: 0,0:01:20.50,0:01:25.00,Default,,0,0,0,,{\\b1}Hello, world!{\\b0}\\NSecond line';
    expect(api.parseAssToVtt(ass)).toBe('WEBVTT\n\n00:01:20.500 --> 00:01:25.000\nHello, world!\nSecond line\n\n');
    expect(api.parseAssToVtt('Dialogue: invalid')).toBe('WEBVTT\n\n');
    expect(api.parseSrtToVtt('\uFEFF1\r\n00:00:01,000 --> 00:00:03,000\r\n42')).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n42\n\n');
  });
});

describe('production player subtitle conversion', () => {
  it('keeps numeric dialogue and applies delays to SRT, ASS-converted VTT and native VTT', () => {
    const { api } = runtime();
    expect(api.srtToVtt('1\n00:00:01,500 --> 00:00:03,000\n2026', .5))
      .toBe('WEBVTT\n\n00:00:02.000 --> 00:00:03.500\n2026\n\n');
    const vtt = 'WEBVTT\n\n00:00:01.500 --> 00:00:03.000 align:start line:90%\nCaption\n';
    expect(api.srtToVtt(vtt, -.5)).toContain('00:00:01.000 --> 00:00:02.500 align:start line:90%');
    expect(api.srtToVtt(vtt)).toBe(vtt);
    expect(api.srtToVtt(api.parseAssToVtt('Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,Caption'), 1))
      .toContain('00:00:02.500 --> 00:00:04.000');
  });

  it('clamps negative delays and supports short timestamps without losing milliseconds', () => {
    const { api } = runtime();
    expect(api.shiftVttTime('00:00:00.250', -1)).toBe('00:00:00.000');
    expect(api.shiftVttTime('00:01.5', .5)).toBe('00:00:02.000');
    expect(api.shiftVttTime('invalid', 1)).toBe('invalid');
    expect(api.adjustVttTimeline('not a cue', 1)).toBe('not a cue');
    expect(api.srtToVtt('')).toBe('WEBVTT\n\n');
    expect(api.srtToVtt('not subtitles')).toBe('WEBVTT\n\n');
    expect([NaN, Infinity, -1].map(api.formatTime)).toEqual(['0:00', '0:00', '0:00']);
    expect(api.formatTime(3661)).toBe('1:01:01');
    expect(api.formatTime(61)).toBe('1:01');
  });
});

describe('TorBox API boundaries and file selection', () => {
  it('batches and deduplicates cache hashes and distinguishes cached from absent results', async () => {
    const hashes = Array.from({ length: 23 }, (_, index) => `hash${index}`);
    const { api, fetch } = runtime({ fetch: vi.fn()
      .mockResolvedValueOnce(json({ success: true, data: { HASH0: { size: 5 }, hash1: null, hash2: false } }))
      .mockResolvedValueOnce(json({ success: true, data: ['HASH20'] })) });
    const result = await api.torboxCheckCached('key', [...hashes, 'HASH0']);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('hash').split(',')).toHaveLength(20);
    expect(result).toMatchObject({ hash0: true, hash1: false, hash2: false, hash20: true, hash22: false });
    expect(Object.keys(result)).toHaveLength(23);
  });

  it.each([401, 403])('surfaces invalid credentials (%s) instead of reporting uncached', async status => {
    const { api } = runtime({ fetch: vi.fn(async () => json({}, status)) });
    await expect(api.torboxCheckCached('bad', ['hash'])).rejects.toThrow('API key');
  });

  it.each([json({}, 500), json({ success: false, detail: 'Try later' })])('surfaces cache service failure %#', async response => {
    const { api } = runtime({ fetch: vi.fn(async () => response) });
    await expect(api.torboxCheckCached('key', ['hash'])).rejects.toThrow('cache check failed');
  });

  it('sends form-encoded creation and deletion requests with authentication', async () => {
    const { api, fetch } = runtime({ fetch: vi.fn()
      .mockResolvedValueOnce(json({ success: true, data: { torrent_id: 23 } }))
      .mockResolvedValueOnce(json({ success: true })) });
    expect(await api.torboxCreateTorrent('key', 'magnet:?xt=urn:btih:abc&dn=My Film')).toBe(23);
    expect(fetch.mock.calls[0][1].method).toBe('POST');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer key');
    expect(fetch.mock.calls[0][1].body.get('magnet')).toBe('magnet:?xt=urn:btih:abc&dn=My Film');
    expect(await api.torboxDeleteTorrent('key', 23)).toBe(true);
    expect(fetch.mock.calls[1][1].body.get('operation')).toBe('Delete');
    expect(fetch.mock.calls[1][1].body.get('torrent_id')).toBe('23');
  });

  it('propagates create/list API failures and reports failed deletion', async () => {
    const { api } = runtime({ fetch: vi.fn(async () => json({ success: false, error: 'AUTH', detail: 'Invalid API key' })) });
    await expect(api.torboxCreateTorrent('key', 'magnet')).rejects.toThrow('Invalid API key');
    await expect(api.torboxGetTorrentList('key', 1)).rejects.toThrow('Invalid API key');
    expect(await api.torboxDeleteTorrent('key', 1)).toBe(false);
  });

  it('normalizes real file ID/name variants, including zero IDs', async () => {
    const { api, fetch } = runtime({ fetch: vi.fn(async () => json({ success: true, data: {
      id: 0, download_state: 'uploading', files: [
        { id: '0', path: 'one.mp4', size: 1024 }, { file_id: '17', short_name: 'two.mkv' }, { filename: 'fallback.webm' },
      ],
    } })) });
    const [torrent] = await api.torboxGetTorrentList('key', 0);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('id')).toBe('0');
    expect(torrent.files.map(file => [file.id, file.name])).toEqual([[0, 'one.mp4'], [17, 'two.mkv'], [3, 'fallback.webm']]);
    expect(torrent.files[0].size_human).toBe('1.0 KB');
    expect(api.isReady(torrent.state)).toBe(true);
  });

  it('waits for the requested torrent and exposes progress without selecting a different ready torrent', async () => {
    vi.useFakeTimers();
    const { api, fetch } = runtime({ fetch: vi.fn()
      .mockResolvedValueOnce(json({ success: true, data: [{ id: 99, state: 'cached' }, { id: 23, state: 'downloading', progress: .5 }] }))
      .mockResolvedValueOnce(json({ success: true, data: [{ id: 23, state: 'cached' }] })) });
    const onProgress = vi.fn();
    const pending = api.torboxWaitForReady('key', 23, { timeout: 2, pollInterval: 1, onProgress });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).id).toBe(23);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ id: 23, progress: .5 }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops polling on terminal failures and respects timeout shorter than poll interval', async () => {
    vi.useFakeTimers();
    const { api } = runtime({ fetch: vi.fn(async () => json({ success: true, data: [] })) });
    const pending = api.torboxWaitForReady('key', 23, { timeout: .1, pollInterval: 3 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBeNull();
    api.fetch = vi.fn(async () => json({ success: true, data: [{ id: 23, state: 'failed' }] }));
    await expect(api.torboxWaitForReady('key', 23)).rejects.toThrow('download failed');
  });

  it.each([null, '', ' ', -1, 'abc', '1&file_id=3', 1.5, Infinity])('rejects an invalid download file ID %s', fileId => {
    expect(runtime().api.torboxGetDownloadUrl('key', 23, fileId)).toBeNull();
  });

  it('requires a key/torrent and encodes a valid zero file ID', () => {
    const { api } = runtime();
    expect(api.torboxGetDownloadUrl('', 23, 0)).toBeNull();
    expect(api.torboxGetDownloadUrl('key', '23&file_id=2', 0)).toBeNull();
    const url = new URL(api.torboxGetDownloadUrl('a&b', 23, 0));
    expect(Object.fromEntries(url.searchParams)).toEqual({ token: 'a&b', torrent_id: '23', file_id: '0', redirect: 'true' });
    expect(api.humanSize(1024 ** 3)).toBe('1.0 GB');
    expect(api.humanSize(0)).toBe('?');
  });

  it('treats provider file indexes as zero-based even when TorBox IDs overlap', () => {
    const { api } = runtime();
    const files = [video(1, 'Show.S01E01.mkv'), video(2, 'Show.S01E02.mkv'), video(90, 'Show.S01E03.mkv')];
    expect(api.autoPickFile(files, 1).id).toBe(2);
    expect(api.autoPickFile(files, '2').id).toBe(90);
    expect(api.autoPickFile(files, 0).id).toBe(1);
  });

  it('prefers the requested episode over shared title words and asks when it is missing', () => {
    const { api } = runtime();
    const files = [video(1, 'Breaking.Bad.S02E01.mkv'), video(2, 'Breaking.Bad.S02E05.mkv')];
    expect(api.autoPickFile(files, null, 2, 5, 'Breaking Bad').id).toBe(2);
    expect(api.autoPickFile(files, null, 2, 7, 'Breaking Bad')).toBeNull();
    expect(api.autoPickFile([video(1, 'Show.S11E05.mkv'), video(2, 'Show.S02E05.mkv')], null, 1, 5)).toBeNull();
  });

  it('matches season-zero specials, episode ranges and named season folders', () => {
    const { api } = runtime();
    const files = [video(1, 'Show.S00E02.mkv'), video(2, 'Show.S01E05-E06.mkv'), video(3, 'Season 04/05 - Title.mkv')];
    expect(api.autoPickFile(files, null, 0, 2).id).toBe(1);
    expect(api.autoPickFile(files, null, 1, 6).id).toBe(2);
    expect(api.autoPickFile(files, null, 4, 5).id).toBe(3);
  });

  it('never streams subtitle/sample-only torrents and permits real film names containing cover', () => {
    const { api } = runtime();
    expect(api.autoPickFile([video(1, 'movie.vtt')])).toBeNull();
    expect(api.autoPickFile([video(1, 'readme.nfo'), video(2, 'English.srt')])).toBeNull();
    expect(api.autoPickFile([video(1, 'sample.mp4'), video(2, 'poster.jpg')])).toBeNull();
    expect(api.isVideoFile('The.Discovery.2017.mp4')).toBe(true);
    expect(api.isBrowserPlayable('film.MP4')).toBe(true);
    expect(api.isBrowserPlayable('film.mkv')).toBe(false);
  });
});

describe('production background dispatch', () => {
  it('passes stored player paths and preferred subtitle languages through to native launch', async () => {
    const nativePort = port({ status: 'ok' });
    const { api } = runtime({ stored: { mpv_path: '/custom/mpv', vlc_path: '/custom/vlc', subtitle_languages: 'el' }, nativePort });
    expect(await api.getConfig()).toMatchObject({ mpv_path: '/custom/mpv', vlc_path: '/custom/vlc', subtitleLangs: 'el' });
    expect(await api.tryLaunchPlayer('https://video.test/movie', 'vlc', ['https://sub.test/es.srt'])).toBe(true);
    expect(nativePort.postMessage).toHaveBeenCalledWith({ action: 'launch_player', player: 'vlc', custom_path: '/custom/vlc', url: 'https://video.test/movie', subtitles: ['https://sub.test/es.srt'], headers: null });
    expect(nativePort.disconnect).toHaveBeenCalledTimes(1);
  });

  it('times out a connected but unresponsive native helper so automatic fallback can proceed', async () => {
    vi.useFakeTimers();
    const nativePort = port();
    const { api } = runtime({ nativePort });
    const pending = api.tryLaunchPlayer('https://video.test/movie');
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toBe(false);
    expect(nativePort.disconnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('parses 2160p into the actual 4K bucket and honors configured quality limits', async () => {
    const { message, fetch } = runtime({ stored: { torrentio_base_url: 'https://torrentio.test/', enabled_qualities: ['4K', '720p'], max_per_quality: 1, max_results: 2 },
      fetch: vi.fn(async () => json({ streams: [
        { infoHash: 'ABC', name: 'Torrentio 2160p', title: 'Movie 8 GB 👤 100', fileIdx: 0 },
        { infoHash: 'DEF', name: 'Torrentio 4K', title: 'Movie 7 GB' },
        { infoHash: 'GHI', name: 'Torrentio 1080p' },
        { infoHash: 'JKL', name: 'Torrentio 720p', title: 'Movie 900 MB 20 seeds' },
        { url: 'direct streams unsupported' }, null,
      ] })) });
    const result = await message({ type: 'FETCH_TORRENTIO', imdbId: 'tt1', season: 0, episode: 2 });
    expect(fetch.mock.calls[0][0]).toBe('https://torrentio.test/stream/series/tt1:0:2.json');
    expect(result.type).toBe('TORRENTIO_RESULT');
    expect(result.streams.map(stream => stream.quality)).toEqual(['4K', '720p']);
    expect(result.streams[0]).toMatchObject({ info_hash: 'abc', file_idx: 0, size_bytes: 8 * 1024 ** 3, seeders: 100 });
    expect(result.streams[1].seeders).toBe(20);
  });

  it('filters legacy quality settings and reports empty and malformed provider responses', async () => {
    const { api, message } = runtime({ fetch: vi.fn(async () => json({ streams: {} })) });
    expect(api.distributeStreamsByQuality([{ quality: '720p' }, { quality: '1080p' }], { default_quality_filter: '1080p' })).toEqual([{ quality: '1080p' }]);
    expect((await message({ type: 'FETCH_TORRENTIO', imdbId: 'tt1' })).type).toBe('TORRENTIO_ERROR');
    api.fetch = vi.fn(async () => ({ ok: true, text: async () => '<!DOCTYPE html>Cloudflare' }));
    expect((await message({ type: 'FETCH_TORRENTIO', imdbId: 'tt1' })).message).toContain('Cloudflare');
  });

  it('reports missing credentials and invalid manual selections to the UI', async () => {
    const { message, browser } = runtime();
    expect((await message({ type: 'CHECK_CACHE', hashes: ['h'], streams: [] })).type).toBe('CACHE_ERROR');
    expect((await message({ type: 'START_STREAM', data: { hash: 'h' } })).message).toContain('API Key is missing');
    expect((await message({ type: 'PICK_FILE', torrentId: 1, fileId: 2 })).type).toBe('PICK_FILE_ERROR');
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it('updates cache results with case-insensitive hashes and routes cache failures visibly', async () => {
    const { message, api } = runtime({ stored: { torbox_api_key: 'key' }, fetch: vi.fn(async () => json({ success: true, data: { abc: {} } })) });
    expect(await message({ type: 'CHECK_CACHE', hashes: ['ABC'], streams: [{ info_hash: 'ABC' }] }))
      .toEqual({ type: 'CACHE_RESULT', streams: [{ info_hash: 'ABC', cached: true }] });
    api.fetch = vi.fn(async () => json({}, 503));
    expect((await message({ type: 'CHECK_CACHE', hashes: ['ABC'], streams: [{ info_hash: 'ABC' }] })).type).toBe('CACHE_ERROR');
  });

  it('runs START_STREAM through real APIs, episode selection, subtitle extraction and player URL creation', async () => {
    const { message, browser, stored, fetch } = playbackRuntime();
    const result = await message({ type: 'START_STREAM', data: {
      hash: 'abcd', season: 2, episode: 5, page_title: 'Show', title: 'Show season pack', media_type: 'series', imdb_id: 'tt123', is_cached: true,
    } });
    expect(result).toMatchObject({ type: 'STREAM_RESULT', data: { method: 'browser', file_name: 'Show.S02E05.mp4' } });
    const playerUrl = new URL(browser.tabs.create.mock.calls[0][0].url);
    expect(Object.fromEntries(playerUrl.searchParams)).toMatchObject({ torrent_id: '23', imdb_id: 'tt123', media_type: 'series', season: '2', episode: '5' });
    expect(new URL(playerUrl.searchParams.get('url')).searchParams.get('file_id')).toBe('42');
    expect(stored.player_bundled_subtitles.map(sub => sub.label)).toEqual(['Torrent: English.srt', 'Torrent: Spanish.vtt']);
    expect(stored.last_stream_metadata).toMatchObject({ torrent_id: 23, imdb_id: 'tt123' });
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(5, expect.objectContaining({ type: 'STREAM_PROGRESS' }));
    expect(fetch.mock.calls.some(([url]) => url.includes('/series/tt123:2:5.json'))).toBe(true);
  });

  it('returns a manual file choice for a missing episode without opening a wrong video', async () => {
    const { message, browser } = playbackRuntime();
    const result = await message({ type: 'START_STREAM', data: { hash: 'h', season: 2, episode: 9, media_type: 'series' } });
    expect(result).toMatchObject({ type: 'STREAM_RESULT', data: { action: 'pick_file', torrent_id: 23 } });
    expect(result.data.files).toHaveLength(5);
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it.each(['ask', 'mpv', 'vlc', 'auto'])('honors %s player routing when no native host is installed', async player => {
    const { message, browser } = playbackRuntime({ player_preference: player }, { files: [video(2, 'Film.mkv')] });
    const result = await message({ type: 'START_STREAM', data: { hash: 'h', media_type: 'movie', season: 1, episode: 1 } });
    expect(result.type).toBe('STREAM_RESULT');
    expect(result.data.method).toBe(player === 'ask' ? 'ask' : player === 'auto' ? 'browser' : 'url_only');
    expect(browser.tabs.create).toHaveBeenCalledTimes(player === 'auto' ? 1 : 0);
  });

  it('forwards selected subtitle preferences to the installed native player', async () => {
    const nativePort = port({ status: 'ok' });
    const { message, browser } = playbackRuntime({ player_preference: 'mpv', mpv_path: '/custom/mpv' }, { nativePort });
    const result = await message({ type: 'START_STREAM', data: { hash: 'h', media_type: 'series', season: 2, episode: 5, imdb_id: 'tt123' } });
    expect(result.data.method).toBe('mpv');
    expect(nativePort.postMessage.mock.calls[0][0]).toMatchObject({ player: 'mpv', custom_path: '/custom/mpv', subtitles: expect.arrayContaining(['https://subs.test/es.srt']) });
    expect(nativePort.postMessage.mock.calls[0][0].subtitles).toHaveLength(3);
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it('preserves explicit and tab metadata when opening a player after manual file/player choice', async () => {
    const { message, browser, listeners } = runtime();
    message({ type: 'PAGE_INFO', data: { imdbId: 'tt123', mediaType: 'series', season: 0, episode: 2 } });
    expect((await message({ type: 'GET_TAB_INFO' })).imdbId).toBe('tt123');
    expect(await message({ type: 'OPEN_PLAYER_TAB', url: 'https://video.test/file?a=1&b=2', torrentId: 8, title: 'A & B' })).toEqual({ success: true });
    const url = new URL(browser.tabs.create.mock.calls[0][0].url);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ title: 'A & B', torrent_id: '8', imdb_id: 'tt123', media_type: 'series', season: '0', episode: '2' });
    listeners.remove(5);
    expect(await message({ type: 'GET_TAB_INFO' })).toBeNull();
  });

  it('returns errors for failed subtitle text downloads and validates their URL', async () => {
    const { message, fetch } = runtime({ fetch: vi.fn(async () => json({}, 404)) });
    expect(await message({ type: 'FETCH_SUBTITLE_TEXT', url: 'https://sub.test/missing.srt' }))
      .toEqual({ type: 'SUBTITLE_TEXT_RESULT', success: false, error: 'HTTP 404' });
    expect((await message({ type: 'FETCH_SUBTITLE_TEXT', url: 'file:///private' })).success).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
