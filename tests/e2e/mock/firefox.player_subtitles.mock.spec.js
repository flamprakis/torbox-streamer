import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe('Firefox Browser Player Subtitles E2E Suite', () => {
  test('should populate #sub-select dropdown menu with bundled and external subtitles in Firefox player', async ({ page }) => {
    // 1. Mock extension static files via local HTTP routing
    await page.route('https://extension-local/**', async (route) => {
      const url = new URL(route.request().url());
      const relativePath = url.pathname.slice(1);
      const filePath = path.resolve(__dirname, '../../../extension', relativePath);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath);
        let contentType = 'text/plain';
        if (filePath.endsWith('.html')) contentType = 'text/html';
        else if (filePath.endsWith('.js')) contentType = 'application/javascript';
        else if (filePath.endsWith('.css')) contentType = 'text/css';
        await route.fulfill({ status: 200, contentType, body: content });
      } else {
        await route.fulfill({ status: 404 });
      }
    });

    // 2. Mock TorBox & Subtitles API HTTP responses
    await page.route('https://subtitles.strem.fun/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subtitles: [
            { id: 'ext-en', lang: 'en', url: 'https://subtitles.strem.fun/en.srt' },
            { id: 'ext-es', lang: 'es', url: 'https://subtitles.strem.fun/es.srt' }
          ]
        })
      });
    });

    await page.route('https://api.torbox.app/v1/api/torrents/mylist*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{
            id: 100,
            name: 'Shawshank.Redemption.mkv',
            state: 'completed',
            files: [
              { id: 1, name: 'Shawshank.Redemption.mkv', size: 2500000000 },
              { id: 2, name: 'Subs/English.srt', size: 45000 },
              { id: 3, name: 'Subs/Greek.ass', size: 55000 }
            ]
          }]
        })
      });
    });

    await page.route('https://api.torbox.app/v1/api/torrents/requestdl*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: `1\n00:00:01,000 --> 00:00:05,000\nBundled Torrent Subtitle`
      });
    });

    // 3. Setup browser extension storage & mock runtime
    await page.addInitScript(() => {
      window.chrome = window.chrome || {};
      window.chrome.runtime = window.chrome.runtime || {
        sendMessage: async (msg) => {
          if (msg.type === 'FETCH_SUBTITLE_TEXT') {
            return { success: true, text: '1\n00:00:01,000 --> 00:00:05,000\nSubtitle content' };
          }
          return { success: true };
        },
        getURL: (path) => `https://extension-local/${path}`,
      };
      window.chrome.storage = window.chrome.storage || {
        local: {
          get: (keys, cb) => {
            const data = {
              torbox_api_key: 'test_api_key',
              subtitle_languages: 'en, browser',
              player_bundled_subtitles: [
                { id: 'torrent-sub-2', label: 'Torrent: English.srt', lang: 'torrent', url: 'https://api.torbox.app/v1/api/torrents/requestdl?torrent_id=100&file_id=2', format: 'srt' },
                { id: 'torrent-sub-3', label: 'Torrent: Greek.ass', lang: 'torrent', url: 'https://api.torbox.app/v1/api/torrents/requestdl?torrent_id=100&file_id=3', format: 'ass' }
              ]
            };
            return cb ? cb(data) : Promise.resolve(data);
          },
          set: (data, cb) => cb ? cb() : Promise.resolve()
        }
      };
      window.browser = window.chrome;
    });

    // 4. Load player page via extension-local HTTP
    await page.goto(`https://extension-local/player/player.html?url=https://cdn.torbox.app/video.mp4&title=Shawshank.Redemption.mkv&torrent_id=100&imdb_id=tt0111161&media_type=movie`);

    // 5. Assert #sub-select dropdown exists and is populated
    const subSelect = page.locator('#sub-select');
    await expect(subSelect).toBeVisible();

    // Wait for dropdown options to be populated
    await page.waitForFunction(() => {
      const select = document.getElementById('sub-select');
      return select && select.options.length > 1;
    }, { timeout: 5000 });

    const optionCount = await subSelect.evaluate(el => el.options.length);
    expect(optionCount).toBeGreaterThan(1);

    const optionTexts = await subSelect.evaluate(el => Array.from(el.options).map(o => o.text));
    expect(optionTexts).toContain('Torrent: English.srt');

    // 6. Select bundled subtitle option and verify track is created in video
    await subSelect.selectOption({ label: 'Torrent: English.srt' });

    const trackCount = await page.evaluate(() => {
      const video = document.getElementById('video-player');
      return video ? video.querySelectorAll('track').length : 0;
    });
    expect(trackCount).toBeGreaterThan(0);
  });
});
