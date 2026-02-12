import { describe, expect, it } from 'vitest';
import {
  BREAKDOWN_CACHE_TTL_MS,
  makeCacheKey,
  normalizeBreakdownTypes,
} from '../useBreakdownData';

describe('useBreakdownData cache helpers', () => {
  it('uses a 60-second cache TTL', () => {
    expect(BREAKDOWN_CACHE_TTL_MS).toBe(60_000);
  });

  it('builds distinct cache keys when locale or date range changes', () => {
    const startA = new Date('2025-04-01T00:00:00.000Z');
    const endA = new Date('2025-04-30T00:00:00.000Z');
    const startB = new Date('2025-05-01T00:00:00.000Z');
    const endB = new Date('2025-05-31T00:00:00.000Z');

    const base = makeCacheKey('expense', startA, endA, 'en');
    const localeChanged = makeCacheKey('expense', startA, endA, 'fr');
    const rangeChanged = makeCacheKey('expense', startB, endB, 'en');

    expect(base).not.toBe(localeChanged);
    expect(base).not.toBe(rangeChanged);
  });

  it('retains requested type order while removing invalid entries', () => {
    const normalized = normalizeBreakdownTypes(['investment', 'income', 'bad', 'expense'] as any);
    expect(normalized).toEqual(['investment', 'income', 'expense']);
  });
});
