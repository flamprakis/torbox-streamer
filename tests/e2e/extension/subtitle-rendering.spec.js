import { test, expect } from '../helpers/chromium.js';
import { mockPageNetwork, mockWorkerNetwork } from '../helpers/offline.js';

test('captions paint during playback with custom controls and do not double with native controls', async ({ page, context, extensionId, extensionWorker }, testInfo) => {
  await mockPageNetwork(context);
  await mockWorkerNetwork(extensionWorker);
  await extensionWorker.evaluate(() => chrome.storage.local.set({
    subtitle_languages: 'en', torbox_api_key: 'fixture-key',
  }));
  await page.goto(`chrome-extension://${extensionId}/player/player.html?imdb_id=tt1375666`);
  // A real canvas MediaStream supplies decoded frames and a playback clock.
  // Empty mocked video bytes cannot establish whether captions actually paint.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#173047'; ctx.fillRect(0, 0, 640, 360);
    const video = document.querySelector('video');
    video.muted = true;
    video.srcObject = canvas.captureStream(10);
    await video.play();
  });
  await expect(page.locator('#subtitle-overlay')).toContainText('An actual parsed subtitle cue.');
  await expect(page.locator('#subtitle-overlay span')).toBeVisible();
  expect(await page.locator('video').evaluate(v => v.controls)).toBe(false);
  expect(await page.locator('video').evaluate(v => v.textTracks[0].mode)).toBe('hidden');
  await page.locator('video').evaluate(v => { v.pause(); v.controls = true; });
  await expect(page.locator('#subtitle-overlay')).toBeEmpty();
  await expect.poll(() => page.locator('video').evaluate(v => [...v.textTracks].filter(t => t.mode === 'showing').length)).toBe(1);
  await page.locator('video').evaluate(v => { v.controls = false; });
  await expect(page.locator('#subtitle-overlay span')).toBeVisible();
  const captionBox = await page.locator('#subtitle-overlay span').boundingBox();
  const controlsBox = await page.locator('.player-bottom-overlay').boundingBox();
  expect(captionBox.y + captionBox.height).toBeLessThan(controlsBox.y);
  await page.screenshot({ path: testInfo.outputPath('visible-custom-captions.png') });
  await testInfo.attach('visible-custom-captions', { path: testInfo.outputPath('visible-custom-captions.png'), contentType: 'image/png' });
  await page.locator('video').evaluate(v => { v.controls = true; });
  await expect.poll(() => page.locator('video').evaluate(v => v.textTracks[0].mode)).toBe('showing');
  // Chromium's own Off selection must propagate to the custom selector too.
  await page.locator('video').evaluate(v => { v.textTracks[0].mode = 'disabled'; });
  await expect(page.locator('#sub-select')).toHaveValue('');
  await page.locator('video').evaluate(v => { v.textTracks[0].mode = 'showing'; });
  await expect(page.locator('#sub-select')).toHaveValue('0');
  await expect.poll(() => page.locator('video').evaluate(v => [...v.textTracks].filter(t => t.mode === 'showing').length)).toBe(1);
  await page.locator('video').evaluate(v => { v.textTracks[0].mode = 'disabled'; });
  await expect(page.locator('#sub-select')).toHaveValue('');
  await page.locator('video').evaluate(v => { v.controls = false; });
  await expect(page.locator('#subtitle-overlay')).toBeEmpty();
  await page.locator('#sub-select').selectOption('');
  await expect(page.locator('#subtitle-overlay')).toBeEmpty();
  await expect(page.locator('video track')).toHaveCount(0);
});

test('multiple same-language provider releases remain individually selectable', async ({ page, context, extensionId, extensionWorker }) => {
  await mockPageNetwork(context);
  await mockWorkerNetwork(extensionWorker);
  await extensionWorker.evaluate(() => {
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => String(url).includes('/subtitles/movie/')
      ? new Response(JSON.stringify({ subtitles: [
        { id: '1', lang: 'eng', url: 'https://subtitles.strem.fun/one.srt', subtitleFileName: 'Film.BluRay.srt' },
        { id: '2', lang: 'eng', url: 'https://subtitles.strem.fun/two.srt', subtitleFileName: 'Film.WEB-DL.srt' },
      ] })) : priorFetch(url, options);
    return chrome.storage.local.set({ subtitle_languages: 'en, eng, browser' });
  });
  await page.goto(`chrome-extension://${extensionId}/player/player.html?imdb_id=tt1375666`);
  await expect(page.locator('#sub-select option')).toHaveCount(3);
  await page.locator('#sub-select').selectOption('1');
  await expect(page.locator('#sub-status')).toContainText('Film.WEB-DL.srt');
  await expect.poll(() => page.locator('video track').getAttribute('label')).toContain('Film.WEB-DL.srt');
  await page.locator('#sub-select').selectOption('0');
  await expect.poll(() => page.locator('video track').getAttribute('label')).toContain('Film.BluRay.srt');
  await expect(page.locator('video track')).toHaveCount(1);
  await page.locator('#btn-sub-plus').click();
  await expect.poll(() => page.locator('video').evaluate(v => v.textTracks[0]?.cues?.[0]?.startTime)).toBe(0.5);
  await page.locator('video').evaluate(v => { v.controls = true; });
  await expect.poll(() => page.locator('video').evaluate(v => v.textTracks[0].mode)).toBe('showing');
  await page.locator('video').evaluate(v => { v.textTracks[0].mode = 'disabled'; });
  await expect(page.locator('#sub-select')).toHaveValue('');
  await page.locator('video').evaluate(v => { v.textTracks[0].mode = 'showing'; });
  await expect(page.locator('#sub-select')).toHaveValue('0');
  await expect.poll(() => page.locator('video').evaluate(v => v.textTracks[0]?.cues?.[0]?.startTime)).toBe(0.5);
});

test('provider failure remains visible while bundled subtitles are usable', async ({ page, context, extensionId, extensionWorker }) => {
  await mockPageNetwork(context);
  await mockWorkerNetwork(extensionWorker, { failures: { '/subtitles/movie/tt1375666.json': 503 } });
  await extensionWorker.evaluate(() => chrome.storage.local.set({ subtitle_languages: 'en', torbox_api_key: 'fixture-key' }));
  await page.goto(`chrome-extension://${extensionId}/player/player.html?imdb_id=tt1375666&torrent_id=42`);
  await expect(page.locator('#sub-status')).toContainText('503');
  await expect(page.locator('#sub-select option')).toHaveCount(2);
  await expect(page.locator('#sub-select option').last()).toHaveText('Torrent: English.srt');
  await page.locator('#sub-select').selectOption('');
  await expect(page.locator('#sub-status')).toContainText('503');
});

test('browser-exposed embedded tracks sync both selectors without duplicate captions or metadata interference', async ({ page, context, extensionId, extensionWorker }) => {
  await mockPageNetwork(context);
  await mockWorkerNetwork(extensionWorker);
  await extensionWorker.evaluate(() => chrome.storage.local.set({ subtitle_languages: 'en, eng, browser' }));
  await page.goto(`chrome-extension://${extensionId}/player/player.html`);
  await expect(page.locator('#sub-status')).toContainText('No subtitles found');
  await page.evaluate(async () => {
    const video = document.querySelector('video');
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    canvas.getContext('2d').fillRect(0, 0, 640, 360);
    video.srcObject = canvas.captureStream(10);
    video.muted = true;
    await video.play();
    for (const [language, text] of [['eng', 'Embedded full captions'], ['en', 'Embedded SDH captions'], ['fra', 'French captions']]) {
      const track = video.addTextTrack('subtitles', 'English', language);
      track.addCue(new VTTCue(0, 60, text));
    }
    const metadata = video.addTextTrack('metadata', 'metadata');
    metadata.mode = 'hidden';
  });
  await expect(page.locator('#sub-select option')).toHaveCount(3);
  const labels = await page.locator('#sub-select option').allTextContents();
  expect(new Set(labels).size).toBe(3);
  await expect(page.locator('#subtitle-overlay')).toHaveText('Embedded full captions');
  await page.locator('#sub-select').selectOption('1');
  await expect(page.locator('#subtitle-overlay')).toHaveText('Embedded SDH captions');
  await expect(page.locator('#btn-sub-plus')).toBeDisabled();
  await page.locator('video').evaluate(v => { v.pause(); v.controls = true; });
  await expect(page.locator('#subtitle-overlay')).toBeEmpty();
  await expect.poll(() => page.locator('video').evaluate(v => v.textTracks[1].mode)).toBe('showing');
  // Exercise the same TextTrack mode changes made by Chromium's native menu.
  await page.locator('video').evaluate(v => { v.textTracks[1].mode = 'disabled'; v.textTracks[0].mode = 'showing'; });
  await expect(page.locator('#sub-select')).toHaveValue('0');
  await expect.poll(() => page.locator('video').evaluate(v => [...v.textTracks].filter(t => t.mode === 'showing').length)).toBe(1);
  await page.locator('video').evaluate(v => { v.controls = false; });
  await expect(page.locator('#subtitle-overlay')).toHaveText('Embedded full captions');
  await page.locator('#btn-reload-subs').click();
  await expect(page.locator('#subtitle-overlay')).toHaveText('Embedded full captions');
  await expect(page.locator('#sub-select option')).toHaveCount(3);
  await page.locator('#sub-select').selectOption('');
  await expect(page.locator('#subtitle-overlay')).toBeEmpty();
  await expect.poll(() => page.locator('video').evaluate(v => [...v.textTracks].filter(t => t.kind === 'subtitles').every(t => t.mode === 'disabled'))).toBe(true);
  expect(await page.locator('video').evaluate(v => v.textTracks[3].mode)).toBe('hidden');
  await page.locator('#btn-reload-subs').click();
  await expect(page.locator('#sub-select')).toHaveValue('');
  await expect(page.locator('#subtitle-overlay')).toBeEmpty();
});

test('configured language excludes English fallback but keeps every matching torrent file', async ({ page, context, extensionId, extensionWorker }) => {
  await mockPageNetwork(context);
  await mockWorkerNetwork(extensionWorker);
  await extensionWorker.evaluate(() => chrome.storage.local.set({
    subtitle_languages: 'el, ell, gre',
    last_stream_metadata: { torrent_id: 42 },
    player_bundled_subtitles: [
      { id: '1', lang: 'ell', label: 'Torrent: Greek.srt', url: 'https://subtitles.strem.fun/one.srt', format: 'srt' },
      { id: '2', lang: 'gre', label: 'Torrent: Greek.srt', url: 'https://subtitles.strem.fun/two.srt', format: 'srt' },
      { id: '3', lang: 'eng', label: 'Torrent: English.srt', url: 'https://subtitles.strem.fun/three.srt', format: 'srt' },
    ],
  }));
  await page.goto(`chrome-extension://${extensionId}/player/player.html?torrent_id=42&imdb_id=tt1375666`);
  await expect(page.locator('#sub-select option')).toHaveCount(3);
  const labels = await page.locator('#sub-select option').allTextContents();
  expect(labels.join(' ')).not.toContain('English');
  expect(new Set(labels).size).toBe(3);
  await page.locator('#sub-select').selectOption('1');
  await expect.poll(() => page.locator('video track').getAttribute('label')).toContain('track 2');
  await expect(page.locator('video track')).toHaveCount(1);
});

test('switching between native and downloaded subtitles preserves native tracks and cleans up removed selections', async ({ page, context, extensionId, extensionWorker }) => {
  await mockPageNetwork(context);
  await mockWorkerNetwork(extensionWorker);
  await extensionWorker.evaluate(() => chrome.storage.local.set({ subtitle_languages: 'en' }));
  await page.goto(`chrome-extension://${extensionId}/player/player.html?imdb_id=tt1375666`);
  await expect(page.locator('video track[data-torbox-subtitle]')).toHaveCount(1);
  await page.locator('video').evaluate(v => {
    const track = document.createElement('track');
    track.id = 'native-fixture'; track.kind = 'subtitles'; track.srclang = 'eng'; track.label = 'English embedded';
    track.src = URL.createObjectURL(new Blob(['WEBVTT\n\n00:00.000 --> 01:00.000\nNative caption\n'], { type: 'text/vtt' }));
    v.appendChild(track);
    v.controls = true;
  });
  await expect(page.locator('#sub-select option')).toHaveCount(3);
  // Chromium may auto-select its preferred native track when controls appear.
  // Establish the downloaded selection before exercising a native menu switch.
  await page.locator('#sub-select').selectOption('0');
  await expect(page.locator('video track[data-torbox-subtitle]')).toHaveCount(1);
  await page.locator('video').evaluate(v => {
    v.querySelector('[data-torbox-subtitle]').track.mode = 'disabled';
    v.querySelector('#native-fixture').track.mode = 'showing';
  });
  await expect(page.locator('#sub-select')).toHaveValue('1');
  await expect(page.locator('video track[data-torbox-subtitle]')).toHaveCount(0);
  await expect(page.locator('#native-fixture')).toHaveCount(1);
  await page.locator('#sub-select').selectOption('0');
  await expect(page.locator('video track[data-torbox-subtitle]')).toHaveCount(1);
  await expect.poll(() => page.locator('video').evaluate(v => [...v.textTracks].filter(t => t.mode === 'showing').length)).toBe(1);
  expect(await page.locator('#native-fixture').evaluate(el => el.track.mode)).toBe('disabled');
  await page.locator('#sub-select').selectOption('1');
  await page.locator('#native-fixture').evaluate(el => { URL.revokeObjectURL(el.src); el.remove(); });
  await expect(page.locator('#sub-select')).toHaveValue('');
  await expect(page.locator('#sub-select option')).toHaveCount(2);
  await expect(page.locator('#sub-status')).toContainText('Subtitles off');
});
