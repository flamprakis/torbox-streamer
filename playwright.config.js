import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/online/**', '**/live/**'],
  timeout: 30000,
  expect: { timeout: 7000 },
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  // A retry must not turn an intermittent regression into a green quality gate.
  retries: 0,
  workers: process.env.CI ? 2 : 1,
  reporter: [['html', { open: 'never' }], ['list'], ['junit', { outputFile: 'test-results/browser-results.xml' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium-dom',
      testMatch: /mock\/(ui\.|runtime\.).*\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox-dom',
      testMatch: /mock\/(ui\.|runtime\.).*\.spec\.js/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'chromium-extension',
      testMatch: /extension\/.*\.spec\.js/,
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
});
