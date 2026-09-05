import { test, expect } from '../helpers/chromium.js';
import { movieUrl, seriesUrl, hashes, mockPageNetwork, mockWorkerNetwork } from '../helpers/offline.js';

test.beforeEach(async ({ context, extensionWorker }) => {
  await mockPageNetwork(context);
  await mockWorkerNetwork(extensionWorker);
  await extensionWorker.evaluate(() => chrome.storage.local.set({
    torbox_api_key: 'fixture-key', player_preference: 'browser', subtitle_languages: 'en',
  }));
});

test('packaged settings has every dropdown option and persists edits through real extension storage', async ({ page, extensionId, extensionWorker }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/options/options.html`);
  await expect(page.locator('#player-pref option')).toHaveCount(5);
  await expect(page.locator('#quality-pref option')).toHaveCount(5);
  expect(await page.locator('#player-pref option').evaluateAll(options => options.map(o => o.value))).toEqual(['auto', 'ask', 'browser', 'mpv', 'vlc']);
  expect(await page.locator('#quality-pref option').evaluateAll(options => options.map(o => o.value))).toEqual(['all', '4K', '1080p', '720p', '480p']);
  await page.getByLabel('Preferred Player', { exact: true }).selectOption('vlc');
  await page.getByLabel('Quality Filter Mode', { exact: true }).selectOption('4K');
  await page.locator('#subtitle-langs').fill('en, es');
  await page.locator('#max-results').fill('25');
  await page.locator('#vlc-path').fill('/fixture/bin/vlc');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.locator('#status-msg')).toHaveText(/Saved/i);
  await page.reload();
  await expect(page.locator('#player-pref')).toHaveValue('vlc');
  await expect(page.locator('#quality-pref')).toHaveValue('4K');
  await expect(page.locator('#subtitle-langs')).toHaveValue('en, es');
  await expect(page.locator('#max-results')).toHaveValue('25');
  expect(await extensionWorker.evaluate(() => chrome.storage.local.get(['player_preference', 'vlc_path']))).toEqual({ player_preference: 'vlc', vlc_path: '/fixture/bin/vlc' });
  expect(errors).toEqual([]);
});

test('manifest injects IMDb content script and the real background populates and filters streams', async ({ page, extensionWorker }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(movieUrl);
  await expect(page.locator('#torbox-play-btn')).toHaveCount(1);
  await page.locator('#torbox-play-btn').click();
  await expect(page.locator('.torbox-stream-item')).toHaveCount(3);
  await expect(page.locator('.torbox-stream-item.cached')).toHaveCount(2);
  await expect(page.locator('[data-filter-quality="4K"]')).toBeVisible();
  await page.locator('[data-filter-quality="4K"]').click();
  await expect(page.locator('.torbox-stream-item')).toHaveCount(1);
  await expect(page.locator('.torbox-stream-item')).toContainText('2160p');
  await page.locator('[data-filter-quality="all"]').click();
  await page.locator('[data-filter-cached]').click();
  await expect(page.locator('.torbox-stream-item')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Search streams' }).fill('720p');
  await expect(page.locator('.torbox-stream-item')).toHaveCount(1);
  await page.locator('[data-filter-player="ask"]').click();
  await expect.poll(() => extensionWorker.evaluate(async () => (await chrome.storage.local.get('player_preference')).player_preference)).toBe('ask');
  const requests = await extensionWorker.evaluate(() => globalThis.auditRequests);
  expect(requests.some(r => new URL(r.url).pathname === '/stream/movie/tt1375666.json')).toBe(true);
  const cacheRequest = requests.find(r => r.url.includes('/checkcached'));
  expect(cacheRequest.authorization).toBe('Bearer fixture-key');
  expect(new URL(cacheRequest.url).searchParams.get('hash').split(',')).toEqual(hashes);
  await testInfo.attach('stream-dialog-accessibility', { body: await page.locator('#torbox-modal-overlay').ariaSnapshot(), contentType: 'text/plain' });
  await page.keyboard.press('Escape');
  await expect(page.locator('#torbox-modal-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('TMDB season and episode controls reach the actual background request, including specials', async ({ page, extensionWorker }) => {
  await page.goto(seriesUrl);
  await page.locator('#torbox-play-btn').click();
  await expect(page.locator('.torbox-stream-item')).toHaveCount(3);
  await expect(page.locator('#torbox-season')).toHaveValue('2');
  await expect(page.locator('#torbox-episode')).toHaveValue('5');
  await page.getByLabel('Season', { exact: true }).fill('0');
  await page.getByLabel('Episode', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.locator('.torbox-stream-item')).toHaveCount(3);
  await expect(page.locator('#torbox-season')).toHaveValue('0');
  await expect(page.locator('#torbox-episode')).toHaveValue('2');
  const paths = await extensionWorker.evaluate(() => globalThis.auditRequests.map(r => new URL(r.url).pathname));
  expect(paths).toContain('/stream/series/tt0903747:2:5.json');
  expect(paths).toContain('/stream/series/tt0903747:0:2.json');
});

test('missing key surfaces a settings recovery action which opens the real options page', async ({ page, context, extensionWorker }) => {
  await extensionWorker.evaluate(() => chrome.storage.local.remove('torbox_api_key'));
  await page.goto(movieUrl);
  await page.locator('#torbox-play-btn').click();
  await expect(page.locator('#torbox-modal-body')).toContainText(/API key/i);
  const optionsOpened = context.waitForEvent('page');
  await page.locator('#torbox-modal-body').getByRole('button', { name: /settings|options/i }).click();
  const options = await optionsOpened;
  await expect(options).toHaveURL(/chrome-extension:.*options\/options.html/);
  await expect(options.locator('#api-key')).toBeVisible();
});

test('provider errors do not produce empty success lists and reopening recovers', async ({ page, extensionWorker }) => {
  await extensionWorker.evaluate(() => { globalThis.auditFailures['/stream/movie/tt1375666.json'] = 503; });
  await page.goto(movieUrl);
  await page.locator('#torbox-play-btn').click();
  await expect(page.locator('#torbox-modal-body')).toContainText('503');
  await expect(page.locator('.torbox-stream-item')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await extensionWorker.evaluate(() => { globalThis.auditFailures = {}; });
  await page.locator('#torbox-play-btn').click();
  await expect(page.locator('.torbox-stream-item')).toHaveCount(3);
});

test('cache API failures remain errors instead of silently marking all streams uncached', async ({ page, extensionWorker }) => {
  await extensionWorker.evaluate(() => { globalThis.auditFailures['/v1/api/torrents/checkcached'] = 503; });
  await page.goto(movieUrl);
  await page.locator('#torbox-play-btn').click();
  await expect(page.locator('#torbox-modal-body')).toContainText(/cache.*failed|503/i);
  await expect(page.locator('.torbox-stream-item.uncached')).toHaveCount(0);
});

test('stream selection creates a player tab with parsed bundled and provider subtitle options', async ({ page, context, extensionWorker, extensionId }, testInfo) => {
  await page.goto(movieUrl);
  await page.locator('#torbox-play-btn').click();
  await expect(page.locator('.torbox-stream-item.cached')).toHaveCount(2);
  const playerOpened = context.waitForEvent('page');
  await page.locator('.torbox-stream-item.cached').first().click();
  const player = await playerOpened;
  await expect(player).toHaveURL(new RegExp(`chrome-extension://${extensionId}/player/player.html`));
  const params = new URL(player.url()).searchParams;
  expect(params.get('torrent_id')).toBe('42');
  expect(params.get('imdb_id')).toBe('tt1375666');
  expect(new URL(params.get('url')).searchParams.get('file_id')).toBe('11');
  await expect(player.locator('#sub-select option')).toHaveCount(3);
  const labels = await player.locator('#sub-select option').allTextContents();
  expect(labels[0]).toMatch(/off/i);
  expect(labels).toContain('Torrent: English.srt');
  expect(labels.some(label => /English/.test(label) && !label.startsWith('Torrent:'))).toBe(true);
  expect(labels.some(label => /Spanish/i.test(label))).toBe(false);
  await player.locator('#sub-select').selectOption({ label: 'Torrent: English.srt' });
  await expect(player.locator('#video-player track')).toHaveCount(1);
  await expect.poll(() => player.locator('#video-player').evaluate(video => video.textTracks[0]?.cues?.[0]?.text)).toBe('An actual parsed subtitle cue.');
  await player.locator('#sub-select').selectOption('');
  await expect(player.locator('#video-player track')).toHaveCount(0);
  const requests = await extensionWorker.evaluate(() => globalThis.auditRequests);
  const createRequest = requests.find(r => r.url.includes('/createtorrent'));
  expect(createRequest.method).toBe('POST');
  expect(new URLSearchParams(createRequest.body).get('magnet')).toBe(`magnet:?xt=urn:btih:${hashes[0]}`);
  expect(createRequest.authorization).toBe('Bearer fixture-key');
  await testInfo.attach('player-accessibility', { body: await player.locator('body').ariaSnapshot(), contentType: 'text/plain' });
});
