import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const apiCode = fs.readFileSync(path.resolve(__dirname, '../../extension/torbox_api.js'), 'utf-8');

const sandbox = {
  console,
  chrome: { storage: { local: { get: () => {}, set: () => {} } } },
  browser: { storage: { local: { get: () => {}, set: () => {} } } },
  fetch: globalThis.fetch,
};

vm.createContext(sandbox);
vm.runInContext(apiCode, sandbox);

const { humanSize } = sandbox;

describe('Formatters & Helpers', () => {
  describe('humanSize', () => {
    it('should format bytes to human readable string (GB / MB / B)', () => {
      expect(humanSize(1_073_741_824)).toBe('1.0 GB');
      expect(humanSize(524_288_000)).toBe('500.0 MB');
      expect(humanSize(0)).toBe('?');
    });
  });
});
