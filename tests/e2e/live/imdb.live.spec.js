import { test, expect } from '../helpers/firefox.js';

test.describe('IMDb Live Online Integration Suite', () => {
  test('should inject into live IMDb title page and load live streams', async ({ page }) => {
    await page.goto('https://www.imdb.com/title/tt1375666/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Handle cookie banner if present
    const cookieBtn = page.locator('button:has-text("Accept"), button:has-text("Decline")').first();
    if (await cookieBtn.isVisible().catch(() => false)) {
      await cookieBtn.click().catch(() => {});
    }

    // Verify extension injected button
    const injectedBtn = page.locator('#torbox-play-btn');
    await expect(injectedBtn).toBeVisible({ timeout: 15000 });

    // Click button to open modal
    await injectedBtn.click();

    // Verify modal overlay appears
    const modal = page.locator('#torbox-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 15000 });
  });
});
