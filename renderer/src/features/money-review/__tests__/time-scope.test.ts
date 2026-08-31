import { describe, expect, it } from 'vitest';
import type { MoneyReviewItem } from '../types';
import { buildMoneyReviewTimeScopeLabel } from '../time-scope';

const baseItem: MoneyReviewItem = {
  id: 1,
  source: 'notification',
  sourceKey: 'review-1',
  group: 'cash',
  actionType: 'budget_overrun',
  severity: 'high',
  title: 'Budget needs attention',
  description: 'Dining is over budget.',
  status: 'active',
  detectedAt: '2026-08-27T08:00:00.000Z',
  updatedAt: '2026-08-27T08:00:00.000Z',
  snoozedUntil: null,
  potentialImpact: 400,
  confidence: 0.9,
  priority: 91,
  primaryAction: null,
  metadata: {},
};

describe('Money Review time scopes', () => {
  it('labels current-month alerts using their actual local month', () => {
    expect(buildMoneyReviewTimeScopeLabel({
      ...baseItem,
      metadata: {
        timeScope: { kind: 'current_month', start: '2026-08-01', end: '2026-08-31' },
      },
    }, 'en')).toEqual({
      key: 'timeScope.currentMonth',
      values: { month: 'August 2026' },
    });
  });

  it('keeps rolling activity visibly distinct from calendar-month alerts', () => {
    expect(buildMoneyReviewTimeScopeLabel({
      ...baseItem,
      metadata: {
        data: {
          time_scope: {
            kind: 'rolling_days',
            days: 7,
            start: '2026-08-21',
            end: '2026-08-27',
          },
        },
      },
    }, 'en')).toEqual({
      key: 'timeScope.rollingRange',
      values: { count: 7, start: 'Aug 21, 2026', end: 'Aug 27, 2026' },
    });
  });

  it('falls back to a relative label for legacy rolling scopes without anchors', () => {
    expect(buildMoneyReviewTimeScopeLabel({
      ...baseItem,
      metadata: { timeScope: { kind: 'rolling_days', days: 3 } },
    }, 'en')).toEqual({
      key: 'timeScope.rollingDays',
      values: { count: 3 },
    });
  });

  it('shows the original expected date for overdue recurring charges', () => {
    expect(buildMoneyReviewTimeScopeLabel({
      ...baseItem,
      metadata: {
        timeScope: { kind: 'overdue_since', start: '2026-07-12' },
      },
    }, 'en')).toEqual({
      key: 'timeScope.overdueSince',
      values: { date: 'Jul 12, 2026' },
    });
  });

  it('shows the expected date for upcoming renewal alerts', () => {
    expect(buildMoneyReviewTimeScopeLabel({
      ...baseItem,
      metadata: {
        timeScope: { kind: 'upcoming_until', end: '2026-09-02' },
      },
    }, 'en')).toEqual({
      key: 'timeScope.upcomingOn',
      values: { date: 'Sep 2, 2026' },
    });
  });

  it('dates legacy cash items that do not yet carry explicit scope metadata', () => {
    expect(buildMoneyReviewTimeScopeLabel(baseItem, 'en')).toEqual({
      key: 'timeScope.detectedOn',
      values: { date: 'Aug 27, 2026' },
    });
  });
});
