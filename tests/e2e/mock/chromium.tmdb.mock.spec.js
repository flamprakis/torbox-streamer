import { test, expect } from '../helpers/chromium.js';
import path from 'path';
import fs from 'fs';

test.describe('Chromium Offline TMDB Mocked Suite', () => {
  test('should inject action button on TMDB page in Chromium', async ({ page }) => {
    await page.route('https://www.themoviedb.org/movie/27205-inception', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Inception (2010) - TMDB</title>
              <link rel="canonical" href="https://www.themoviedb.org/movie/27205-inception" />
            </head>
            <body>
              <div class="header_poster">
                <section class="header">
                  <div class="auto actions">
                    <ul class="shortcut_bar"></ul>
                  </div>
                </section>
              </div>
              <section class="social_links">
                <a href="https://www.imdb.com/title/tt1375666/" target="_blank">IMDb</a>
              </section>
            </body>
          </html>
        `,
      });
    });

    await page.addInitScript(() => {
      window.chrome = window.chrome || {};
      window.chrome.runtime = window.chrome.runtime || { sendMessage: () => {}, onMessage: { addListener: () => {} } };
      window.chrome.storage = window.chrome.storage || {
        local: {
          get: (keys, cb) => cb ? cb({}) : Promise.resolve({}),
          set: (data, cb) => cb ? cb() : Promise.resolve(),
        }
      };
      window.browser = window.chrome;
    });

    await page.goto('https://www.themoviedb.org/movie/27205-inception');

    const contentScript = fs.readFileSync(path.resolve(__dirname, '../../../extension/content.js'), 'utf-8');
    const torboxApiScript = fs.readFileSync(path.resolve(__dirname, '../../../extension/torbox_api.js'), 'utf-8');

    await page.addScriptTag({ content: torboxApiScript });
    await page.addScriptTag({ content: contentScript });

    const playBtn = page.locator('#torbox-play-btn');
    await expect(playBtn).toBeVisible({ timeout: 5000 });
  });
});
