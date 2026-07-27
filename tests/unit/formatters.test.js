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

  describe('Quality Distribution Logic', () => {
    it('should balance streams across 4K, 1080p, 720p buckets based on max per quality', () => {
      const mockStreams = [
        { title: '4K Stream 1', quality: '4K' },
        { title: '4K Stream 2', quality: '4K' },
        { title: '4K Stream 3', quality: '4K' },
        { title: '1080p Stream 1', quality: '1080p' },
        { title: '1080p Stream 2', quality: '1080p' },
        { title: '720p Stream 1', quality: '720p' },
      ];

      function distributeStreamsByQuality(streams, config = {}) {
        const defaultQualities = ["4K", "1080p", "720p", "480p"];
        const enabledQualities = config.enabled_qualities || defaultQualities;
        const maxPerQuality = parseInt(config.max_per_quality) || 2;
        const buckets = { "4K": [], "1080p": [], "720p": [], "480p": [], "Other": [] };
        for (const s of streams) {
          if (buckets[s.quality]) buckets[s.quality].push(s);
          else buckets["Other"].push(s);
        }
        const result = [];
        for (const q of defaultQualities) {
          if (enabledQualities.includes(q)) {
            result.push(...buckets[q].slice(0, maxPerQuality));
          }
        }
        return result;
      }

      const distributed = distributeStreamsByQuality(mockStreams, { max_per_quality: 2 });
      expect(distributed.filter(s => s.quality === '4K').length).toBe(2);
      expect(distributed.filter(s => s.quality === '1080p').length).toBe(2);
      expect(distributed.filter(s => s.quality === '720p').length).toBe(1);
    });
  });
});
