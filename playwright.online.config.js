import { defineConfig, devices } from '@playwright/test';

// Opt-in live site compatibility checks. No TorBox credentials or downloads.
export default defineConfig({
  testDir: './tests/e2e/online',
  testMatch: /chromium\.online\.spec\.js/,
  timeout: 45000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
