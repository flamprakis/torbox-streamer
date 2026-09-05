import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve('extension/content.js'), 'utf8');
const movieUrl = 'https://www.imdb.com/title/tt1375666/';
const seriesUrl = 'https://www.imdb.com/title/tt0903747/';
const streams = [
  { info_hash: 'a'.repeat(40), file_idx: 0, title: 'Inception.2160p.HEVC.Atmos', quality: '4K', cached: true, seeders: 100, size_human: '20 GB' },
  { info_hash: 'b'.repeat(40), file_idx: 7, title: 'Inception.1080p.x264.YTS', quality: '1080p', cached: false, seeders: 80, size_human: '2 GB' },
  { info_hash: 'c'.repeat(40), file_idx: 9, title: 'Inception.720p.QxR', quality: '720p', cached: true, seeders: 60, size_human: '1 GB' },
];

// These are DOM integration tests of the unmodified production content script.
// The browser messaging boundary is mocked deliberately; installed-extension
// coverage lives in the separate extension project.
async function loadContent(page, { url = movieUrl, html, config = {}, responses = {}, fixtureStreams = streams, waitForButton = true } = {}) {
  await page.route('**/*', route => route.fulfill({
    status: route.request().isNavigationRequest() ? 200 : 404,
    contentType: 'text/html',
    body: html || `<!doctype html><html><head><title>${url === seriesUrl ? 'Breaking Bad (TV Series)' : 'Inception (2010)'}</title></head>
      <body><h1 data-testid="hero__primary-text">${url === seriesUrl ? 'Breaking Bad' : 'Inception'}</h1>
      <nav data-testid="hero-subnav-bar"><ul><li><a href="#other">Other page action</a></li></ul></nav></body></html>`,
  }));
  await page.addInitScript(({ config, responses, fixtureStreams }) => {
    window.__ui = { config, responses, messages: [], writes: [], pending: {}, listeners: [] };
    window.browser = {
      storage: { local: {
        get: async () => structuredClone(window.__ui.config),
        set: async values => { window.__ui.writes.push(structuredClone(values)); Object.assign(window.__ui.config, values); },
      } },
      runtime: {
        onMessage: { addListener: listener => window.__ui.listeners.push(listener) },
        sendMessage: async message => {
          window.__ui.messages.push(structuredClone(message));
          const queue = window.__ui.responses[message.type];
          if (queue?.length) {
            const reply = queue.shift();
            if (reply?.defer) return new Promise(resolve => { window.__ui.pending[reply.defer] = resolve; });
            if (reply?.reject) throw new Error(reply.reject);
            return reply;
          }
          if (message.type === 'FETCH_TORRENTIO') return { type: 'TORRENTIO_RESULT', streams: fixtureStreams };
          if (message.type === 'CHECK_CACHE') return { type: 'CACHE_RESULT', streams: message.streams };
          if (message.type === 'START_STREAM') return { type: 'STREAM_RESULT', data: {
            method: 'ask', url: 'https://cdn.example.test/movie.mp4', torrent_id: 42, file_name: 'Inception.mp4', file_size: '2 GB',
          } };
          if (message.type === 'PICK_FILE') return { type: 'PICK_FILE_RESULT', url: 'https://cdn.example.test/selected.mp4' };
          return { success: true };
        },
      },
    };
  }, { config, responses, fixtureStreams });
  await page.goto(url);
  await page.addScriptTag({ content: source });
  if (waitForButton) await expect(page.locator('#torbox-play-btn')).toBeVisible();
}

async function openStreams(page) {
  await page.locator('#torbox-play-btn').click();
  await expect(page.getByRole('dialog', { name: 'TorBox Streamer' })).toBeVisible();
  await expect(page.locator('#torbox-stream-search')).toBeVisible();
}

async function sent(page, type) {
  return page.evaluate(type => window.__ui.messages.filter(message => message.type === type), type);
}

test.describe('Content UI: production DOM and messaging contracts', () => {
  let errors = [];
  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', error => errors.push(error.message));
  });
  test.afterEach(() => expect(errors, 'No uncaught exceptions during UI interaction').toEqual([]));

  test('populates controls, combines filters, and launches the actual selected stream by keyboard', async ({ page }) => {
    await loadContent(page);
    await openStreams(page);
    await expect(page.locator('[data-filter-quality]')).toHaveText(['All', '4K', '1080p', '720p']);
    await expect(page.locator('[data-filter-player]')).toHaveText(['Auto', 'ASK', 'BROWSER', 'MPV', 'VLC']);
    await expect(page.locator('.torbox-stream-item')).toHaveCount(3);
    await page.getByRole('button', { name: 'Cached Only (2)', exact: true }).click();
    await expect(page.locator('.torbox-stream-item')).toHaveCount(2);
    await page.getByRole('textbox', { name: 'Search streams' }).fill('QxR');
    await expect(page.locator('.torbox-stream-item')).toHaveCount(1);
    await page.getByRole('button', { name: 'BROWSER', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__ui.config.player_preference)).toBe('browser');
    await expect(page.getByRole('button', { name: 'BROWSER', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.torbox-stream-item').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Stream Ready — Choose Player!')).toBeVisible();
    expect((await sent(page, 'START_STREAM'))[0].data).toMatchObject({ hash: streams[2].info_hash, file_idx: 9, is_cached: true });
    await page.getByRole('button', { name: 'Open in Browser Tab' }).click();
    expect((await sent(page, 'OPEN_PLAYER_TAB'))[0]).toMatchObject({ torrentId: 42, imdb_id: 'tt1375666', media_type: 'movie' });
    await page.getByRole('button', { name: 'Back to Streams' }).click();
    await expect(page.getByRole('textbox', { name: 'Search streams' })).toHaveValue('QxR');
    await expect(page.locator('.torbox-stream-item')).toHaveCount(1);
  });

  test('uses edited season and episode, keeps special season zero, and sends the same context to playback', async ({ page }) => {
    await loadContent(page, { url: seriesUrl });
    await openStreams(page);
    await page.getByRole('spinbutton', { name: 'Season', exact: true }).fill('0');
    await page.getByRole('spinbutton', { name: 'Episode', exact: true }).fill('3');
    await page.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Season', exact: true })).toHaveValue('0');
    await expect(page.getByRole('spinbutton', { name: 'Episode', exact: true })).toHaveValue('3');
    expect(await sent(page, 'FETCH_TORRENTIO')).toEqual([
      { type: 'FETCH_TORRENTIO', imdbId: 'tt0903747', season: 1, episode: 1 },
      { type: 'FETCH_TORRENTIO', imdbId: 'tt0903747', season: 0, episode: 3 },
    ]);
    await page.locator('.torbox-stream-item').first().click();
    await expect(page.getByRole('button', { name: 'Open in Browser Tab' })).toBeVisible();
    expect((await sent(page, 'START_STREAM'))[0].data).toMatchObject({ season: 0, episode: 3, imdb_id: 'tt0903747', media_type: 'series' });
    await page.getByRole('button', { name: 'Open in Browser Tab' }).click();
    expect((await sent(page, 'OPEN_PLAYER_TAB'))[0]).toMatchObject({ season: 0, episode: 3, imdb_id: 'tt0903747', media_type: 'series' });
  });

  test('rejects invalid episode input without losing the controls or sending a request', async ({ page }) => {
    await loadContent(page, { url: seriesUrl });
    await openStreams(page);
    for (const value of ['0', '-1', '1.5', '']) {
      await page.getByRole('spinbutton', { name: 'Episode', exact: true }).fill(value);
      await page.getByRole('button', { name: 'Go', exact: true }).click();
      await expect(page.getByRole('spinbutton', { name: 'Episode', exact: true })).toBeVisible();
      expect(await sent(page, 'FETCH_TORRENTIO')).toHaveLength(1);
    }
    await page.getByRole('spinbutton', { name: 'Episode', exact: true }).fill('4');
    await page.getByRole('spinbutton', { name: 'Episode', exact: true }).press('Enter');
    await expect.poll(async () => (await sent(page, 'FETCH_TORRENTIO')).length).toBe(2);
    expect((await sent(page, 'FETCH_TORRENTIO'))[1].episode).toBe(4);
  });

  test('retains the episode picker on empty results and can fetch the next episode', async ({ page }) => {
    await loadContent(page, { url: seriesUrl, responses: { FETCH_TORRENTIO: [{ type: 'TORRENTIO_RESULT', streams: [] }] } });
    await openStreams(page);
    await expect(page.getByRole('alert')).toContainText('No streams found');
    expect(await sent(page, 'CHECK_CACHE')).toHaveLength(0);
    await page.getByRole('spinbutton', { name: 'Episode', exact: true }).fill('2');
    await page.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(page.locator('.torbox-stream-item')).toHaveCount(3);
    expect((await sent(page, 'FETCH_TORRENTIO'))[1].episode).toBe(2);
  });

  test('preserves literal quotes and renders hostile metadata as text', async ({ page }) => {
    const hostile = '1080p" autofocus onfocus="window.__injected=1';
    await loadContent(page, { fixtureStreams: [{ ...streams[0], quality: hostile, title: '<img src=x onerror="window.__injected=1">', seeders: '<svg onload="window.__injected=1">' }] });
    await openStreams(page);
    await expect(page.locator('.torbox-title')).toHaveText('<img src=x onerror="window.__injected=1">');
    await expect(page.locator('#torbox-modal img, #torbox-modal [autofocus], #torbox-modal [onfocus]')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Search streams' }).fill('" onfocus="test');
    await expect(page.getByRole('textbox', { name: 'Search streams' })).toHaveValue('" onfocus="test');
    await expect(page.getByRole('alert')).toContainText('No streams match');
    expect(await page.evaluate(() => window.__injected)).toBeUndefined();
  });

  test('traps keyboard focus and restores the trigger after Escape without duplicate dialogs', async ({ page }) => {
    await loadContent(page);
    await openStreams(page);
    await expect(page.getByRole('button', { name: 'Close TorBox Streamer' })).toBeFocused();
    await page.getByRole('button', { name: 'Settings', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('.torbox-stream-item').last()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
    await page.evaluate(() => window.__ui.listeners.forEach(listener => listener({ type: 'OPEN_MODAL' })));
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#torbox-play-btn')).toBeFocused();
  });

  test('ignores a fetch reply belonging to a closed modal when a new modal is open', async ({ page }) => {
    await loadContent(page, { responses: { FETCH_TORRENTIO: [{ defer: 'old-fetch' }] } });
    await page.locator('#torbox-play-btn').click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__ui.pending['old-fetch']))).toBe(true);
    await page.keyboard.press('Escape');
    await openStreams(page);
    await page.evaluate(async () => {
      window.__ui.pending['old-fetch']({ type: 'TORRENTIO_ERROR', message: 'Stale error must not replace new streams' });
      await new Promise(requestAnimationFrame);
    });
    await expect(page.locator('.torbox-stream-item')).toHaveCount(3);
    await expect(page.getByText('Stale error must not replace new streams')).toHaveCount(0);
  });

  test('ignores a closed stream request and progress messages after reopening', async ({ page }) => {
    await loadContent(page, { responses: { START_STREAM: [{ defer: 'old-stream' }] } });
    await openStreams(page);
    await page.locator('.torbox-stream-item').first().click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__ui.pending['old-stream']))).toBe(true);
    await page.keyboard.press('Escape');
    await openStreams(page);
    await page.evaluate(async () => {
      window.__ui.listeners.forEach(listener => listener({ type: 'STREAM_PROGRESS', message: 'Old download progress' }));
      window.__ui.pending['old-stream']({ type: 'STREAM_RESULT', data: { action: 'pick_file', torrent_id: 99, files: [{ id: 1, name: 'old.mkv' }] } });
      await new Promise(requestAnimationFrame);
    });
    await expect(page.locator('.torbox-stream-item')).toHaveCount(3);
    await expect(page.locator('.torbox-file-item')).toHaveCount(0);
  });

  for (const [label, response] of [
    ['missing response', null], ['rejected request', { reject: 'Connection lost' }],
    ['unexpected response', { type: 'SOMETHING_ELSE' }],
  ]) {
    test(`recovers from ${label} while fetching streams`, async ({ page }) => {
      await loadContent(page, { responses: { FETCH_TORRENTIO: [response] } });
      await page.locator('#torbox-play-btn').click();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.locator('.torbox-loading')).toHaveCount(0);
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(page.locator('.torbox-stream-item')).toHaveCount(3);
    });
  }

  test('shows cache credentials errors with settings and retry recovery', async ({ page }) => {
    await loadContent(page, { responses: { CHECK_CACHE: [{ type: 'CACHE_ERROR', message: 'API key is required' }] } });
    await page.locator('#torbox-play-btn').click();
    await expect(page.getByRole('alert')).toContainText('API key is required');
    await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
    expect(await sent(page, 'OPEN_OPTIONS')).toHaveLength(1);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('.torbox-stream-item')).toHaveCount(3);
  });

  test('recovers from missing stream results and file-picker errors with correct file identifiers', async ({ page }) => {
    await loadContent(page, { responses: {
      START_STREAM: [null, { type: 'STREAM_RESULT', data: { action: 'pick_file', torrent_id: 65, files: [
        { id: 4, name: 'episode-one.mkv', size_human: '1 GB' }, { id: 11, name: 'episode-two.mp4', size_human: '2 GB' },
      ] } }],
      PICK_FILE: [{ type: 'PICK_FILE_ERROR', message: 'File temporarily unavailable' }],
    } });
    await openStreams(page);
    await page.locator('.torbox-stream-item').first().click();
    await expect(page.getByRole('alert')).toContainText('No response');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('.torbox-file-item')).toHaveCount(2);
    await page.getByRole('button', { name: /episode-two.mp4/ }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('alert')).toContainText('File temporarily unavailable');
    expect((await sent(page, 'PICK_FILE'))[0]).toEqual({ type: 'PICK_FILE', torrentId: 65, fileId: 11 });
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('button', { name: /episode-two.mp4/ }).click();
    await expect(page.getByText('Stream Ready!', { exact: true })).toBeVisible();
    await expect(page.locator('.torbox-success')).toContainText('episode-two.mp4');
  });

  test('extracts TMDB season pages and resolves IMDb IDs through the production fetch fallback', async ({ page }) => {
    const url = 'https://www.themoviedb.org/tv/1396-breaking-bad/season/2';
    await loadContent(page, { url, html: '<!doctype html><title>Breaking Bad (TV Series 2008-2013) - TMDB</title><ul class="actions"></ul>' });
    await page.route('https://v3-cinemeta.strem.fun/meta/series/tmdb:1396.json', route => route.fulfill({ json: { meta: { imdb_id: 'tt0903747' } } }));
    await openStreams(page);
    expect((await sent(page, 'FETCH_TORRENTIO'))[0]).toEqual({ type: 'FETCH_TORRENTIO', imdbId: 'tt0903747', season: 2, episode: 1 });
    await expect(page.getByRole('spinbutton', { name: 'Season', exact: true })).toHaveValue('2');
  });

  test('keeps an unavailable stored quality filter visible and provides an All escape route', async ({ page }) => {
    await loadContent(page, { config: { default_quality_filter: '480p', player_preference: 'removed-player' } });
    await openStreams(page);
    await expect(page.getByRole('button', { name: '480p', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Auto', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('alert')).toContainText('No streams match');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page.locator('.torbox-stream-item')).toHaveCount(3);
  });

  test('injects after delayed action-bar rendering and replaces a removed button exactly once', async ({ page }) => {
    await loadContent(page, { html: '<!doctype html><title>Inception (2010)</title><h1>Inception</h1>', waitForButton: false });
    await expect(page.locator('#torbox-play-btn')).toHaveCount(0);
    await page.evaluate(() => {
      const actions = document.createElement('div');
      actions.dataset.testid = 'hero__primary-actions';
      document.body.appendChild(actions);
    });
    await expect(page.locator('#torbox-play-btn')).toBeVisible();
    await expect(page.locator('[data-testid="hero__primary-actions"] > li')).toHaveCount(0);
    await page.evaluate(() => document.querySelector('[data-testid="hero__primary-actions"]').replaceChildren());
    await expect(page.locator('#torbox-play-btn')).toHaveCount(1);
    await openStreams(page);
    await expect(page.locator('.torbox-stream-item')).toHaveCount(3);
  });

  test('closes stale dialogs on SPA navigation and fetches the new title after action-bar replacement', async ({ page }) => {
    await loadContent(page);
    await openStreams(page);
    await page.evaluate(() => {
      history.pushState({}, '', '/title/tt0816692/');
      document.querySelector('h1').textContent = 'Interstellar';
      document.querySelector('nav').innerHTML = '<ul><li>New title action bar</li></ul>';
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#torbox-play-btn')).toHaveCount(1);
    await openStreams(page);
    expect((await sent(page, 'FETCH_TORRENTIO'))[1].imdbId).toBe('tt0816692');
    expect((await sent(page, 'PAGE_INFO')).at(-1).data).toMatchObject({ imdbId: 'tt0816692', title: 'Interstellar' });
  });

  test('extracts an IMDb episode page using its parent series identity', async ({ page }) => {
    await loadContent(page, { url: 'https://www.imdb.com/title/tt0959621/', html: `<!doctype html><title>Breakage - S2.E5</title>
      <h1>Breakage</h1><a data-testid="hero-title-block__series-link" href="https://www.imdb.com/title/tt0903747/">Breaking Bad</a>
      <div data-testid="hero-subnav-bar-season-episode-links">S2.E5</div><div data-testid="hero__primary-actions"></div>` });
    await openStreams(page);
    expect((await sent(page, 'FETCH_TORRENTIO'))[0]).toEqual({ type: 'FETCH_TORRENTIO', imdbId: 'tt0903747', season: 2, episode: 5 });
  });

  test('shows recoverable errors for native/browser launch and clipboard failures', async ({ page }) => {
    await loadContent(page, { responses: {
      TRY_PLAYER: [{ reject: 'Native host unavailable' }, { success: false }],
      OPEN_PLAYER_TAB: [{ reject: 'Tab creation failed' }],
    } });
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { throw new Error('Clipboard denied'); },
    } }));
    await openStreams(page);
    await page.locator('.torbox-stream-item').first().click();
    await page.getByRole('button', { name: 'Open in MPV', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Native host unavailable');
    await expect(page.getByRole('button', { name: 'Open in MPV', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Open in VLC', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Check that the native helper and player are installed');
    await page.getByRole('button', { name: 'Open in Browser Tab' }).click();
    await expect(page.getByRole('alert')).toContainText('Tab creation failed');
    await page.getByRole('button', { name: 'Copy Stream Link' }).click();
    await expect(page.getByRole('alert')).toContainText('Clipboard denied');
    await expect(page.getByRole('button', { name: 'Copied!', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open in MPV', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Launched in MPV!', exact: true })).toBeEnabled();
  });

  test('uses the selected torrent identity and recovers from rejected deletion', async ({ page }) => {
    await loadContent(page, { responses: { DELETE_TORRENT: [{ reject: 'Delete service unavailable' }] } });
    await openStreams(page);
    await page.locator('.torbox-stream-item').first().click();
    await page.getByRole('button', { name: 'Delete Torrent' }).click();
    await expect(page.getByRole('alert')).toContainText('Delete service unavailable');
    expect((await sent(page, 'DELETE_TORRENT'))[0]).toEqual({ type: 'DELETE_TORRENT', torrentId: 42 });
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('button', { name: 'Delete Torrent' }).click();
    await expect(page.getByText('Torrent deleted from TorBox.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
