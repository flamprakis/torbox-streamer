import { test as base, chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

export const test = base.extend({
  context: async ({}, use) => {
    const rootDir = path.resolve(__dirname, '../../../');
    const chromeExtDir = path.resolve(rootDir, 'build/chrome-ext-unpacked');
    const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-chrome-'));

    const browserContext = await chromium.launchPersistentContext(tmpUserData, {
      headless: false,
      args: [
        `--disable-extensions-except=${chromeExtDir}`,
        `--load-extension=${chromeExtDir}`,
        '--no-sandbox',
        '--disable-gpu',
      ],
    });

    await use(browserContext);
    await browserContext.close();
    fs.rmSync(tmpUserData, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] || await context.newPage();
    await use(page);
  },
});

export { expect } from '@playwright/test';
