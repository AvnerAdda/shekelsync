import { describe, expect, it } from 'vitest';

import type { Subscription } from '@renderer/types/subscriptions';

import {
  buildCalendarData,
  buildCalendarGrid,
  getMonthTotal,
  projectSubscriptionDates,
} from '../subscription-calendar-helpers';

function buildSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 1,
    pattern_key: 'netflix',
    display_name: 'Netflix',
    detected_frequency: 'monthly',
    detected_amount: 50,
    amount_is_fixed: 1,
    consistency_score: 0.95,
    user_frequency: null,
    user_amount: null,
    billing_day: null,
    status: 'active',
    category_definition_id: null,
    category_name: null,
    category_icon: null,
    category_color: '#123456',
    parent_category_name: null,
    first_detected_date: '2026-01-01',
    last_charge_date: '2026-02-01',
    next_expected_date: '2026-03-01',
    is_manual: 0,
    notes: null,
    occurrence_count: 3,
    total_spent: 150,
    ...overrides,
  };
}

describe('subscription calendar helpers', () => {
  it('builds a Monday-first calendar grid covering full weeks', () => {
    const grid = buildCalendarGrid(2026, 2);

    expect(grid.length === 35 || grid.length === 42).toBe(true);
    expect(grid[0]?.getDay()).toBe(1);
    expect(grid[grid.length - 1]?.getDay()).toBe(0);
  });

  it('clamps monthly billing days to the end of shorter months', () => {
    const dates = projectSubscriptionDates(
      buildSubscription({
        next_expected_date: '2026-01-31',
        billing_day: 31,
      }),
      new Date('2026-02-01T00:00:00.000Z'),
      new Date('2026-02-28T23:59:59.999Z'),
    );

    expect(dates).toHaveLength(1);
    expect(dates[0]?.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('only includes active and keep subscriptions in month totals', () => {
    const active = buildSubscription({
      id: 1,
      next_expected_date: '2026-03-10',
      detected_amount: 40,
    });
    const keep = buildSubscription({
      id: 2,
      pattern_key: 'gym',
      display_name: 'Gym',
      next_expected_date: '2026-03-10',
      detected_amount: 60,
      status: 'keep',
    });
    const cancelled = buildSubscription({
      id: 3,
      pattern_key: 'old-sub',
      display_name: 'Old Sub',
      next_expected_date: '2026-03-10',
      detected_amount: 999,
      status: 'cancelled',
    });

    const calendarData = buildCalendarData([active, keep, cancelled], 2026, 2);
    const march10 = calendarData.find((entry) =>
      entry.date.getFullYear() === 2026
      && entry.date.getMonth() === 2
      && entry.date.getDate() === 10,
    );

    expect(march10?.subscriptions).toHaveLength(2);
    expect(getMonthTotal(calendarData, 2026, 2)).toBe(100);
  });
});
