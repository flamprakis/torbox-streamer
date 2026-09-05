import globals from 'globals';

const sharedScriptGlobals = Object.fromEntries([
  'torboxCheckCached', 'torboxCreateTorrent', 'torboxWaitForReady', 'torboxGetDownloadUrl',
  'torboxGetTorrentList', 'torboxDeleteTorrent', 'autoPickFile', 'isBrowserPlayable',
  'parsePreferredLanguages', 'extractBundledSubtitles', 'fetchSubtitles',
  'parseSrtToVtt', 'parseAssToVtt', 'createVttBlobUrl', 'getLanguageLabel',
  'filterSubtitlesByLanguage', 'getFileExt', 'humanSize', 'getConfig', 'TORBOX_API',
].map(name => [name, 'readonly']));

export default [
  { ignores: ['build/**', 'coverage/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', globals: { ...globals.node, ...globals.browser, browser: 'readonly', chrome: 'readonly' } },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-func-assign': 'error',
      'no-const-assign': 'error',
      'no-unsafe-finally': 'error',
      'no-promise-executor-return': 'error',
      'valid-typeof': 'error',
      'constructor-super': 'error',
      'use-isnan': 'error',
    },
  },
  {
    files: ['extension/**/*.js', 'tests/e2e/**/*.js'],
    languageOptions: { globals: sharedScriptGlobals },
  },
];
