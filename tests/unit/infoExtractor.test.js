import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Extract regex and parsing helper logic from content.js for isolated unit testing

function extractTmdbTitleAndYear(pageTitle) {
  const titleMatch = pageTitle.match(/^(.+?)\s*\((?:TV\s*(?:Series|Mini\s*Series)\s*)?(\d{4})/);
  if (titleMatch) {
    return {
      title: titleMatch[1].trim(),
      year: parseInt(titleMatch[2]),
    };
  }
  return { title: '', year: null };
}

function parseSeasonAndEpisodeFromUrl(url) {
  const epMatch = url.match(/\/season\/(\d+)\/episode\/(\d+)/i);
  if (epMatch) {
    return {
      season: parseInt(epMatch[1]) || 1,
      episode: parseInt(epMatch[2]) || 1,
    };
  }
  return { season: 1, episode: 1 };
}

function cleanTitleForImdbSuggest(title) {
  if (!title) return '';
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, '_').replace(/^_+|_+$/g, '');
}

describe('Info Extractor Logic', () => {
  describe('TMDB Title & Year Parsing', () => {
    it('should parse movie title and release year from TMDB document title', () => {
      const result = extractTmdbTitleAndYear('Inception (2010) — The Movie Database (TMDB)');
      expect(result.title).toBe('Inception');
      expect(result.year).toBe(2010);
    });

    it('should parse TV series title and start year from TMDB document title', () => {
      const result = extractTmdbTitleAndYear('Breaking Bad (TV Series 2008-2013) — The Movie Database (TMDB)');
      expect(result.title).toBe('Breaking Bad');
      expect(result.year).toBe(2008);
    });

    it('should handle TV mini series titles correctly', () => {
      const result = extractTmdbTitleAndYear('Chernobyl (TV Mini Series 2019) — The Movie Database (TMDB)');
      expect(result.title).toBe('Chernobyl');
      expect(result.year).toBe(2019);
    });
  });

  describe('TMDB Season & Episode URL Parsing', () => {
    it('should parse season and episode numbers from TMDB TV episode URL', () => {
      const result = parseSeasonAndEpisodeFromUrl('https://www.themoviedb.org/tv/1396-breaking-bad/season/2/episode/5');
      expect(result.season).toBe(2);
      expect(result.episode).toBe(5);
    });

    it('should default to season 1 episode 1 if URL has no episode parameters', () => {
      const result = parseSeasonAndEpisodeFromUrl('https://www.themoviedb.org/tv/1396-breaking-bad');
      expect(result.season).toBe(1);
      expect(result.episode).toBe(1);
    });
  });

  describe('IMDb Suggestion Title Cleaner', () => {
    it('should format title strings for IMDb suggestion API endpoints', () => {
      expect(cleanTitleForImdbSuggest('Inception')).toBe('inception');
      expect(cleanTitleForImdbSuggest('Dune: Part Two')).toBe('dune_part_two');
      expect(cleanTitleForImdbSuggest('The Shawshank Redemption!')).toBe('the_shawshank_redemption');
    });
  });
});
