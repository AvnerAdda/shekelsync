import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  calculateSimilarity,
  matchAccount,
  buildSQLPatterns,
  detectAccountType,
} from '../account-matcher.js';

describe('account-matcher', () => {
  describe('normalizeText', () => {
    it('returns empty string for falsy input', () => {
      expect(normalizeText(null)).toBe('');
      expect(normalizeText(undefined)).toBe('');
      expect(normalizeText('')).toBe('');
    });

    it('lowercases and trims', () => {
      expect(normalizeText('  HELLO  ')).toBe('hello');
    });

    it('normalizes Hebrew final letter forms', () => {
      // ם -> מ, ן -> נ, ץ -> צ, ף -> פ, ך -> כ
      expect(normalizeText('שלום')).toContain('מ');
      expect(normalizeText('חשבון')).toContain('נ');
    });

    it('removes Hebrew nikud (vowel marks)', () => {
      const withNikud = 'שָׁלוֹם';
      const result = normalizeText(withNikud);
      expect(result).not.toMatch(/[\u0591-\u05C7]/);
    });

    it('removes quotes and apostrophes', () => {
      expect(normalizeText('"hello"')).toBe('hello');
      expect(normalizeText("it's")).toBe('its');
    });

    it('normalizes punctuation to spaces', () => {
      expect(normalizeText('a.b-c/d')).toBe('a b c d');
    });

    it('collapses multiple spaces', () => {
      expect(normalizeText('a   b   c')).toBe('a b c');
    });
  });

  describe('calculateSimilarity', () => {
    it('returns 0 for empty inputs', () => {
      expect(calculateSimilarity('', 'hello')).toBe(0);
      expect(calculateSimilarity('hello', '')).toBe(0);
      expect(calculateSimilarity(null, 'hello')).toBe(0);
    });

    it('returns 1.0 for exact match after normalization', () => {
      expect(calculateSimilarity('Hello', 'hello')).toBe(1.0);
      expect(calculateSimilarity('  hello  ', 'hello')).toBe(1.0);
    });

    it('returns high score when one contains the other', () => {
      const score = calculateSimilarity('supermarket', 'super');
      expect(score).toBeGreaterThan(0.4);
      expect(score).toBeLessThanOrEqual(0.9);
    });

    it('returns score for word overlap', () => {
      const score = calculateSimilarity('savings account bank', 'bank savings');
      expect(score).toBeGreaterThan(0.5);
    });

    it('returns 0 for completely different strings', () => {
      expect(calculateSimilarity('xyz', 'abc')).toBe(0);
    });

    it('handles close matches via Levenshtein', () => {
      const score = calculateSimilarity('kitten', 'kittens');
      expect(score).toBeGreaterThan(0.6);
    });
  });

  describe('matchAccount', () => {
    it('returns no match for unrecognized account name and type', () => {
      const result = matchAccount('random gibberish account', 'nonexistent_type');
      expect(result.match).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('returns match result with transactions array', () => {
      const transactions = ['savings deposit', 'checking withdrawal', 'unknown'];
      const result = matchAccount('savings', 'savings', transactions);
      expect(result).toHaveProperty('matchCount');
      expect(result).toHaveProperty('matches');
      expect(result.accountName).toBe('savings');
      expect(result.accountType).toBe('savings');
    });

    it('handles string transactions in array', () => {
      const result = matchAccount('test', 'savings', ['test transaction']);
      expect(result).toHaveProperty('matchCount');
    });

    it('handles object transactions with name property', () => {
      const result = matchAccount('test', 'savings', [{ name: 'test transaction' }]);
      expect(result).toHaveProperty('matchCount');
    });
  });

  describe('buildSQLPatterns', () => {
    it('returns array of LIKE patterns', () => {
      const patterns = buildSQLPatterns('savings');
      expect(Array.isArray(patterns)).toBe(true);
      for (const p of patterns) {
        expect(p.startsWith('%')).toBe(true);
        expect(p.endsWith('%')).toBe(true);
      }
    });

    it('returns empty array for unknown type', () => {
      const patterns = buildSQLPatterns('nonexistent_type');
      expect(Array.isArray(patterns)).toBe(true);
    });
  });

  describe('detectAccountType', () => {
    it('returns null for unrecognizable names', () => {
      expect(detectAccountType('xyzzy random')).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(detectAccountType('')).toBeNull();
      expect(detectAccountType(null)).toBeNull();
    });
  });
});
