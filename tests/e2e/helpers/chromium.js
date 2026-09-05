import { test as base, chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

export const test = base.extend({
  context: async ({}, use, testInfo) => {
    const extensionPath = path.resolve(__dirname, '../../../build/chrome-ext-unpacked');
    if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
      throw new Error('Packaged extension is missing. Run npm run build before browser tests.');
    }
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      recordVideo: { dir: testInfo.outputPath('videos') },
    });
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
  extensionWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    // Fail if the background entry point or one of its imports failed to load.
    expect(await worker.evaluate(() => typeof getConfig)).toBe('function');
    expect(await worker.evaluate(() => typeof filterSubtitlesByLanguage)).toBe('function');
    await use(worker);
  },
  extensionId: async ({ extensionWorker }, use) => {
    await use(new URL(extensionWorker.url()).host);
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
  },
});

import { expect } from '@playwright/test';
export { expect };
