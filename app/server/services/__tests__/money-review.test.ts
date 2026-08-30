import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const moneyReview = require('../money-review.js');

describe('Money Review service contracts', () => {
  it('adapts actionable notifications into durable smart actions', () => {
    const action = moneyReview.utils.notificationToSmartAction({
      id: 'budget_7',
      type: 'budget_exceeded',
      severity: 'critical',
      title: 'Budget exceeded',
      message: 'Dining is over budget',
      timestamp: '2026-08-24T10:00:00.000Z',
      actionable: true,
      data: {
        spent: 1400,
        budget: 1000,
        time_scope: { kind: 'current_month', start: '2026-08-01', end: '2026-08-31' },
      },
      actions: [{ action: 'edit_budget', label: 'Adjust budget', params: { category_definition_id: 7 } }],
    });

    expect(action).toMatchObject({
      actionType: 'budget_overrun',
      severity: 'critical',
      recurrenceKey: 'money_review:notification:budget_exceeded:budget_7',
      potentialImpact: 400,
      metadata: {
        source: 'notification',
        notificationType: 'budget_exceeded',
        timeScope: { kind: 'current_month', start: '2026-08-01', end: '2026-08-31' },
      },
    });
  });

  it('ignores informational and unsupported notification types', () => {
    expect(moneyReview.utils.notificationToSmartAction({
      id: 'sync_success',
      type: 'sync_success',
      actionable: false,
    })).toBeNull();
    expect(moneyReview.utils.notificationToSmartAction({
      id: 'unknown',
      type: 'unknown',
      actionable: true,
    })).toBeNull();
  });

  it('adapts subscription price alerts with stable identity and impact', () => {
    const action = moneyReview.utils.subscriptionAlertToSmartAction({
      id: null,
      subscription_id: 14,
      subscription_name: 'Cloud storage',
      alert_type: 'price_increase',
      severity: 'warning',
      title: 'Price increase detected',
      description: 'The monthly charge increased',
      old_amount: 40,
      new_amount: 52,
      evidence_start_date: '2026-07-24',
      evidence_end_date: '2026-08-24',
      detected_frequency: 'monthly',
      correction_capabilities: ['suppress_pattern', 'override_pattern'],
      time_scope: { kind: 'evidence_range', start: '2026-07-24', end: '2026-08-24' },
      created_at: '2026-08-24T10:00:00.000Z',
    });

    expect(action).toMatchObject({
      actionType: 'fixed_recurring_change',
      severity: 'high',
      recurrenceKey: 'money_review:subscription:14:price_increase:2026-08-24',
      potentialImpact: 12,
      metadata: {
        source: 'subscription',
        subscriptionId: 14,
        subscriptionAlertType: 'price_increase',
        correctionCapabilities: ['suppress_pattern', 'override_pattern'],
        timeScope: { kind: 'evidence_range', start: '2026-07-24', end: '2026-08-24' },
      },
    });
  });

  it('keeps the canonical occurrence identity for a missed recurring charge', () => {
    const action = moneyReview.utils.subscriptionAlertToSmartAction({
      id: null,
      subscription_id: 14,
      financial_pattern_id: 9,
      occurrence_id: 'pattern:9:2026-08-24',
      subscription_name: 'Cloud storage',
      alert_type: 'missed_charge',
      severity: 'warning',
      title: 'Expected charge not found',
      expected_date: '2026-08-24',
      detected_amount: 52,
      detected_frequency: 'monthly',
      correction_capabilities: ['skip_occurrence', 'suppress_pattern', 'override_pattern'],
      created_at: '2026-08-30T10:00:00.000Z',
    });

    expect(action).toMatchObject({
      recurrenceKey: 'money_review:subscription:14:missed_charge:2026-08-24',
      metadata: {
        patternId: 9,
        occurrenceId: 'pattern:9:2026-08-24',
        correctionCapabilities: ['skip_occurrence', 'suppress_pattern', 'override_pattern'],
        data: {
          detected_amount: 52,
          detected_frequency: 'monthly',
          expected_date: '2026-08-24',
        },
      },
    });
  });

  it('normalizes rows into grouped, explainable priorities and primary actions', () => {
    const item = moneyReview.utils.normalizeReviewRow({
      id: 4,
      action_type: 'optimization_low_confidence',
      severity: 'high',
      title: 'Transactions need categorization',
      description: '12 transactions need review',
      user_status: 'active',
      detected_at: '2026-08-24T10:00:00.000Z',
      updated_at: '2026-08-24T10:00:00.000Z',
      potential_impact: 0,
      detection_confidence: 0.9,
      recurrence_key: 'money_review:notification:uncategorized_transactions:uncategorized_transactions',
      metadata: JSON.stringify({
        source: 'notification',
        notificationType: 'uncategorized_transactions',
        actions: [{ action: 'view_uncategorized', label: 'Review' }],
      }),
    });

    expect(item.group).toBe('data');
    expect(item.priority).toBeGreaterThan(80);
    expect(item.primaryAction.action).toBe('view_uncategorized');
  });

  it('summarizes open work without counting snoozed or completed impact', () => {
    const summary = moneyReview.utils.buildSummary([
      { status: 'active', group: 'data', potentialImpact: 0 },
      { status: 'accepted', group: 'cash', potentialImpact: 450 },
      { status: 'snoozed', group: 'improve', potentialImpact: 900 },
      { status: 'resolved', group: 'cash', potentialImpact: 100 },
    ]);

    expect(summary).toEqual({
      open: 2,
      snoozed: 1,
      completed: 1,
      estimatedMinutes: 3,
      potentialImpact: 450,
      byGroup: { data: 1, cash: 1, improve: 0 },
    });
  });

  it('rejects invalid lifecycle updates before opening a database connection', async () => {
    await expect(moneyReview.updateMoneyReviewItem('not-an-id', { status: 'active' }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_REVIEW_ITEM_ID' });
    await expect(moneyReview.updateMoneyReviewItem('12', { status: 'unknown' }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_REVIEW_STATUS' });
    await expect(moneyReview.updateMoneyReviewItem('12', { status: 'snoozed', snoozePreset: 'tomorrow' }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_SNOOZE_PRESET' });
  });
});
