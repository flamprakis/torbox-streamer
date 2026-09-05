import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const files = Object.fromEntries(['options.html', 'options.js', 'options.css'].map(name => [name, fs.readFileSync(path.resolve('extension/options', name), 'utf8')]));

async function loadOptions(page, { config = {}, mode = 'promise', readError = '', writeError = '' } = {}) {
  await page.route('**/*', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({ status: files[name] ? 200 : 404, contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: files[name] || '' });
  });
  await page.addInitScript(({ config, mode, readError, writeError }) => {
    window.__options = { writes: [], readError, writeError };
    const read = () => JSON.parse(localStorage.getItem('test-extension-settings') || JSON.stringify(config));
    const write = values => {
      window.__options.writes.push(structuredClone(values));
      if (!window.__options.writeError) localStorage.setItem('test-extension-settings', JSON.stringify({ ...read(), ...values }));
    };
    if (mode === 'promise') {
      window.browser = { storage: { local: {
        get: async () => { if (window.__options.readError) throw new Error(window.__options.readError); return read(); },
        set: async values => { write(values); if (window.__options.writeError) throw new Error(window.__options.writeError); },
      } } };
    } else {
      window.browser = undefined;
      window.chrome = { runtime: {}, storage: { local: {
        get: (keys, callback) => {
          window.chrome.runtime.lastError = window.__options.readError ? { message: window.__options.readError } : undefined;
          callback(window.__options.readError ? undefined : read());
          delete window.chrome.runtime.lastError;
        },
        set: (values, callback) => {
          write(values);
          window.chrome.runtime.lastError = window.__options.writeError ? { message: window.__options.writeError } : undefined;
          callback();
          delete window.chrome.runtime.lastError;
        },
      } } };
    }
  }, { config, mode, readError, writeError });
  await page.goto('https://settings.example.test/options/options.html');
}

test.describe('Options UI: production form, dropdowns and storage contracts', () => {
  let errors = [];
  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', error => errors.push(error.message));
  });
  test.afterEach(() => expect(errors, 'No uncaught exceptions during settings interaction').toEqual([]));

  for (const mode of ['promise', 'callback']) {
    test(`populates all choices and persists all settings across reload using ${mode} storage`, async ({ page }) => {
      await loadOptions(page, { mode });
      await expect(page.getByRole('button', { name: 'Save Settings' })).toBeEnabled();
      expect(await page.getByRole('combobox', { name: 'Preferred Player' }).locator('option').evaluateAll(options => options.map(option => option.value)))
        .toEqual(['auto', 'ask', 'browser', 'mpv', 'vlc']);
      await expect(page.getByRole('combobox', { name: 'Quality Filter Mode' }).locator('option')).toHaveText([
        'Balanced Quality Mix (Recommended)', '4K / 2160p Only', '1080p Only', '720p Only', '480p / SD Only',
      ]);
      await page.getByLabel('TorBox API Key', { exact: true }).fill('  fixture-key  ');
      await page.getByLabel('Preferred Player').selectOption('vlc');
      await page.getByLabel('Custom MPV Path (Optional)').fill(' /opt/mpv ');
      await page.getByLabel('Custom VLC Path (Optional)').fill(' /opt/vlc ');
      await page.getByLabel('Torrentio Base URL').fill('https://torrentio.example.test/config/');
      await page.getByLabel('Quality Filter Mode').selectOption('1080p');
      await page.getByRole('checkbox', { name: '4K', exact: true }).uncheck();
      await page.getByRole('checkbox', { name: '480p/SD', exact: true }).uncheck();
      await page.getByLabel('Max links per resolution bucket:').fill('8');
      await page.getByLabel('Preferred Subtitle Languages').fill(' en, de ');
      await page.getByLabel('Max Results').fill('40');
      await page.getByRole('button', { name: 'Save Settings' }).click();
      await expect(page.getByRole('status')).toHaveText('Saved!');
      expect(await page.evaluate(() => window.__options.writes)).toEqual([{
        torbox_api_key: 'fixture-key', player_preference: 'vlc', default_quality_filter: '1080p',
        enabled_qualities: ['1080p', '720p'], max_per_quality: 8, mpv_path: '/opt/mpv', vlc_path: '/opt/vlc',
        torrentio_base_url: 'https://torrentio.example.test/config', subtitle_languages: 'en, de', max_results: 40,
      }]);
      await page.reload();
      await expect(page.getByRole('button', { name: 'Save Settings' })).toBeEnabled();
      await expect(page.getByLabel('TorBox API Key', { exact: true })).toHaveValue('fixture-key');
      await expect(page.getByLabel('Preferred Player')).toHaveValue('vlc');
      await expect(page.getByLabel('Quality Filter Mode')).toHaveValue('1080p');
      await expect(page.getByRole('checkbox', { name: '4K', exact: true })).not.toBeChecked();
      await expect(page.getByRole('checkbox', { name: '1080p', exact: true })).toBeChecked();
      await expect(page.getByLabel('Max Results')).toHaveValue('40');
      await expect(page.getByLabel('Max links per resolution bucket:')).toHaveValue('8');
    });

    test(`surfaces ${mode} storage write errors, preserves the form and allows retry`, async ({ page }) => {
      await loadOptions(page, { mode, writeError: 'Storage quota exceeded' });
      await page.getByLabel('TorBox API Key', { exact: true }).fill('unsaved-key');
      await page.getByRole('button', { name: 'Save Settings' }).click();
      await expect(page.getByRole('status')).toHaveText('Could not save settings: Storage quota exceeded');
      await expect(page.getByRole('status')).not.toHaveClass('success');
      await expect(page.getByRole('button', { name: 'Save Settings' })).toBeEnabled();
      await expect(page.getByLabel('TorBox API Key', { exact: true })).toHaveValue('unsaved-key');
      expect(await page.evaluate(() => localStorage.getItem('test-extension-settings'))).toBeNull();
      await page.evaluate(() => { window.__options.writeError = ''; });
      await page.getByRole('button', { name: 'Save Settings' }).click();
      await expect(page.getByRole('status')).toHaveText('Saved!');
    });

    test(`surfaces ${mode} read errors and prevents overwriting settings that failed to load`, async ({ page }) => {
      await loadOptions(page, { mode, readError: 'Storage unavailable' });
      await expect(page.getByRole('status')).toContainText('Could not load settings: Storage unavailable');
      await expect(page.getByRole('button', { name: 'Save Settings' })).toBeDisabled();
      expect(await page.evaluate(() => window.__options.writes)).toEqual([]);
    });
  }

  test('uses populated defaults for stale dropdown values and invalid stored limits', async ({ page }) => {
    await loadOptions(page, { config: {
      player_preference: 'removed-player', default_quality_filter: '8K', enabled_qualities: 'wrong-type',
      max_results: -5, max_per_quality: 999,
    } });
    await expect(page.getByLabel('Preferred Player')).toHaveValue('auto');
    await expect(page.getByLabel('Quality Filter Mode')).toHaveValue('all');
    await expect(page.getByLabel('Max Results')).toHaveValue('20');
    await expect(page.getByLabel('Max links per resolution bucket:')).toHaveValue('5');
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(4);
  });

  test('rejects out-of-range, fractional and empty limits without writing storage', async ({ page }) => {
    await loadOptions(page);
    for (const [label, invalid, valid] of [
      ['Max Results', '4', '20'], ['Max Results', '101', '20'], ['Max Results', '5.5', '20'], ['Max Results', '', '20'],
      ['Max links per resolution bucket:', '0', '5'], ['Max links per resolution bucket:', '26', '5'], ['Max links per resolution bucket:', '1.5', '5'],
    ]) {
      await page.getByLabel(label, { exact: true }).fill(invalid);
      await page.getByRole('button', { name: 'Save Settings' }).click();
      expect(await page.getByLabel(label, { exact: true }).evaluate(input => input.validity.valid)).toBe(false);
      expect(await page.evaluate(() => window.__options.writes)).toEqual([]);
      await page.getByLabel(label, { exact: true }).fill(valid);
    }
  });

  test('rejects unsafe or unsupported Torrentio URLs without storing them', async ({ page }) => {
    await loadOptions(page);
    for (const value of ['javascript:alert(1)', 'ftp://torrentio.test', 'https://user:secret@torrentio.test', 'https://torrentio.test/?query=x', 'https://torrentio.test/#fragment']) {
      await page.getByLabel('Torrentio Base URL').fill(value);
      await page.getByRole('button', { name: 'Save Settings' }).click();
      await expect(page.getByRole('status')).toContainText('Enter an HTTP or HTTPS Torrentio URL');
      expect(await page.evaluate(() => window.__options.writes)).toEqual([]);
    }
  });

  test('prevents empty quality selections and contradictory fixed filters', async ({ page }) => {
    await loadOptions(page);
    for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.uncheck();
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect(page.getByRole('status')).toHaveText('Select at least one included resolution.');
    expect(await page.evaluate(() => window.__options.writes)).toEqual([]);
    await page.getByRole('checkbox', { name: '720p', exact: true }).check();
    await page.getByLabel('Quality Filter Mode').selectOption('1080p');
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect(page.getByRole('status')).toHaveText('Include the resolution selected by your quality filter.');
    expect(await page.evaluate(() => window.__options.writes)).toEqual([]);
    await page.getByRole('checkbox', { name: '1080p', exact: true }).check();
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved!');
  });

  test('toggles API key visibility without submitting the form and supports Enter to save', async ({ page }) => {
    await loadOptions(page);
    const key = page.getByLabel('TorBox API Key', { exact: true });
    await key.fill('fixture-key');
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await expect(key).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(key).toHaveAttribute('type', 'password');
    expect(await page.evaluate(() => window.__options.writes)).toEqual([]);
    await key.press('Enter');
    await expect(page.getByRole('status')).toHaveText('Saved!');
  });
});
