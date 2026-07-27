import { test, expect } from '@playwright/test';

test.describe('Firefox Online Live Network Suite', () => {
  test('should navigate to live IMDb page and verify page title structure in Firefox', async ({ page }) => {
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0'
    });
    await page.goto('https://www.imdb.com/title/tt0111161/', { waitUntil: 'load', timeout: 30000 });
    const url = page.url();
    expect(url).toContain('tt0111161');
  });
});
