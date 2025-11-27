import { describe, expect, it } from 'vitest';

const {
  ACCOUNT_PATTERNS,
  getPatternsForType,
  getKeywordsForType,
  getAllPatterns,
} = require('../investment-patterns-cjs.js');

describe('investment-patterns-cjs', () => {
  it('combines hebrew and english patterns for a type', () => {
    const patterns = getPatternsForType('brokerage');
    expect(patterns).toEqual(
      expect.arrayContaining(['ברוקר', 'interactive brokers', 'trading account']),
    );
    expect(patterns.every((p: string) => typeof p === 'string')).toBe(true);
  });

  it('returns keywords and empty arrays for unknown types', () => {
    expect(getKeywordsForType('savings')).toEqual(
      expect.arrayContaining(['פיקדון', 'pikadon']),
    );
    expect(getKeywordsForType('unknown')).toEqual([]);
    expect(getPatternsForType('unknown')).toEqual([]);
  });

  it('flattens all patterns with type annotations', () => {
    const all = getAllPatterns();
    expect(all.length).toBeGreaterThan(
      Object.keys(ACCOUNT_PATTERNS).length, // should have many entries per type
    );
    expect(all).toContainEqual(expect.objectContaining({ pattern: 'קופת גמל', type: 'study_fund' }));
    expect(all).toContainEqual(expect.objectContaining({ pattern: 'etf', type: 'mutual_fund' }));
  });
});
