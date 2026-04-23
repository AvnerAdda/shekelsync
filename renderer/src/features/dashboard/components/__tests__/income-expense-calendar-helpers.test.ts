import { describe, expect, it } from 'vitest';
import {
  buildIncomeExpenseCalendarDays,
  buildIncomeExpenseCalendarGrid,
  getIncomeExpenseMonthTotals,
} from '../income-expense-calendar-helpers';

describe('income-expense calendar helpers', () => {
  it('builds a Monday-first calendar grid covering full weeks', () => {
    const grid = buildIncomeExpenseCalendarGrid(new Date(2026, 3, 1));

    expect(grid.length % 7).toBe(0);
    expect(grid[0].getDay()).toBe(1);
    expect(grid[grid.length - 1].getDay()).toBe(0);
  });

  it('maps daily history into calendar day totals with display adjustments', () => {
    const monthDate = new Date(2026, 3, 1);
    const days = buildIncomeExpenseCalendarDays({
      monthDate,
      today: new Date(2026, 3, 15),
      includeCapitalReturns: true,
      includeCardRepayments: false,
      history: [
        {
          date: '2026-04-05',
          income: 100,
          expenses: 50,
          capitalReturns: 25,
          cardRepayments: 10,
          pairedCardExpenses: 10,
          pairedCardRepayments: 5,
        },
        {
          date: '2026-04-20',
          income: 80,
          expenses: 20,
        },
      ],
    });

    const april5 = days.find((day) => day.isoDate === '2026-04-05');
    const april6 = days.find((day) => day.isoDate === '2026-04-06');
    const april20 = days.find((day) => day.isoDate === '2026-04-20');

    expect(april5).toMatchObject({
      income: 125,
      expenses: 40,
      net: 85,
      isCurrentMonth: true,
      isFuture: false,
      hasActivity: true,
    });
    expect(april6).toMatchObject({
      income: 0,
      expenses: 0,
      net: 0,
      hasActivity: false,
    });
    expect(april20?.isFuture).toBe(true);

    expect(getIncomeExpenseMonthTotals(days, monthDate)).toEqual({
      income: 205,
      expenses: 60,
      net: 145,
    });
  });
});
