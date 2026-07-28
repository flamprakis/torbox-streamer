import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// Load torbox_api.js into VM sandbox to export autoPickFile and helper functions without modifying production source
const apiCode = fs.readFileSync(path.resolve(__dirname, '../../extension/torbox_api.js'), 'utf-8');

const sandbox = {
  console,
  chrome: { storage: { local: { get: () => {}, set: () => {} } } },
  browser: { storage: { local: { get: () => {}, set: () => {} } } },
  fetch: globalThis.fetch,
};

vm.createContext(sandbox);
vm.runInContext(apiCode, sandbox);

const { autoPickFile, isVideoFile, getFileExt } = sandbox;

describe('File Selection Algorithm (autoPickFile)', () => {
  it('should return null for empty file lists', () => {
    expect(autoPickFile([], null, null, null)).toBeNull();
    expect(autoPickFile(null, null, null, null)).toBeNull();
  });

  it('should pick single video file in single-file torrents', () => {
    const files = [{ id: 1, name: 'Inception.2010.1080p.mkv', size: 2_000_000_000 }];
    expect(autoPickFile(files)).toEqual(files[0]);
  });

  it('should ignore non-video files (.nfo, .txt, .srt) in single file torrents', () => {
    const files = [{ id: 1, name: 'instructions.txt', size: 1_000 }];
    expect(autoPickFile(files)).toBeNull();
  });

  it('should match Tier 1 S01E05 standard episode naming in season packs', () => {
    const files = [
      { id: 1, name: 'Show.S01E01.720p.mkv', size: 500_000_000 },
      { id: 2, name: 'Show.S01E05.720p.mkv', size: 500_000_000 },
      { id: 3, name: 'Show.S01E10.720p.mkv', size: 500_000_000 },
    ];
    const picked = autoPickFile(files, null, 1, 5);
    expect(picked).toBeDefined();
    expect(picked.name).toBe('Show.S01E05.720p.mkv');
  });

  it('should match single-digit S1E5 notation', () => {
    const files = [
      { id: 1, name: 'Breaking.Bad.S1E1.mkv', size: 500_000_000 },
      { id: 2, name: 'Breaking.Bad.S1E5.mkv', size: 500_000_000 },
    ];
    const picked = autoPickFile(files, null, 1, 5);
    expect(picked.name).toBe('Breaking.Bad.S1E5.mkv');
  });

  it('should match Tier 1 episode naming formatted as 01x05 or 1x5', () => {
    const files = [
      { id: 1, name: 'Show 01x01.avi', size: 700_000_000 },
      { id: 2, name: 'Show 01x05.avi', size: 700_000_000 },
      { id: 3, name: 'Show 1x05.avi', size: 700_000_000 },
    ];
    expect(autoPickFile(files, null, 1, 5).name).toBe('Show 01x05.avi');
  });

  it('should match dot and underscore separators (S04.E02, S03_E09)', () => {
    const dotFiles = [
      { id: 1, name: 'GOT.S04.E01.mkv', size: 1_000_000_000 },
      { id: 2, name: 'GOT.S04.E02.mkv', size: 1_000_000_000 },
    ];
    expect(autoPickFile(dotFiles, null, 4, 2).name).toBe('GOT.S04.E02.mkv');

    const underscoreFiles = [
      { id: 1, name: 'Office.S03_E01.mkv', size: 400_000_000 },
      { id: 2, name: 'Office.S03_E09.mkv', size: 400_000_000 },
    ];
    expect(autoPickFile(underscoreFiles, null, 3, 9).name).toBe('Office.S03_E09.mkv');
  });

  it('should correctly resolve nested folder path structures (e.g. Season 2/Episode 03)', () => {
    const files = [
      { id: 1, name: 'Season 2/Episode 01 - Pilot.mkv', size: 400_000_000 },
      { id: 2, name: 'Season 2/Episode 03 - Crisis.mkv', size: 400_000_000 },
      { id: 3, name: 'Season 2/Episode 05 - Finale.mkv', size: 400_000_000 },
    ];
    const picked = autoPickFile(files, null, 2, 3);
    expect(picked.name).toBe('Season 2/Episode 03 - Crisis.mkv');
  });

  it('should match numbered episode inside season directory (e.g. Season 04/05 - The Contest.mkv)', () => {
    const files = [
      { id: 1, name: 'Seinfeld Complete/Season 04/01 - The Trip.mkv', size: 300_000_000 },
      { id: 2, name: 'Seinfeld Complete/Season 04/05 - The Contest.mkv', size: 300_000_000 },
    ];
    const picked = autoPickFile(files, null, 4, 5);
    expect(picked.name).toBe('Seinfeld Complete/Season 04/05 - The Contest.mkv');
  });

  it('should match multi-episode release range S01E05-E06', () => {
    const files = [
      { id: 1, name: 'Show.S01E01-E02.mkv', size: 900_000_000 },
      { id: 2, name: 'Show.S01E05-E06.mkv', size: 900_000_000 },
    ];
    expect(autoPickFile(files, null, 1, 5).name).toBe('Show.S01E05-E06.mkv');
  });

  it('should match anime naming conventions ([SubGroup] Title S02 - 05 [1080p])', () => {
    const files = [
      { id: 1, name: '[SubsPlease] Show S02 - 01 (1080p) [123].mkv', size: 500_000_000 },
      { id: 2, name: '[SubsPlease] Show S02 - 05 (1080p) [123].mkv', size: 500_000_000 },
    ];
    expect(autoPickFile(files, null, 2, 5).name).toBe('[SubsPlease] Show S02 - 05 (1080p) [123].mkv');
  });

  it('should match 3-digit episode numbers (S01E105)', () => {
    const files = [
      { id: 1, name: '[Group] Anime - S01E101 [1080p].mkv', size: 500_000_000 },
      { id: 2, name: '[Group] Anime - S01E105 [1080p].mkv', size: 500_000_000 },
    ];
    expect(autoPickFile(files, null, 1, 105).name).toBe('[Group] Anime - S01E105 [1080p].mkv');
  });

  it('should filter out sample video files when real episode file is present', () => {
    const files = [
      { id: 1, name: 'Show.S01E05.Sample.mkv', size: 20_000_000 },
      { id: 2, name: 'Show.S01E05.1080p.mkv', size: 800_000_000 },
    ];
    expect(autoPickFile(files, null, 1, 5).name).toBe('Show.S01E05.1080p.mkv');
  });

  it('should prioritize target season over wrong season in multi-season packs', () => {
    const files = [
      { id: 1, name: 'Show.S01E05.1080p.mkv', size: 1_000_000_000 },
      { id: 2, name: 'Show.S02E05.1080p.mkv', size: 1_000_000_000 },
      { id: 3, name: 'Show.S03E05.1080p.mkv', size: 1_000_000_000 },
    ];
    const picked = autoPickFile(files, null, 2, 5);
    expect(picked.name).toBe('Show.S02E05.1080p.mkv');
  });

  it('should select exact episode in complete series pack containing 30+ files across 3 seasons', () => {
    const files = Array.from({ length: 30 }, (_, i) => {
      const season = Math.floor(i / 10) + 1;
      const ep = (i % 10) + 1;
      const sp = String(season).padStart(2, '0');
      const epStr = String(ep).padStart(2, '0');
      return { id: i + 1, name: `Series.Name.S${sp}E${epStr}.1080p.WEB-DL.mkv`, size: 500_000_000 };
    });
    const picked = autoPickFile(files, null, 3, 7);
    expect(picked.name).toBe('Series.Name.S03E07.1080p.WEB-DL.mkv');
  });

  it('should enforce word boundaries to avoid false positives (e.g. e05 inside release05)', () => {
    const files = [
      { id: 1, name: 'release05_bonus.mkv', size: 100_000_000 },
      { id: 2, name: 'Show.S01E05.mkv', size: 500_000_000 },
    ];
    const picked = autoPickFile(files, null, 1, 5);
    expect(picked.name).toBe('Show.S01E05.mkv');
  });

  it('should match movie title keywords in multi-file movie collection packs (e.g. IMDb Top 250)', () => {
    const files = [
      { id: 1, name: 'IMDB Top 250/001 The Shawshank Redemption (1994)/The.Shawshank.Redemption.1994.REMASTERED.1080p.BluRay.x265-RARBG.mp4', size: 2_220_000_000 },
      { id: 2, name: 'IMDB Top 250/002 The Godfather (1972)/The.Godfather.1972.1080p.BluRay.mp4', size: 3_500_000_000 },
      { id: 3, name: 'IMDB Top 250/003 The Dark Knight (2008)/The.Dark.Knight.2008.1080p.BluRay.mp4', size: 4_200_000_000 },
    ];

    const picked = autoPickFile(files, null, null, null, "The Shawshank Redemption (1994)");
    expect(picked).toBeDefined();
    expect(picked.id).toBe(1);
    expect(picked.name).toContain("Shawshank.Redemption");
  });

  it('should fall back to largest video file if no season/episode or title pattern matches', () => {
    const files = [
      { id: 1, name: 'Sample.mkv', size: 50_000_000 },
      { id: 2, name: 'Movie.2024.1080p.mkv', size: 4_500_000_000 },
      { id: 3, name: 'Movie.2024.720p.mkv', size: 1_500_000_000 },
    ];
    const picked = autoPickFile(files);
    expect(picked.name).toBe('Movie.2024.1080p.mkv');
  });
});
