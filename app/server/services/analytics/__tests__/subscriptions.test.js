import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let subscriptionsService;

beforeAll(async () => {
  const module = await import('../subscriptions.js');
  subscriptionsService = module.default ?? module;
});

function configureService({
  patterns = [],
  queryImpl,
  normalizePatternKeyImpl,
  selectDominantClusterImpl,
} = {}) {
  const query = vi.fn(queryImpl || (async () => ({ rows: [], rowCount: 0 })));
  const analyzeRecurringPatterns = vi.fn(async () => ({ patterns }));
  const normalizePatternKey = vi.fn(
    normalizePatternKeyImpl || ((value) => (typeof value === 'string' ? value.trim().toLowerCase() : '')),
  );
  const selectDominantCluster = vi.fn(selectDominantClusterImpl || ((charges) => ({ charges })));

  subscriptionsService.__setDatabase({ query });
  subscriptionsService.__setRecurringAnalyzer({
    analyzeRecurringPatterns,
    normalizePatternKey,
    selectDominantCluster,
  });

  return {
    query,
    analyzeRecurringPatterns,
    normalizePatternKey,
    selectDominantCluster,
  };
}

describe('subscriptions service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-10T10:00:00.000Z'));
  });

  afterEach(() => {
    subscriptionsService.__resetDependencies();
    vi.useRealTimers();
  });

  it('merges detected patterns with stored and manual subscriptions', async () => {
    configureService({
      patterns: [
        {
          pattern_key: 'netflix',
          display_name: 'Netflix',
          detected_frequency: 'monthly',
          detected_amount: 49,
          amount_is_fixed: true,
          consistency_score: 0.9,
          category_definition_id: 14,
          category_name: 'בידור',
          category_name_en: 'Entertainment',
          category_name_fr: 'Divertissement',
          category_icon: 'tv',
          category_color: '#999',
          parent_category_name: 'פנאי',
          parent_category_name_en: 'Leisure',
          parent_category_name_fr: 'Loisir',
          first_detected_date: '2025-01-01',
          last_charge_date: '2026-01-10',
          occurrence_count: 8,
          total_spent: 392,
        },
      ],
      queryImpl: async (sql) => {
        if (String(sql).includes('FROM subscriptions s')) {
          return {
            rows: [
              {
                id: 5,
                pattern_key: 'netflix',
                display_name: 'Netflix Premium',
                user_frequency: 'monthly',
                user_amount: 60,
                status: 'active',
                category_definition_id: 14,
                category_name: 'בידור',
                category_name_en: 'Entertainment',
                category_name_fr: 'Divertissement',
                category_icon: 'tv',
                category_color: '#999',
                parent_category_name: 'פנאי',
                parent_category_name_en: 'Leisure',
                parent_category_name_fr: 'Loisir',
                is_manual: 0,
              },
              {
                id: 9,
                pattern_key: 'gym',
                display_name: 'Gym Membership',
                user_frequency: 'monthly',
                user_amount: 180,
                status: 'active',
                category_name: 'בריאות',
                category_name_en: 'Health',
                category_name_fr: 'Sante',
                parent_category_name: 'ביטחון',
                parent_category_name_en: 'Stability',
                parent_category_name_fr: 'Stabilite',
                is_manual: 1,
                detected_amount: 0,
              },
            ],
          };
        }
        return { rows: [] };
      },
    });

    const result = await subscriptionsService.getSubscriptions({ status: 'active', locale: 'en' });

    expect(result.subscriptions).toHaveLength(2);
    expect(result.subscriptions[0].display_name).toBe('Netflix Premium');
    expect(result.subscriptions[0].category_name).toBe('Entertainment');
    expect(result.subscriptions[1].display_name).toBe('Gym Membership');
    expect(result.subscriptions[1].occurrence_count).toBe(0);
  });

  it('calculates monthly and yearly summary totals and breakdowns', async () => {
    configureService({
      patterns: [
        {
          pattern_key: 'cloud',
          display_name: 'Cloud Storage',
          detected_frequency: 'monthly',
          detected_amount: 50,
          amount_is_fixed: true,
          consistency_score: 0.8,
          category_name: 'שירותים',
          category_name_en: 'Services',
          parent_category_name: 'עסק',
          parent_category_name_en: 'Business',
          last_charge_date: '2026-02-01',
          first_detected_date: '2025-01-01',
          occurrence_count: 6,
          total_spent: 300,
        },
        {
          pattern_key: 'weekly_box',
          display_name: 'Weekly Box',
          detected_frequency: 'weekly',
          detected_amount: 20,
          amount_is_fixed: false,
          consistency_score: 0.7,
          category_name: 'מזון',
          category_name_en: 'Food',
          parent_category_name: 'חיוני',
          parent_category_name_en: 'Essential',
          last_charge_date: '2026-02-08',
          first_detected_date: '2025-01-01',
          occurrence_count: 12,
          total_spent: 240,
        },
      ],
      queryImpl: async (sql) => {
        if (String(sql).includes('FROM subscriptions s')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    const summary = await subscriptionsService.getSubscriptionSummary({ locale: 'en' });

    expect(summary.monthly_total).toBeCloseTo(136.6, 1);
    expect(summary.yearly_total).toBeCloseTo(summary.monthly_total * 12, 2);
    expect(summary.total_count).toBe(2);
    expect(summary.active_count).toBe(2);
    expect(summary.frequency_breakdown.length).toBeGreaterThan(1);
    expect(summary.category_breakdown.length).toBeGreaterThan(1);
  });

  it('normalizes additional frequency types when building monthly totals', async () => {
    configureService({
      patterns: [
        {
          pattern_key: 'biweekly-sub',
          display_name: 'Biweekly',
          detected_frequency: 'biweekly',
          detected_amount: 10,
          amount_is_fixed: true,
          consistency_score: 0.9,
          category_name: 'A',
          category_name_en: 'A',
          last_charge_date: '2026-02-01',
          first_detected_date: '2025-01-01',
          occurrence_count: 6,
          total_spent: 60,
        },
        {
          pattern_key: 'bimonthly-sub',
          display_name: 'BiMonthly',
          detected_frequency: 'bimonthly',
          detected_amount: 60,
          amount_is_fixed: true,
          consistency_score: 0.9,
          category_name: 'B',
          category_name_en: 'B',
          last_charge_date: '2026-02-01',
          first_detected_date: '2025-01-01',
          occurrence_count: 6,
          total_spent: 360,
        },
        {
          pattern_key: 'quarterly-sub',
          display_name: 'Quarterly',
          detected_frequency: 'quarterly',
          detected_amount: 90,
          amount_is_fixed: true,
          consistency_score: 0.9,
          category_name: 'C',
          category_name_en: 'C',
          last_charge_date: '2026-02-01',
          first_detected_date: '2025-01-01',
          occurrence_count: 6,
          total_spent: 540,
        },
        {
          pattern_key: 'yearly-sub',
          display_name: 'Yearly',
          detected_frequency: 'yearly',
          detected_amount: 120,
          amount_is_fixed: true,
          consistency_score: 0.9,
          category_name: 'D',
          category_name_en: 'D',
          last_charge_date: '2026-02-01',
          first_detected_date: '2025-01-01',
          occurrence_count: 6,
          total_spent: 720,
        },
        {
          pattern_key: 'custom-sub',
          display_name: 'Custom',
          detected_frequency: 'custom',
          detected_amount: 40,
          amount_is_fixed: true,
          consistency_score: 0.9,
          category_name: 'E',
          category_name_en: 'E',
          last_charge_date: '2026-02-01',
          first_detected_date: '2025-01-01',
          occurrence_count: 6,
          total_spent: 240,
        },
      ],
      queryImpl: async (sql) => {
        if (String(sql).includes('FROM subscriptions s')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    const summary = await subscriptionsService.getSubscriptionSummary({ locale: 'en' });
    // 10*2.17 + 60/2 + 90/3 + 120/12 + 40 = 131.7
    expect(summary.monthly_total).toBeCloseTo(131.7, 2);
    expect(summary.yearly_total).toBeCloseTo(1580.4, 2);
  });

  it('builds subscription creep trend and aggregate growth', async () => {
    const { normalizePatternKey } = configureService({
      patterns: [
        {
          pattern_key: 'netflix',
          display_name: 'Netflix',
          detected_frequency: 'monthly',
          detected_amount: 50,
          amount_is_fixed: true,
          consistency_score: 0.9,
          category_name: 'בידור',
          category_name_en: 'Entertainment',
          last_charge_date: '2026-01-01',
          first_detected_date: '2025-01-01',
          occurrence_count: 12,
          total_spent: 600,
        },
      ],
      queryImpl: async (sql) => {
        if (String(sql).includes('FROM subscriptions s')) {
          return { rows: [] };
        }
        if (String(sql).includes("strftime('%Y-%m', t.date)")) {
          return {
            rows: [
              { month: '2025-12', pattern_key: ' NETFLIX ', monthly_amount: 80, charge_count: 1 },
              { month: '2026-01', pattern_key: 'netflix', monthly_amount: 100, charge_count: 1 },
            ],
          };
        }
        return { rows: [] };
      },
    });

    const creep = await subscriptionsService.getSubscriptionCreep({ months: 6 });

    expect(normalizePatternKey).toHaveBeenCalled();
    expect(creep.data).toHaveLength(2);
    expect(creep.starting_total).toBe(80);
    expect(creep.current_total).toBe(100);
    expect(creep.total_creep_percentage).toBeCloseTo(25, 2);
  });

  it('combines persisted alerts with newly detected price-increase and missed-charge alerts', async () => {
    configureService({
      patterns: [
        {
          pattern_key: 'netflix',
          display_name: 'Netflix',
          detected_frequency: 'monthly',
          detected_amount: 100,
          amount_is_fixed: true,
          consistency_score: 0.9,
          category_name: 'בידור',
          category_name_en: 'Entertainment',
          last_charge_date: '2025-11-01',
          first_detected_date: '2025-01-01',
          occurrence_count: 10,
          total_spent: 1000,
        },
      ],
      queryImpl: async (sql) => {
        const text = String(sql);
        if (text.includes('FROM subscription_alerts sa')) {
          return {
            rows: [
              {
                id: 1,
                severity: 'warning',
                is_dismissed: 0,
                subscription_name: 'Stored alert',
              },
            ],
          };
        }
        if (text.includes('FROM subscriptions s')) {
          return { rows: [] };
        }
        if (text.includes('FROM transactions t') && text.includes('ORDER BY charge_date DESC')) {
          return {
            rows: [
              { charge_date: '2026-02-01', amount: 120 },
              { charge_date: '2026-01-01', amount: 100 },
            ],
          };
        }
        return { rows: [] };
      },
    });

    const result = await subscriptionsService.getSubscriptionAlerts({ locale: 'en' });

    expect(result.total_count).toBe(3);
    expect(result.critical_count).toBe(1);
    expect(result.warning_count).toBeGreaterThanOrEqual(1);
    expect(result.alerts.some((alert) => alert.alert_type === 'price_increase')).toBe(true);
    expect(result.alerts.some((alert) => alert.alert_type === 'missed_charge')).toBe(true);
  });

  it('returns upcoming renewals sorted by nearest expected date', async () => {
    configureService({
      patterns: [
        {
          pattern_key: 'weekly-a',
          display_name: 'Weekly A',
          detected_frequency: 'weekly',
          detected_amount: 20,
          amount_is_fixed: false,
          consistency_score: 0.7,
          category_name: 'A',
          category_name_en: 'A',
          last_charge_date: '2026-02-05',
          first_detected_date: '2025-01-01',
          occurrence_count: 10,
          total_spent: 200,
        },
        {
          pattern_key: 'monthly-b',
          display_name: 'Monthly B',
          detected_frequency: 'monthly',
          detected_amount: 100,
          amount_is_fixed: true,
          consistency_score: 0.9,
          category_name: 'B',
          category_name_en: 'B',
          last_charge_date: '2026-01-20',
          first_detected_date: '2025-01-01',
          occurrence_count: 10,
          total_spent: 1000,
        },
      ],
      queryImpl: async (sql) => {
        if (String(sql).includes('FROM subscriptions s')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    const renewals = await subscriptionsService.getUpcomingRenewals({ days: 8, locale: 'en' });

    expect(renewals.renewals).toHaveLength(1);
    expect(renewals.renewals[0].display_name).toBe('Weekly A');
    expect(renewals.renewals[0].days_until_renewal).toBeGreaterThanOrEqual(1);
  });

  it('sorts multiple upcoming renewals by nearest next expected date', async () => {
    configureService({
      patterns: [
        {
          pattern_key: 'monthly-near',
          display_name: 'Monthly Near',
          detected_frequency: 'monthly',
          detected_amount: 40,
          amount_is_fixed: true,
          consistency_score: 0.9,
          category_name: 'A',
          category_name_en: 'A',
          last_charge_date: '2026-01-13',
          first_detected_date: '2025-01-01',
          occurrence_count: 8,
          total_spent: 320,
        },
        {
          pattern_key: 'weekly-far',
          display_name: 'Weekly Far',
          detected_frequency: 'weekly',
          detected_amount: 15,
          amount_is_fixed: false,
          consistency_score: 0.7,
          category_name: 'B',
          category_name_en: 'B',
          last_charge_date: '2026-02-07',
          first_detected_date: '2025-01-01',
          occurrence_count: 8,
          total_spent: 120,
        },
      ],
      queryImpl: async (sql) => {
        if (String(sql).includes('FROM subscriptions s')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    const renewals = await subscriptionsService.getUpcomingRenewals({ days: 7, locale: 'en' });
    expect(renewals.renewals).toHaveLength(2);
    expect(renewals.renewals[0].display_name).toBe('Monthly Near');
    expect(renewals.renewals[0].next_expected_date).toBe('2026-02-12');
    expect(renewals.renewals[1].display_name).toBe('Weekly Far');
    expect(renewals.renewals[1].next_expected_date).toBe('2026-02-14');
  });

  it('updates subscription and writes history entries for status and amount changes', async () => {
    const { query } = configureService({
      queryImpl: async (sql) => {
        const text = String(sql);
        if (text.startsWith('SELECT * FROM subscriptions')) {
          return {
            rows: [
              {
                id: 10,
                status: 'active',
                user_amount: 50,
                detected_amount: 50,
              },
            ],
          };
        }
        if (text.startsWith('UPDATE subscriptions SET')) {
          return { rowCount: 1, rows: [] };
        }
        if (text.startsWith('INSERT INTO subscription_history')) {
          return { rowCount: 1, rows: [] };
        }
        return { rows: [] };
      },
    });

    const result = await subscriptionsService.updateSubscription(10, {
      status: 'paused',
      user_amount: 75,
      notes: 'Paused for now',
    });

    expect(result).toEqual({ success: true, id: 10 });
    const historyCalls = query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO subscription_history'));
    expect(historyCalls).toHaveLength(2);
  });

  it('throws when updating a non-existing subscription', async () => {
    configureService({
      queryImpl: async (sql) => {
        if (String(sql).startsWith('SELECT * FROM subscriptions')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    await expect(subscriptionsService.updateSubscription(999, { status: 'paused' })).rejects.toThrow('Subscription not found');
  });

  it('prevents duplicate manual subscriptions and inserts new ones when unique', async () => {
    configureService({
      normalizePatternKeyImpl: () => 'netflix',
      queryImpl: async (sql) => {
        if (String(sql).includes('SELECT id FROM subscriptions WHERE pattern_key = $1')) {
          return { rows: [{ id: 1 }] };
        }
        return { rows: [] };
      },
    });

    await expect(
      subscriptionsService.addManualSubscription({ display_name: 'Netflix', user_amount: 100 }),
    ).rejects.toThrow('A subscription with this name already exists');

    configureService({
      normalizePatternKeyImpl: () => 'gym-membership',
      queryImpl: async (sql) => {
        if (String(sql).includes('SELECT id FROM subscriptions WHERE pattern_key = $1')) {
          return { rows: [] };
        }
        if (String(sql).startsWith('INSERT INTO subscriptions')) {
          return { rows: [{ id: 123 }] };
        }
        return { rows: [] };
      },
    });

    const result = await subscriptionsService.addManualSubscription({
      display_name: 'Gym Membership',
      user_frequency: 'monthly',
      user_amount: 180,
    });

    expect(result).toEqual({ success: true, id: 123 });
  });

  it('deletes manual subscriptions and cancels detected subscriptions', async () => {
    configureService({
      queryImpl: async (sql) => {
        if (String(sql).startsWith('SELECT is_manual FROM subscriptions')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    });
    await expect(subscriptionsService.deleteSubscription(1000)).rejects.toThrow('Subscription not found');

    configureService({
      queryImpl: async (sql) => {
        if (String(sql).startsWith('SELECT is_manual FROM subscriptions')) {
          return { rows: [{ is_manual: 0 }] };
        }
        return { rows: [] };
      },
    });
    await expect(subscriptionsService.deleteSubscription(11)).resolves.toEqual({ success: true, action: 'cancelled' });

    configureService({
      queryImpl: async (sql) => {
        if (String(sql).startsWith('SELECT is_manual FROM subscriptions')) {
          return { rows: [{ is_manual: 1 }] };
        }
        return { rows: [] };
      },
    });
    await expect(subscriptionsService.deleteSubscription(12)).resolves.toEqual({ success: true, action: 'deleted' });
  });

  it('dismisses alerts and supports refresh/auto-detection debounce', async () => {
    const { query } = configureService({
      patterns: [
        {
          pattern_key: 'existing-sub',
          display_name: 'Existing',
          detected_frequency: 'monthly',
          detected_amount: 20,
          amount_is_fixed: true,
          consistency_score: 0.9,
          category_definition_id: 2,
          first_detected_date: '2025-01-01',
          last_charge_date: '2026-02-01',
          occurrence_count: 6,
          total_spent: 120,
        },
        {
          pattern_key: 'new-sub',
          display_name: 'New One',
          detected_frequency: 'monthly',
          detected_amount: 30,
          amount_is_fixed: false,
          consistency_score: 0.8,
          category_definition_id: 3,
          first_detected_date: '2025-03-01',
          last_charge_date: '2026-02-02',
          occurrence_count: 4,
          total_spent: 120,
        },
      ],
      queryImpl: async (sql) => {
        const text = String(sql);
        if (text.includes('FROM subscriptions s')) {
          return {
            rows: [
              {
                id: 20,
                pattern_key: 'existing-sub',
                display_name: 'Existing',
                status: 'active',
                is_manual: 0,
              },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      },
    });

    await expect(subscriptionsService.dismissAlert(99)).resolves.toEqual({ success: true });

    const refresh = await subscriptionsService.refreshDetection({ locale: 'en', defaultStatus: 'invalid' });
    expect(refresh).toEqual({ success: true, created: 1, updated: 1 });

    const insertCall = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO subscriptions'));
    expect(insertCall?.[1]?.[6]).toBe('active');

    const firstAuto = await subscriptionsService.maybeRunAutoDetection({ locale: 'en', debounceMs: 60_000 });
    const secondAuto = await subscriptionsService.maybeRunAutoDetection({ locale: 'en', debounceMs: 60_000 });

    expect(firstAuto.success).toBe(true);
    expect(secondAuto).toEqual({ success: false, skipped: true, reason: 'debounced' });
  });

  it('applies status/frequency filters and keeps unmatched manual subscriptions', async () => {
    configureService({
      patterns: [
        {
          pattern_key: 'weekly-sub',
          display_name: 'Weekly Sub',
          detected_frequency: 'weekly',
          detected_amount: 40,
          amount_is_fixed: true,
          consistency_score: 0.8,
          category_name: 'קטגוריה',
          category_name_en: 'Category',
          category_name_fr: 'Categorie',
          parent_category_name: 'אב',
          parent_category_name_en: 'Parent',
          parent_category_name_fr: 'Parent FR',
          last_charge_date: '2026-02-01',
          first_detected_date: '2025-01-01',
          occurrence_count: 6,
          total_spent: 240,
        },
      ],
      queryImpl: async (sql) => {
        if (String(sql).includes('FROM subscriptions s')) {
          return {
            rows: [
              {
                id: 1,
                pattern_key: 'weekly-sub',
                display_name: 'Weekly Sub Stored',
                user_frequency: 'weekly',
                user_amount: 45,
                status: 'paused',
                category_name: 'קטגוריה',
                category_name_en: 'Category',
                category_name_fr: 'Categorie',
                parent_category_name: 'אב',
                parent_category_name_en: 'Parent',
                parent_category_name_fr: 'Parent FR',
                is_manual: 0,
              },
              {
                id: 2,
                pattern_key: 'manual-only',
                display_name: 'Manual Only',
                user_frequency: 'weekly',
                user_amount: 20,
                status: 'paused',
                category_name: 'בריאות',
                category_name_en: 'Health',
                category_name_fr: 'Sante',
                parent_category_name: 'חיים',
                parent_category_name_en: 'Life',
                parent_category_name_fr: 'Vie',
                is_manual: 1,
                detected_amount: 0,
              },
              {
                id: 3,
                pattern_key: 'detected-only',
                display_name: 'Detected',
                user_frequency: 'weekly',
                status: 'paused',
                is_manual: 0,
              },
            ],
          };
        }
        return { rows: [] };
      },
    });

    const result = await subscriptionsService.getSubscriptions({
      status: 'paused',
      frequency: 'weekly',
      locale: 'fr',
    });

    expect(result.subscriptions).toHaveLength(2);
    expect(result.subscriptions[0].display_name).toBe('Weekly Sub Stored');
    expect(result.subscriptions[0].next_expected_date).toBe('2026-02-08');
    expect(result.subscriptions[0].category_name).toBe('Categorie');
    expect(result.subscriptions[1].display_name).toBe('Manual Only');
    expect(result.subscriptions[1].occurrence_count).toBe(0);
    expect(result.subscriptions[1].detected_amount).toBe(20);
  });

  it('returns null next expected date when frequency is variable or last charge is missing', async () => {
    configureService({
      patterns: [
        {
          pattern_key: 'variable-sub',
          display_name: 'Variable',
          detected_frequency: 'variable',
          detected_amount: 30,
          amount_is_fixed: false,
          consistency_score: 0.5,
          category_name: 'A',
          category_name_en: 'A',
          last_charge_date: '2026-02-01',
          first_detected_date: '2025-01-01',
          occurrence_count: 4,
          total_spent: 120,
        },
        {
          pattern_key: 'no-date',
          display_name: 'No Date',
          detected_frequency: 'monthly',
          detected_amount: 50,
          amount_is_fixed: true,
          consistency_score: 0.9,
          category_name: 'B',
          category_name_en: 'B',
          last_charge_date: null,
          first_detected_date: '2025-01-01',
          occurrence_count: 4,
          total_spent: 200,
        },
      ],
      queryImpl: async () => ({ rows: [] }),
    });

    const result = await subscriptionsService.getSubscriptions({ locale: 'en' });
    const byKey = new Map(result.subscriptions.map((sub) => [sub.pattern_key, sub]));

    expect(byKey.get('variable-sub').next_expected_date).toBeNull();
    expect(byKey.get('no-date').next_expected_date).toBeNull();
  });

  it('supports include_dismissed and generates warning alerts for moderate increases and overdue charges', async () => {
    const { selectDominantCluster, query } = configureService({
      patterns: [
        {
          pattern_key: 'cloud-sub',
          display_name: 'Cloud Sub',
          detected_frequency: 'monthly',
          detected_amount: 100,
          amount_is_fixed: true,
          consistency_score: 0.9,
          category_name: 'ענן',
          category_name_en: 'Cloud',
          last_charge_date: '2025-12-01',
          first_detected_date: '2025-01-01',
          occurrence_count: 12,
          total_spent: 1200,
        },
      ],
      selectDominantClusterImpl: () => ({
        charges: [{ date: '2026-02-01', amount: 110 }],
      }),
      queryImpl: async (sql, params = []) => {
        const text = String(sql);
        if (text.includes('FROM subscription_alerts sa')) {
          return { rows: [{ id: 1, severity: 'critical', is_dismissed: 0 }] };
        }
        if (text.includes('FROM subscriptions s')) {
          return { rows: [] };
        }
        if (text.includes('ORDER BY charge_date DESC')) {
          return {
            rows: [
              { charge_date: '2026-02-01', amount: 110 },
              { charge_date: '2026-01-01', amount: 100 },
            ],
          };
        }
        if (Array.isArray(params) && params.length > 0) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    const result = await subscriptionsService.getSubscriptionAlerts({
      locale: 'en',
      include_dismissed: true,
    });

    expect(selectDominantCluster).toHaveBeenCalled();
    expect(query.mock.calls.find(([sql, params]) =>
      String(sql).includes('FROM subscription_alerts sa') && Array.isArray(params) && params[0] === 1,
    )).toBeTruthy();
    expect(result.total_count).toBe(3);
    expect(result.critical_count).toBe(1);
    expect(result.warning_count).toBe(2);
    expect(result.alerts.some((alert) => alert.alert_type === 'price_increase' && alert.severity === 'warning')).toBe(true);
    expect(result.alerts.some((alert) => alert.alert_type === 'missed_charge' && alert.severity === 'warning')).toBe(true);
  });

  it('updates subscription without history rows when status and amount are unchanged', async () => {
    const { query } = configureService({
      queryImpl: async (sql) => {
        const text = String(sql);
        if (text.startsWith('SELECT * FROM subscriptions')) {
          return {
            rows: [
              {
                id: 55,
                status: 'active',
                user_amount: 50,
                detected_amount: 50,
              },
            ],
          };
        }
        if (text.startsWith('UPDATE subscriptions SET')) {
          return { rowCount: 1, rows: [] };
        }
        if (text.startsWith('INSERT INTO subscription_history')) {
          return { rowCount: 1, rows: [] };
        }
        return { rows: [] };
      },
    });

    const result = await subscriptionsService.updateSubscription(55, {
      status: 'active',
      user_amount: null,
      notes: 'no-op',
    });

    expect(result).toEqual({ success: true, id: 55 });
    const historyCalls = query.mock.calls.filter(([sql]) =>
      String(sql).startsWith('INSERT INTO subscription_history'),
    );
    expect(historyCalls).toHaveLength(0);
  });

  it('defaults manual subscription frequency to monthly and supports immediate auto-detection reruns with debounceMs=0', async () => {
    const { query } = configureService({
      patterns: [
        {
          pattern_key: 'existing-sub',
          display_name: 'Existing',
          detected_frequency: 'monthly',
          detected_amount: 30,
          amount_is_fixed: true,
          consistency_score: 0.9,
          category_definition_id: 2,
          first_detected_date: '2025-01-01',
          last_charge_date: '2026-02-01',
          occurrence_count: 8,
          total_spent: 240,
        },
        {
          pattern_key: 'new-review-sub',
          display_name: 'Review Me',
          detected_frequency: 'monthly',
          detected_amount: 10,
          amount_is_fixed: false,
          consistency_score: 0.5,
          category_definition_id: 4,
          first_detected_date: '2025-03-01',
          last_charge_date: '2026-02-02',
          occurrence_count: 3,
          total_spent: 30,
        },
      ],
      normalizePatternKeyImpl: (value) =>
        typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, '-') : '',
      queryImpl: async (sql) => {
        const text = String(sql);
        if (text.includes('SELECT id FROM subscriptions WHERE pattern_key = $1')) {
          return { rows: [] };
        }
        if (text.startsWith('INSERT INTO subscriptions (') && text.includes('RETURNING id')) {
          return { rows: [{ id: 77 }] };
        }
        if (text.includes('FROM subscriptions s')) {
          return {
            rows: [{ id: 200, pattern_key: 'existing-sub', display_name: 'Existing', status: 'active', is_manual: 0 }],
          };
        }
        return { rows: [], rowCount: 1 };
      },
    });

    const manual = await subscriptionsService.addManualSubscription({
      display_name: '   Fresh Manual  ',
      user_amount: 25,
    });
    expect(manual).toEqual({ success: true, id: 77 });

    const insertManualCall = query.mock.calls.find(([sql]) =>
      String(sql).startsWith('INSERT INTO subscriptions (') && String(sql).includes('RETURNING id'),
    );
    expect(insertManualCall?.[1]?.[2]).toBe('monthly');
    expect(insertManualCall?.[1]?.[3]).toBe(25);

    const refreshed = await subscriptionsService.refreshDetection('fr');
    expect(refreshed.success).toBe(true);

    const auto = await subscriptionsService.maybeRunAutoDetection({
      locale: 'fr',
      defaultStatus: 'review',
      debounceMs: 0,
    });
    expect(auto.success).toBe(true);

    const refreshInsertCall = query.mock.calls.find(([sql, params]) =>
      String(sql).includes('ON CONFLICT(pattern_key) DO UPDATE') &&
      Array.isArray(params) &&
      params[0] === 'new-review-sub' &&
      params[6] === 'review',
    );
    expect(refreshInsertCall?.[1]?.[6]).toBe('review');
  });
});
