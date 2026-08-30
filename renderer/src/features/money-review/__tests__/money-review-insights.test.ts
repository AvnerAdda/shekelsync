import { describe, expect, it } from 'vitest';
import { buildMoneyReviewInsight } from '../money-review-insights';
import type { MoneyReviewItem } from '../types';

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

describe('Money Review item insights', () => {
  it('builds a budget comparison from the values that triggered the card', () => {
    const insight = buildMoneyReviewInsight({
      ...baseItem,
      metadata: {
        notificationType: 'budget_exceeded',
        data: { spent: 1400, budget: 1000, category_name: 'Dining' },
      },
    });

    expect(insight.comparison).toEqual({
      firstLabel: 'detail.labels.spent',
      firstValue: 1400,
      secondLabel: 'detail.labels.budget',
      secondValue: 1000,
      format: 'currency',
    });
    expect(insight.metrics).toContainEqual({
      label: 'detail.labels.overBudget',
      value: 400,
      format: 'currency',
    });
  });

  it('explains stale account data without inventing comparison values', () => {
    const insight = buildMoneyReviewInsight({
      ...baseItem,
      group: 'data',
      actionType: 'optimization_low_confidence',
      metadata: {
        notificationType: 'stale_sync',
        data: { stale_count: 2, days_since_sync: 8, oldest_account: 'Main bank' },
      },
    });

    expect(insight.comparison).toBeNull();
    expect(insight.explanation).toBe('detail.explanations.staleSync');
    expect(insight.metrics.map((entry) => entry.value)).toEqual([2, 8, 'Main bank']);
  });

  it('identifies saved optimizer work and its local review behavior', () => {
    const insight = buildMoneyReviewInsight({
      ...baseItem,
      source: 'optimizerV2',
      group: 'improve',
      actionType: 'optimization',
      metadata: { source: 'optimizerV2', scope: 'fees' },
    });

    expect(insight.explanation).toBe('detail.explanations.optimizer');
    expect(insight.source).toBe('detail.sources.optimizer');
  });
});
