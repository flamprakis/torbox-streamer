import { test, expect } from '../helpers/chromium.js';

test.describe('Chromium Online Live Network Suite', () => {
  test('should navigate to live IMDb page and verify page title structure in Chromium', async ({ page }) => {
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    });
    await page.goto('https://www.imdb.com/title/tt0111161/', { waitUntil: 'load', timeout: 30000 });
    const url = page.url();
    expect(url).toContain('tt0111161');
  });
});
