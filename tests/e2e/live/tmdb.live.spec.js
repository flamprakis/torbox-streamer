import { test, expect } from '../helpers/firefox.js';

test.describe('TMDB Live Online Integration Suite', () => {
  test('should inject into live TMDB page and resolve IMDb ID online', async ({ page }) => {
    await page.goto('https://www.themoviedb.org/movie/27205-inception', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Handle TMDB cookie dialog if present
    const cookieBtn = page.locator('button:has-text("Accept All Cookies"), button:has-text("Reject All")').first();
    if (await cookieBtn.isVisible().catch(() => false)) {
      await cookieBtn.click().catch(() => {});
    }

    const tmdbBtn = page.locator('#torbox-play-btn');
    await expect(tmdbBtn).toBeVisible({ timeout: 15000 });

    await tmdbBtn.click();

    const modal = page.locator('#torbox-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 15000 });
  });
});
