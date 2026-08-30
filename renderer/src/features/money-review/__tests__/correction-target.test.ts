import { describe, expect, it } from 'vitest';
import { buildMoneyReviewCorrectionTarget } from '../correction-target';
import type { MoneyReviewItem } from '../types';

const baseItem: MoneyReviewItem = {
  id: 1,
  source: 'notification',
  sourceKey: 'review-1',
  group: 'cash',
  actionType: 'fixed_recurring_change',
  severity: 'high',
  title: 'Review this prediction',
  description: 'Something changed.',
  status: 'active',
  detectedAt: '2026-08-27T08:00:00.000Z',
  updatedAt: '2026-08-27T08:00:00.000Z',
  snoozedUntil: null,
  potentialImpact: 12,
  confidence: 0.9,
  priority: 91,
  primaryAction: null,
  metadata: {},
};

describe('Money Review correction targets', () => {
  it('keeps the exact clicked occurrence and resolved recurring values', () => {
    expect(buildMoneyReviewCorrectionTarget({
      ...baseItem,
      metadata: {
        patternId: 14,
        occurrenceId: 'pattern:14:2026-09-02',
        correctionCapabilities: ['skip_occurrence', 'override_pattern'],
        data: {
          new_amount: 52,
          detected_amount: 40,
          detected_frequency: 'yearly',
          expected_date: '2026-09-02',
        },
      },
    })).toEqual({
      kind: 'occurrence',
      patternId: 14,
      occurrenceId: 'pattern:14:2026-09-02',
      title: 'Review this prediction',
      amount: 52,
      frequency: 'yearly',
      nextExpectedDate: '2026-09-02',
      capabilities: ['skip_occurrence', 'override_pattern'],
    });
  });

  it('uses the full new charge rather than the price-change impact for pattern overrides', () => {
    expect(buildMoneyReviewCorrectionTarget({
      ...baseItem,
      metadata: {
        patternId: 14,
        data: { old_amount: 40, new_amount: 52, detected_frequency: 'monthly' },
      },
    })).toMatchObject({
      kind: 'pattern',
      patternId: 14,
      amount: 52,
      frequency: 'monthly',
    });
  });

  it('seeds forecast-backed category corrections with the projected monthly total', () => {
    expect(buildMoneyReviewCorrectionTarget({
      ...baseItem,
      actionType: 'budget_overrun',
      potentialImpact: 400,
      metadata: {
        notificationType: 'budget_projected',
        correctionCapabilities: ['set_category_expectation'],
        data: {
          category_definition_id: 7,
          projected_total: 1400,
          limit: 1000,
        },
      },
    })).toEqual({
      kind: 'category',
      categoryDefinitionId: 7,
      title: 'Review this prediction',
      amount: 1400,
      capabilities: ['set_category_expectation'],
    });
  });

  it('does not offer a category forecast correction for one-off historical alerts', () => {
    expect(buildMoneyReviewCorrectionTarget({
      ...baseItem,
      actionType: 'unusual_purchase',
      potentialImpact: 0,
      metadata: {
        notificationType: 'unusual_spending',
        data: { category_definition_id: 7, amount: 850 },
      },
    })).toBeNull();
  });
});

