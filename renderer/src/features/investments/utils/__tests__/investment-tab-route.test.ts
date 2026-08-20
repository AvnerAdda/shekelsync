import { describe, expect, it } from 'vitest';
import { resolveInvestmentTabFromSearch } from '../investment-tab-route';

describe('resolveInvestmentTabFromSearch', () => {
  it.each([
    ['?tab=overview', 0],
    ['?tab=holdings', 1],
    ['?tab=real-estate', 2],
    ['?tab=performance', 3],
    ['?tab=history', 4],
  ])('maps %s to investment tab %i', (search, expected) => {
    expect(resolveInvestmentTabFromSearch(search)).toBe(expected);
  });

  it('ignores absent and unknown tabs', () => {
    expect(resolveInvestmentTabFromSearch('')).toBeNull();
    expect(resolveInvestmentTabFromSearch('?tab=unknown')).toBeNull();
  });
});
