import { describe, expect, it } from 'vitest';
import {
  buildDashboardTopCategories,
  getDashboardCategoryCount,
  hasDashboardSummaryActivity,
} from '../dashboard-summary-helpers';

describe('DashboardSummarySection helpers', () => {
  it('detects whether summary has any transaction activity', () => {
    expect(hasDashboardSummaryActivity(undefined)).toBe(false);
    expect(hasDashboardSummaryActivity({})).toBe(false);
    expect(hasDashboardSummaryActivity({ totalIncome: 100 })).toBe(true);
    expect(hasDashboardSummaryActivity({ totalExpenses: -50 })).toBe(true);
    expect(hasDashboardSummaryActivity({ netInvestments: 10 })).toBe(true);
    expect(hasDashboardSummaryActivity({ totalCapitalReturns: 5 })).toBe(true);
  });

  it('builds top categories from breakdown data or fallback expenses', () => {
    expect(
      buildDashboardTopCategories(
        {
          expense: {
            breakdowns: [
              { name: 'Rent', value: 3000 },
              { name: 'Groceries', value: 900 },
              { name: 'Transport', value: 400 },
              { name: 'Dining', value: 250 },
            ],
          },
        },
        0,
        'Total Expenses',
      ),
    ).toEqual([
      { name: 'Rent', amount: 3000 },
      { name: 'Groceries', amount: 900 },
      { name: 'Transport', amount: 400 },
    ]);

    expect(
      buildDashboardTopCategories({}, 1200, 'Total Expenses'),
    ).toEqual([{ name: 'Total Expenses', amount: 1200 }]);
    expect(buildDashboardTopCategories({}, 0, 'Total Expenses')).toEqual([]);
  });

  it('returns category count only when expense breakdown exists', () => {
    expect(
      getDashboardCategoryCount({
        expense: {
          breakdowns: [{ name: 'Rent' }, { name: 'Groceries' }],
        },
      }),
    ).toBe(2);
    expect(getDashboardCategoryCount({ expense: { breakdowns: null } })).toBe(0);
    expect(getDashboardCategoryCount({})).toBe(0);
  });
});
