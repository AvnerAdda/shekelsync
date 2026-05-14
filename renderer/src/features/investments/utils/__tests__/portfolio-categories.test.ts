import { describe, expect, it } from 'vitest';
import {
  INVESTMENT_CATEGORY_ORDER,
  normalizeInvestmentCategory,
} from '../portfolio-categories';

describe('portfolio category utilities', () => {
  it('includes illiquid in the display order', () => {
    expect(INVESTMENT_CATEGORY_ORDER).toEqual([
      'cash',
      'liquid',
      'illiquid',
      'restricted',
      'stability',
      'other',
    ]);
  });

  it('normalizes real estate account types to illiquid', () => {
    expect(normalizeInvestmentCategory('liquid', 'real_estate')).toBe('illiquid');
    expect(normalizeInvestmentCategory(null, 'real_estate')).toBe('illiquid');
  });
});
