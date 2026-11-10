import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const moneyReview = require('../money-review.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const forecastService = require('../forecast.js');

describe('Money Review service contracts', () => {
  it('includes forecast calibration when available and degrades safely when unavailable', () => {
    const accuracy = {
      available: true,
      readiness: 'provisional',
      observedDays: 18,
      sampleCount: 52,
    };
    const accuracySpy = vi.spyOn(forecastService, 'getForecastAccuracy').mockReturnValue(accuracy);
    expect(moneyReview.utils.loadForecastAccuracy()).toBe(accuracy);
    expect(accuracySpy).toHaveBeenCalledWith({ days: 90 });

    accuracySpy.mockImplementation(() => { throw new Error('database unavailable'); });
    expect(moneyReview.utils.loadForecastAccuracy()).toBeNull();
    accuracySpy.mockRestore();
  });

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

  it('keeps price decreases out of the action queue', () => {
    expect(moneyReview.utils.subscriptionAlertToSmartAction({
      id: 3,
      subscription_id: 14,
      alert_type: 'price_decrease',
      old_amount: 41.8,
      new_amount: 39.49,
    })).toBeNull();
  });

  it('queues only price increases that add a meaningful monthly amount', () => {
    const alert = {
      id: 5,
      subscription_id: 38,
      alert_type: 'price_increase',
      detected_frequency: 'bimonthly',
      old_amount: 36,
      new_amount: 39.02,
    };
    expect(moneyReview.utils.subscriptionAlertToSmartAction(alert)).toBeNull();
    expect(moneyReview.utils.subscriptionAlertToSmartAction({
      ...alert,
      detected_frequency: 'monthly',
      old_amount: 50,
      new_amount: 60,
    })).toMatchObject({ actionType: 'fixed_recurring_change', potentialImpact: 10 });
  });

  it('turns a missing salary into a critical, correction-free review item', () => {
    const action = moneyReview.utils.missingDepositToSmartAction({
      kind: 'salary',
      key: 'salary:2:2026-11',
      name: 'Gan Dalia',
      searchText: 'בנק לאומי משכורת',
      member: 'spouse',
      employmentId: 2,
      patternId: null,
      expectedDate: '2026-11-08',
      deadline: '2026-11-11',
      daysLate: 12,
      expectedAmount: 7029,
      lastReceivedDate: '2026-10-05',
      coveredThrough: '2026-11-19',
    });

    expect(action).toMatchObject({
      actionType: 'fixed_recurring_missing',
      severity: 'critical',
      recurrenceKey: 'money_review:deposit:salary:2:2026-11',
      potentialImpact: 0,
      metadata: {
        source: 'expected_deposit',
        notificationType: 'missing_deposit',
        depositKind: 'salary',
        patternId: null,
        occurrenceId: null,
        correctionCapabilities: [],
        timeScope: { kind: 'overdue_since', start: '2026-11-08' },
        data: { name: 'Gan Dalia', member: 'spouse', expected_amount: 7029, days_late: 12 },
        actions: [{ action: 'view_vendor', params: { vendor: 'בנק לאומי משכורת' } }],
      },
    });
  });

  it('lets a missing pattern deposit be skipped or corrected', () => {
    const action = moneyReview.utils.missingDepositToSmartAction({
      kind: 'investment',
      key: 'pattern:7:2026-11-10',
      name: 'הפקדה לפיקדון מפתח',
      patternId: 7,
      frequency: 'monthly',
      expectedDate: '2026-11-10',
      deadline: '2026-11-14',
      daysLate: 10,
      expectedAmount: 100,
      coveredThrough: '2026-11-19',
    });
    expect(action).toMatchObject({
      severity: 'medium',
      metadata: {
        patternId: 7,
        occurrenceId: 'pattern:7:2026-11-10',
        correctionCapabilities: ['skip_occurrence', 'end_pattern', 'pause_pattern', 'override_pattern'],
      },
    });
  });

  describe('generated item lifecycle', () => {
    const PREFIX = 'money_review:notification:';

    function createClient() {
      const db = new DatabaseSync(':memory:');
      db.exec(`
        CREATE TABLE smart_action_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action_type TEXT, severity TEXT, title TEXT, description TEXT,
          detected_at TEXT, resolved_at TEXT, user_status TEXT,
          metadata TEXT, potential_impact REAL, detection_confidence REAL,
          recurrence_key TEXT, is_recurring INTEGER, completion_result TEXT,
          updated_at TEXT
        );
      `);
      let writes = 0;
      const client = {
        query: async (sql: string, params: unknown[] = []) => {
          const statement = db.prepare(sql.replace(/\$(\d+)/g, '?$1'));
          if (/^\s*SELECT/i.test(sql)) return { rows: statement.all(...(params as never[])) };
          const info = statement.run(...(params as never[]));
          writes += Number(info.changes);
          return { rows: [] };
        },
      };
      return {
        client,
        db,
        writes: () => writes,
        row: (key: string) => db.prepare('SELECT * FROM smart_action_items WHERE recurrence_key = ?').get(key) as Record<string, unknown>,
      };
    }

    const staleSync = (description = '4 accounts need sync') => ({
      actionType: 'optimization_low_confidence',
      severity: 'high',
      title: 'Accounts Need Sync',
      description,
      detectedAt: '2026-11-10T08:00:00.000Z',
      recurrenceKey: `${PREFIX}stale_sync:stale_sync_alert`,
      potentialImpact: 0,
      confidence: 0.9,
      metadata: { source: 'notification', notificationType: 'stale_sync' },
    });

    it('does not rewrite unchanged items on every load', async () => {
      const harness = createClient();
      await moneyReview.utils.upsertGeneratedActions(harness.client, [staleSync()], PREFIX);
      const writesAfterInsert = harness.writes();

      await moneyReview.utils.upsertGeneratedActions(harness.client, [staleSync()], PREFIX);
      expect(harness.writes()).toBe(writesAfterInsert);

      await moneyReview.utils.upsertGeneratedActions(harness.client, [staleSync('5 accounts need sync')], PREFIX);
      expect(harness.writes()).toBe(writesAfterInsert + 1);
      expect(harness.row(staleSync().recurrenceKey).description).toBe('5 accounts need sync');
    });

    it('resurfaces an item the user marked done once its condition clears and returns', async () => {
      const harness = createClient();
      const key = staleSync().recurrenceKey;
      await moneyReview.utils.upsertGeneratedActions(harness.client, [staleSync()], PREFIX);
      harness.db.prepare(`
        UPDATE smart_action_items SET user_status = 'resolved', completion_result = 'user_resolved'
        WHERE recurrence_key = ?
      `).run(key);

      // Condition still present: the user's "done" sticks.
      await moneyReview.utils.upsertGeneratedActions(harness.client, [staleSync()], PREFIX);
      expect(harness.row(key)).toMatchObject({ user_status: 'resolved', completion_result: 'user_resolved' });

      // Condition clears (accounts synced), then returns later.
      await moneyReview.utils.upsertGeneratedActions(harness.client, [], PREFIX);
      expect(harness.row(key)).toMatchObject({ user_status: 'resolved', completion_result: 'condition_cleared' });
      await moneyReview.utils.upsertGeneratedActions(harness.client, [staleSync()], PREFIX);
      expect(harness.row(key)).toMatchObject({ user_status: 'active', completion_result: null });
    });

    it('auto-resolves open items whose condition disappeared and leaves dismissals alone', async () => {
      const harness = createClient();
      const other = { ...staleSync(), recurrenceKey: `${PREFIX}uncategorized_transactions:uncategorized_transactions` };
      await moneyReview.utils.upsertGeneratedActions(harness.client, [staleSync(), other], PREFIX);
      harness.db.prepare(`UPDATE smart_action_items SET user_status = 'dismissed' WHERE recurrence_key = ?`).run(other.recurrenceKey);

      await moneyReview.utils.upsertGeneratedActions(harness.client, [], PREFIX);

      expect(harness.row(staleSync().recurrenceKey)).toMatchObject({ user_status: 'resolved', completion_result: 'auto_resolved' });
      expect(harness.row(other.recurrenceKey)).toMatchObject({ user_status: 'dismissed', completion_result: null });
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
