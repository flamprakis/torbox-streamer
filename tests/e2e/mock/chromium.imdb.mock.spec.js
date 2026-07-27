import { test, expect } from '../helpers/chromium.js';
import path from 'path';
import fs from 'fs';

const torrentioMock = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../mocks/torrentio.json'), 'utf-8'));
const torboxMock = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../mocks/torbox.json'), 'utf-8'));

test.describe('Chromium Offline IMDb Mocked Suite', () => {
  test('should inject action button and open stream modal in Chromium', async ({ page }) => {
    await page.route('https://www.imdb.com/title/tt0111161/', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `
          <!DOCTYPE html>
          <html>
            <head><title>The Shawshank Redemption (1994) - IMDb</title></head>
            <body>
              <ul class="ipc-inline-list">
                <li><span>Subnav</span></li>
              </ul>
              <h1>The Shawshank Redemption</h1>
            </body>
          </html>
        `,
      });
    });

    await page.route('https://torrentio.strem.fun/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(torrentioMock),
      });
    });

    await page.route('https://api.torbox.app/v1/api/torrents/checkcached*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(torboxMock),
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

    await page.goto('https://www.imdb.com/title/tt0111161/');

    const contentScript = fs.readFileSync(path.resolve(__dirname, '../../../extension/content.js'), 'utf-8');
    const torboxApiScript = fs.readFileSync(path.resolve(__dirname, '../../../extension/torbox_api.js'), 'utf-8');

    await page.addScriptTag({ content: torboxApiScript });
    await page.addScriptTag({ content: contentScript });

    const playBtn = page.locator('#torbox-play-btn');
    await expect(playBtn).toBeVisible({ timeout: 5000 });
    await expect(playBtn).toHaveText(/Play Now/i);

    await playBtn.click();

    const modalOverlay = page.locator('#torbox-modal-overlay');
    await expect(modalOverlay).toBeVisible({ timeout: 5000 });

    const optionsBtn = page.locator('#torbox-modal-options');
    await expect(optionsBtn).toBeVisible();
  });
});
