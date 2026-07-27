import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const torrentioMock = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../mocks/torrentio.json'), 'utf-8'));
const torboxMock = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../mocks/torbox.json'), 'utf-8'));

test.describe('IMDb Offline Mocked Extension Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://www.imdb.com/title/tt1375666/', route => {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Inception (2010) - IMDb</title>
              <link rel="canonical" href="https://www.imdb.com/title/tt1375666/" />
            </head>
            <body>
              <ul class="ipc-inline-list">
                <li><span>Subnav</span></li>
              </ul>
              <h1>Inception</h1>
            </body>
          </html>
        `
      });
    });

    await page.route('https://torrentio.strem.fun/**', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(torrentioMock) });
    });

    await page.route('https://api.torbox.app/v1/api/torrents/checkcached**', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(torboxMock) });
    });
  });

  test('should render extension injected button and stream list modal', async ({ page }) => {
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

    await page.goto('https://www.imdb.com/title/tt1375666/');

    const contentScript = fs.readFileSync(path.resolve(__dirname, '../../../extension/content.js'), 'utf-8');
    const torboxApiScript = fs.readFileSync(path.resolve(__dirname, '../../../extension/torbox_api.js'), 'utf-8');

    await page.addScriptTag({ content: torboxApiScript });
    await page.addScriptTag({ content: contentScript });

    // Verify injected button exists
    const injectedBtn = page.locator('#torbox-play-btn');
    await expect(injectedBtn).toBeVisible({ timeout: 5000 });
    await expect(injectedBtn).toHaveText(/Play Now/i);

    // Click button to open modal
    await injectedBtn.click();

    // Verify modal overlay appears
    const modal = page.locator('#torbox-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify Title Header in modal
    const header = page.locator('#torbox-modal-header h3');
    await expect(header).toBeVisible({ timeout: 5000 });
  });
});
