import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const torrentioMock = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../mocks/torrentio.json'), 'utf-8'));
const torboxMock = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../mocks/torbox.json'), 'utf-8'));

test.describe('TMDB Offline Mocked Extension Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://www.themoviedb.org/movie/27205-inception', route => {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Inception (2010) — The Movie Database (TMDB)</title>
            </head>
            <body>
              <ul class="auto actions">
                <li><a href="#">Action 1</a></li>
              </ul>
            </body>
          </html>
        `
      });
    });

    await page.route('https://v3.sg.media-imdb.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          d: [
            { id: 'tt1375666', l: 'Inception', y: 2010, q: 'feature' }
          ]
        })
      });
    });

    await page.route('https://torrentio.strem.fun/**', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(torrentioMock) });
    });

    await page.route('https://api.torbox.app/v1/api/torrents/checkcached**', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(torboxMock) });
    });
  });

  test('should inject action button on TMDB page and resolve IMDb ID', async ({ page }) => {
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

    const tmdbBtn = page.locator('#torbox-play-btn');
    await expect(tmdbBtn).toBeVisible({ timeout: 5000 });
    await expect(tmdbBtn).toHaveText(/Stream with TorBox/i);
  });
});
