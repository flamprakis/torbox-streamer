import { test as base, firefox } from '@playwright/test';
import path from 'path';

export const test = base.extend({
  context: async ({}, use) => {
    const extensionPath = path.resolve(__dirname, '../../../extension');
    const context = async () => {
      return await firefox.launchPersistentContext('', {
        headless: true,
        firefoxUserPrefs: {
          'xpinstall.signatures.required': false,
          'extensions.experiments.enabled': true,
        },
        args: [
          `--load-extension=${extensionPath}`,
        ],
      });
    };
    const browserContext = await context();
    await use(browserContext);
    await browserContext.close();
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
