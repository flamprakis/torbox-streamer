import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Browser tests own content/options/player UI coverage. This gate covers
      // the extension's API and background modules executed by source tests.
      include: ['extension/background.js', 'extension/torbox_api.js', 'extension/subtitles_api.js'],
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 70,
        lines: 75,
      },
    },
  },
});
