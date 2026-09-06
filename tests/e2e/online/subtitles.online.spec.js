import { test, expect } from '../helpers/chromium.js';

// Opt-in check against the public provider. Uses no TorBox key or account.
test('public OpenSubtitles lists distinct releases and the installed background downloads valid cues', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/options/options.html`);
  const result = await page.evaluate(() => chrome.runtime.sendMessage({
    type: 'FETCH_SUBTITLES', imdbId: 'tt1375666', mediaType: 'movie', languages: ['en'],
  }));
  expect(result.success, result.error).toBe(true);
  expect(result.subtitles.length).toBeGreaterThan(1);
  expect(new Set(result.subtitles.map(sub => sub.label)).size).toBe(result.subtitles.length);
  const text = await page.evaluate(url => chrome.runtime.sendMessage({ type: 'FETCH_SUBTITLE_TEXT', url }), result.subtitles[0].url);
  expect(text.success, text.error).toBe(true);
  expect(text.text).toMatch(/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/);
});
