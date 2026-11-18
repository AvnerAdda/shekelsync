import { describe, expect, it } from 'vitest';
import { monthsAhead, startOfTrailingMonths } from '../month-window';

describe('month window', () => {
  it('starts a trailing month the day after the same date last month', () => {
    expect(startOfTrailingMonths(new Date(2026, 10, 18, 15))).toEqual(new Date(2026, 9, 19));
    expect(startOfTrailingMonths(new Date(2026, 10, 18, 15), 2)).toEqual(new Date(2026, 8, 19));
  });

  it('clamps month ends instead of counting 30 days', () => {
    expect(startOfTrailingMonths(new Date(2026, 2, 31))).toEqual(new Date(2026, 2, 1));
    expect(startOfTrailingMonths(new Date(2026, 2, 1))).toEqual(new Date(2026, 1, 2));
    expect(monthsAhead(new Date(2027, 0, 31))).toEqual(new Date(2027, 1, 28));
    expect(monthsAhead(new Date(2026, 10, 18))).toEqual(new Date(2026, 11, 18));
  });
});
