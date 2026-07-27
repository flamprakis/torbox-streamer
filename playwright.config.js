import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'firefox-extension',
      testMatch: /.*firefox.*/,
      use: {
        ...devices['Desktop Firefox'],
        headless: true,
      },
    },
    {
      name: 'chromium-extension',
      testMatch: /.*chromium.*/,
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
  ],
});
