import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  makeCacheKey,
  normalizeBreakdownTypes,
} from '../useBreakdownData';

describe('useBreakdownData', () => {
  it('builds keyed initial state for all breakdown types', () => {
    expect(createInitialState(null)).toEqual({
      expense: null,
      income: null,
      investment: null,
    });

    expect(createInitialState(false)).toEqual({
      expense: false,
      income: false,
      investment: false,
    });
  });

  it('creates deterministic cache keys from type/date/locale', () => {
    const startDate = new Date('2025-02-01T00:00:00.000Z');
    const endDate = new Date('2025-02-28T00:00:00.000Z');

    const key = makeCacheKey('expense', startDate, endDate, 'en');
    expect(key).toContain('expense:');
    expect(key).toContain(':en');
    expect(key).toContain(startDate.toISOString());
    expect(key).toContain(endDate.toISOString());
  });

  it('normalizes requested types with defaults, dedupe, and filtering', () => {
    expect(normalizeBreakdownTypes()).toEqual(['expense', 'income']);
    expect(normalizeBreakdownTypes([])).toEqual([]);
    expect(
      normalizeBreakdownTypes(['income', 'income', 'investment'] as any),
    ).toEqual(['income', 'investment']);
    expect(
      normalizeBreakdownTypes(['income', 'unknown', 'expense'] as any),
    ).toEqual(['income', 'expense']);
  });
});
