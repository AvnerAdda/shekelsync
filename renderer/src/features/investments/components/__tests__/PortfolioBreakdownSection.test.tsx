import { describe, expect, it } from 'vitest';
import {
  calculatePortfolioRoi,
  getPortfolioAccountColor,
  PORTFOLIO_CHART_COLORS,
  resolvePortfolioInstitutionName,
} from '../portfolio-breakdown-helpers';

describe('PortfolioBreakdownSection helpers', () => {
  it('calculates ROI and guards against zero cost basis', () => {
    expect(calculatePortfolioRoi(1200, 1000)).toBeCloseTo(20, 6);
    expect(calculatePortfolioRoi(900, 1000)).toBeCloseTo(-10, 6);
    expect(calculatePortfolioRoi(900, 0)).toBe(0);
  });

  it('resolves account colors by ordered account index', () => {
    const orderedAccounts = [{ id: 10 }, { id: 20 }, { id: 30 }];

    expect(getPortfolioAccountColor(orderedAccounts, 10, '#999999')).toBe(
      PORTFOLIO_CHART_COLORS[0],
    );
    expect(getPortfolioAccountColor(orderedAccounts, 30, '#999999')).toBe(
      PORTFOLIO_CHART_COLORS[2],
    );
    expect(getPortfolioAccountColor(orderedAccounts, 999, '#999999')).toBe('#999999');
  });

  it('resolves institution names from strings, localized objects, and fallback vendor codes', () => {
    expect(resolvePortfolioInstitutionName(null, 'en')).toBe('');
    expect(resolvePortfolioInstitutionName('Direct Name', 'en')).toBe('Direct Name');

    expect(
      resolvePortfolioInstitutionName(
        {
          id: 1,
          vendor_code: 'demo_bank',
          display_name_he: 'דמו בנק',
          display_name_en: 'Demo Bank',
          institution_type: 'bank',
        },
        'en',
      ),
    ).toBe('Demo Bank');

    expect(
      resolvePortfolioInstitutionName(
        {
          id: 2,
          vendor_code: 'fallback_vendor',
          display_name_he: '',
          display_name_en: '',
          institution_type: 'bank',
        },
        'en',
      ),
    ).toBe('fallback_vendor');
  });
});
