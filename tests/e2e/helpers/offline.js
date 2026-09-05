// Only network responses are replaced here. The packaged extension, storage,
// content-script isolation, service worker and runtime messaging remain real.
export const movieUrl = 'https://www.imdb.com/title/tt1375666/';
export const seriesUrl = 'https://www.themoviedb.org/tv/1396-breaking-bad/season/2/episode/5';
export const hashes = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];
export const torrentio = {
  streams: [
    { name: 'Torrentio 2160p', title: 'Inception.2010.2160p.UHD.webm\n👤 120 💾 4 GB', infoHash: hashes[0], fileIdx: 0 },
    { name: 'Torrentio 1080p', title: 'Inception.2010.1080p.webm\n👤 80 💾 2 GB', infoHash: hashes[1], fileIdx: 0 },
    { name: 'Torrentio 720p', title: 'Inception.2010.720p.webm\n👤 40 💾 1 GB', infoHash: hashes[2], fileIdx: 0 },
  ],
};
export const subtitleText = '1\n00:00:00,000 --> 00:00:05,000\nAn actual parsed subtitle cue.\n';
export const externalSubtitles = [
  { id: 'external-en', lang: 'eng', url: 'https://subtitles.strem.fun/fixture-en.srt' },
  { id: 'external-es', lang: 'spa', url: 'https://subtitles.strem.fun/fixture-es.srt' },
];

export function titleHtml(url) {
  if (url.includes('themoviedb.org')) {
    return `<!doctype html><html lang="en"><head><title>Breaking Bad (TV Series 2008) — The Movie Database (TMDB)</title></head><body>
      <h1>Breaking Bad</h1><div class="header_poster"><section class="header"><ul class="actions"></ul></section></div>
      <section class="social_links"><a href="https://www.imdb.com/title/tt0903747/">IMDb</a></section></body></html>`;
  }
  return `<!doctype html><html lang="en"><head><title>Inception (2010) - IMDb</title></head><body>
    <h1 data-testid="hero__primary-text">Inception</h1><ul class="ipc-inline-list"><li>Movie</li></ul></body></html>`;
}

export async function mockPageNetwork(context) {
  const unexpected = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (['www.imdb.com', 'www.themoviedb.org'].includes(url.hostname)) {
      return route.fulfill({ contentType: 'text/html', body: titleHtml(url.href) });
    }
    if (url.hostname === 'opensubtitles-v3.strem.io' && url.pathname.endsWith('.json')) {
      return route.fulfill({ json: { subtitles: externalSubtitles } });
    }
    if (url.hostname === 'api.torbox.app' && url.pathname.endsWith('/mylist')) {
      return route.fulfill({ json: { success: true, data: [sampleTorrent()] } });
    }
    if (url.hostname === 'api.torbox.app' && url.pathname.endsWith('/requestdl')) {
      if (url.searchParams.get('file_id') === '12') {
        return route.fulfill({ contentType: 'text/plain', body: subtitleText });
      }
      // Media decoding has dedicated player tests; this flow verifies routing.
      return route.fulfill({ status: 200, contentType: 'video/webm', body: '' });
    }
    if (url.hostname === 'subtitles.strem.fun' && url.pathname.endsWith('.srt')) {
      return route.fulfill({ contentType: 'text/plain', body: subtitleText });
    }
    unexpected.push(url.origin + url.pathname);
    return route.abort('blockedbyclient');
  });
  return unexpected;
}

export function sampleTorrent() {
  return {
    id: 42, name: 'Inception.2010', hash: hashes[0], download_state: 'completed', progress: 1,
    files: [
      { id: 11, name: 'Inception.2010.1080p.webm', size: 2000000000 },
      { id: 12, name: 'Subs/English.srt', size: 2048 },
      { id: 13, name: 'Subs/Spanish.srt', size: 2048 },
      { id: 14, name: 'readme.nfo', size: 100 },
    ],
  };
}

export async function mockWorkerNetwork(worker, options = {}) {
  await worker.evaluate(({ streams, torrent, subs, text, hashes, options }) => {
    globalThis.auditRequests = [];
    globalThis.auditFailures = options.failures || {};
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const key = url.origin + url.pathname;
      globalThis.auditRequests.push({ url: url.href, method: init.method || 'GET', body: String(init.body || ''), authorization: new Headers(init.headers).get('authorization') });
      const status = globalThis.auditFailures[url.pathname];
      if (status) return new Response('Fixture failure', { status });
      const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
      if (url.hostname === 'torrentio.strem.fun' && url.pathname.endsWith('.json')) return json(streams);
      if (key.endsWith('/torrents/checkcached')) return json({ success: true, data: { [hashes[0]]: { hash: hashes[0] }, [hashes[1]]: null, [hashes[2]]: { hash: hashes[2] } } });
      if (key.endsWith('/torrents/createtorrent')) return json({ success: true, data: { torrent_id: torrent.id } });
      if (key.endsWith('/torrents/mylist')) return json({ success: true, data: [torrent] });
      if (key.endsWith('/torrents/controltorrent')) return json({ success: true });
      if (url.hostname === 'opensubtitles-v3.strem.io' && url.pathname.endsWith('.json')) return json({ subtitles: subs });
      if (key.endsWith('/torrents/requestdl') || url.pathname.endsWith('.srt')) return new Response(text);
      throw new Error(`Unexpected network request: ${key}`);
    };
  }, { streams: options.streams || torrentio, torrent: options.torrent || sampleTorrent(), subs: externalSubtitles, text: subtitleText, hashes, options });
}
