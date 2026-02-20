import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let institutionsService: any;
let summaryService: any;
let subscriptionsService: any;

beforeAll(async () => {
  const institutionsModule = await import('../institutions.js');
  institutionsService = institutionsModule.default ?? institutionsModule;

  const summaryModule = await import('../investments/summary.js');
  summaryService = summaryModule.default ?? summaryModule;

  const subscriptionsModule = await import('../analytics/subscriptions.js');
  subscriptionsService = subscriptionsModule.default ?? subscriptionsModule;
});

beforeEach(() => {
  institutionsService.clearInstitutionsCache();
  summaryService.__resetDatabase();
  subscriptionsService.__resetDependencies();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  institutionsService.clearInstitutionsCache();
  summaryService.__resetDatabase();
  subscriptionsService.__resetDependencies();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('late targeted coverage for institutions, summary, and subscriptions', () => {
  it('covers institutions lookups, filtering, enrichment, tree, and backfill branches', async () => {
    const institutions = [
      {
        id: 1,
        vendor_code: 'alpha-bank',
        institution_type: 'bank',
        category: 'banking',
        subcategory: 'retail',
        is_scrapable: 1,
        display_name_he: 'אלפא',
        display_name_en: 'Alpha',
        logo_url: 'https://alpha',
        scraper_company_id: 'alpha-bank',
        display_order: 1,
        parent_id: null,
        hierarchy_path: 'banking/alpha-bank',
        depth_level: 2,
      },
      {
        id: 2,
        vendor_code: 'beta-card',
        institution_type: 'credit_card',
        category: 'cards',
        subcategory: 'issuer',
        is_scrapable: 0,
        display_name_he: 'בטא',
        display_name_en: 'Beta',
        logo_url: 'https://beta',
        scraper_company_id: null,
        display_order: 2,
        parent_id: null,
        hierarchy_path: 'cards/beta-card',
        depth_level: 2,
      },
    ];

    const db = {
      query: vi.fn(async (sql: string, params: any[] = []) => {
        const text = String(sql);
        if (text.includes('ORDER BY category, display_order')) {
          return { rows: institutions, rowCount: institutions.length };
        }
        if (text.includes('WHERE id = $1')) {
          return {
            rows: institutions.filter((row) => row.id === params[0]),
            rowCount: institutions.filter((row) => row.id === params[0]).length,
          };
        }
        if (text.includes('WHERE vendor_code = $1')) {
          return {
            rows: institutions.filter((row) => row.vendor_code === params[0]),
            rowCount: institutions.filter((row) => row.vendor_code === params[0]).length,
          };
        }
        if (text.includes('ORDER BY hierarchy_path')) {
          return { rows: [{ id: 9, hierarchy_path: 'root/group/leaf' }], rowCount: 1 };
        }
        if (text.includes('UPDATE vendor_credentials')) {
          return { rows: [], rowCount: 2 };
        }
        if (text.includes('UPDATE investment_accounts')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    await expect(institutionsService.getInstitutionById(db, null)).resolves.toBeNull();
    await expect(institutionsService.getInstitutionByVendorCode(db, '')).resolves.toBeNull();

    await institutionsService.loadInstitutionsCache(db);
    await expect(institutionsService.getInstitutionById(db, 1)).resolves.toMatchObject({ vendor_code: 'alpha-bank' });
    await expect(institutionsService.getInstitutionById(db, 999)).resolves.toBeNull();
    await expect(institutionsService.getInstitutionByVendorCode(db, 'beta-card')).resolves.toMatchObject({ id: 2 });
    await expect(institutionsService.getInstitutionByVendorCode(db, 'missing')).resolves.toBeNull();

    await expect(institutionsService.getAllInstitutions(db)).resolves.toHaveLength(2);
    await expect(institutionsService.getAllInstitutions(db, { type: 'bank' })).resolves.toHaveLength(1);
    await expect(institutionsService.getAllInstitutions(db, { category: 'cards' })).resolves.toHaveLength(1);
    await expect(institutionsService.getAllInstitutions(db, { scrapable: false })).resolves.toHaveLength(1);

    await expect(institutionsService.getInstitutionsByType(db, 'credit_card')).resolves.toHaveLength(1);
    await expect(institutionsService.getInstitutionsByCategory(db, 'banking')).resolves.toHaveLength(1);
    await expect(institutionsService.getScrapableInstitutions(db)).resolves.toHaveLength(1);

    await expect(institutionsService.getVendorCodesByTypes(db, ['bank', 'credit_card'])).resolves.toEqual([
      'alpha-bank',
      'beta-card',
    ]);
    await expect(institutionsService.getVendorCodesByTypes(db, [])).resolves.toEqual([]);
    await expect(institutionsService.getVendorCodesByCategories(db, ['cards'])).resolves.toEqual(['beta-card']);
    await expect(institutionsService.getVendorCodesByCategories(db, null)).resolves.toEqual([]);

    expect(institutionsService.mapInstitutionToVendorCode(null)).toBeNull();
    expect(
      institutionsService.mapInstitutionToVendorCode({
        vendor_code: 'alpha-bank',
        scraper_company_id: 'alpha-company',
      }),
    ).toBe('alpha-company');
    expect(
      institutionsService.mapInstitutionToVendorCode({
        vendor_code: 'alpha-bank',
        scraper_company_id: null,
      }),
    ).toBe('alpha-bank');

    await expect(institutionsService.mapVendorCodeToInstitutionId(db, 'beta-card')).resolves.toBe(2);
    await expect(institutionsService.mapVendorCodeToInstitutionId(db, 'unknown')).resolves.toBeNull();

    expect(institutionsService.buildInstitutionFromRow(null)).toBeNull();
    expect(
      institutionsService.buildInstitutionFromRow({
        institution_id: 1,
        institution_vendor_code: 'alpha-bank',
        institution_display_name_he: 'אלפא',
        institution_display_name_en: 'Alpha',
        institution_type: 'bank',
        institution_category: 'banking',
        institution_subcategory: 'retail',
        institution_logo_url: 'https://alpha',
        institution_is_scrapable: 1,
        institution_scraper_company_id: 'alpha-bank',
        institution_parent_id: null,
        institution_hierarchy_path: 'banking/alpha-bank',
        institution_depth_level: 2,
      }),
    ).toMatchObject({
      id: 1,
      vendor_code: 'alpha-bank',
      is_scrapable: true,
      depth_level: 2,
    });

    await expect(institutionsService.enrichCredentialWithInstitution(db, null)).resolves.toBeNull();
    await expect(institutionsService.enrichCredentialWithInstitution(db, { id: 10 })).resolves.toEqual({ id: 10 });
    await expect(
      institutionsService.enrichCredentialWithInstitution(db, { id: 11, institution_id: 1 }),
    ).resolves.toMatchObject({
      institution: { vendor_code: 'alpha-bank' },
    });
    await expect(
      institutionsService.enrichCredentialWithInstitution(db, { id: 12, vendor: 'beta-card' }),
    ).resolves.toMatchObject({
      institution: { id: 2 },
    });

    await expect(institutionsService.enrichAccountWithInstitution(db, null)).resolves.toBeNull();
    await expect(institutionsService.enrichAccountWithInstitution(db, { id: 20 })).resolves.toEqual({ id: 20 });
    await expect(
      institutionsService.enrichAccountWithInstitution(db, { id: 21, institution_id: 1 }),
    ).resolves.toMatchObject({
      institution: { vendor_code: 'alpha-bank' },
    });
    await expect(
      institutionsService.enrichAccountWithInstitution(db, { id: 22, account_type: 'beta-card' }),
    ).resolves.toMatchObject({
      institution: { id: 2 },
    });

    await expect(institutionsService.getInstitutionTree(db)).resolves.toEqual([
      { id: 9, hierarchy_path: 'root/group/leaf' },
    ]);

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await institutionsService.backfillMissingInstitutionIds(db);
    expect(infoSpy).toHaveBeenCalled();

    const moduleHelpers = await import('node:module');
    const requireFromTest = moduleHelpers.createRequire(import.meta.url);
    const sharedDatabase = requireFromTest('../database.js');
    const sharedQuerySpy = vi
      .spyOn(sharedDatabase, 'query')
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 0 });
    await institutionsService.backfillMissingInstitutionIds();
    expect(sharedQuerySpy).toHaveBeenCalledTimes(2);

    const failingDb = {
      query: vi
        .fn()
        .mockRejectedValueOnce(new Error('vendor-backfill-failed'))
        .mockRejectedValueOnce(new Error('investment-backfill-failed')),
    };
    await institutionsService.backfillMissingInstitutionIds(failingDb);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('covers investment summary success and release-on-error paths', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-16T00:00:00.000Z'));

    const sqlDialectModule = await import('../../../lib/sql-dialect.js');
    const previousUseSqlite = sqlDialectModule.dialect.useSqlite;
    sqlDialectModule.dialect.useSqlite = false;

    const query = vi.fn(async (sql: string) => {
      const text = String(sql);
      if (text.includes('FROM investment_accounts ia')) {
        return {
          rows: [
            {
              id: 1,
              account_name: 'Liquid Account',
              account_type: 'brokerage',
              investment_category: 'liquid',
              current_value: '200',
              cost_basis: '150',
              as_of_date: '2026-02-10',
              institution_id: null,
            },
            {
              id: 2,
              account_name: 'Restricted Account',
              account_type: 'pension',
              investment_category: 'restricted',
              current_value: '100',
              cost_basis: '120',
              as_of_date: '2026-01-10',
              institution_id: 2,
              institution_vendor_code: 'beta-card',
            },
            {
              id: 3,
              account_name: 'No Date Account',
              account_type: 'custom_type',
              investment_category: null,
              current_value: null,
              cost_basis: null,
              as_of_date: null,
              institution_id: null,
            },
          ],
        };
      }
      if (text.includes('FROM investment_assets iasset')) {
        return {
          rows: [
            {
              id: 201,
              account_id: 1,
              asset_name: 'ETF',
              units: '2',
              average_cost: '50',
              current_value: '200',
              cost_basis: '100',
            },
            {
              id: 202,
              account_id: null,
              asset_name: 'Detached',
              units: null,
              average_cost: null,
              current_value: null,
              cost_basis: null,
            },
          ],
        };
      }
      if (text.includes('ORDER BY category, display_order')) {
        return { rows: [{ id: 1, vendor_code: 'brokerage', display_name_en: 'Brokerage' }] };
      }
      if (text.includes('WHERE vendor_code = $1')) {
        return { rows: [{ id: 1, vendor_code: 'brokerage', display_name_en: 'Brokerage' }] };
      }
      if (text.includes('SUM(current_value) AS total_value')) {
        return {
          rows: [
            { month: new Date('2026-01-01T00:00:00.000Z'), total_value: null, total_cost_basis: null },
            { month: '2026-02-01T00:00:00.000Z', total_value: '300', total_cost_basis: '270' },
          ],
        };
      }
      return { rows: [] };
    });

    const release = vi.fn();

    summaryService.__setDatabase();
    summaryService.__setDatabase({
      query: (...args: any[]) => query(...args),
      getClient: async () => ({
        query: (...args: any[]) => query(...args),
        release: (...args: any[]) => release(...args),
      }),
    });

    try {
      const result = await summaryService.getInvestmentSummary({ historyMonths: 'invalid-value' });
      expect(result.summary.totalPortfolioValue).toBe(300);
      expect(result.summary.totalCostBasis).toBe(270);
      expect(result.timeline).toEqual([
        { date: '2026-01-01', totalValue: 0, totalCost: 0, gainLoss: 0 },
        { date: '2026-02-01', totalValue: 300, totalCost: 270, gainLoss: 30 },
      ]);
      expect(result.assets).toHaveLength(2);
      expect(result.breakdown.length).toBeGreaterThan(0);
      expect(release).toHaveBeenCalledTimes(1);

      summaryService.__setDatabase({
        query: (...args: any[]) => query(...args),
        getClient: async () => ({
          query: async (sql: string) => {
            if (String(sql).includes('FROM investment_accounts ia')) {
              throw new Error('summary-query-failed');
            }
            return { rows: [] };
          },
          release: (...args: any[]) => release(...args),
        }),
      });

      await expect(summaryService.getInvestmentSummary({ historyMonths: 1 })).rejects.toThrow(
        'summary-query-failed',
      );
      expect(release).toHaveBeenCalledTimes(2);
    } finally {
      sqlDialectModule.dialect.useSqlite = previousUseSqlite;
      vi.useRealTimers();
    }
  });

  it('covers subscriptions query, summary, creep, alerts, mutation, refresh, and debounce flows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-16T00:00:00.000Z'));

    const patterns = [
      {
        pattern_key: 'streaming-service',
        display_name: 'Streaming Service',
        detected_frequency: 'monthly',
        detected_amount: 20,
        amount_is_fixed: true,
        consistency_score: 0.9,
        category_definition_id: 10,
        category_name: 'בידור',
        category_name_en: 'Entertainment',
        parent_category_name: 'פנאי',
        parent_category_name_en: 'Leisure',
        first_detected_date: '2025-01-01',
        last_charge_date: '2026-01-01',
        occurrence_count: 12,
        total_spent: 240,
      },
      {
        pattern_key: 'new-service',
        display_name: 'New Service',
        detected_frequency: 'monthly',
        detected_amount: 12,
        amount_is_fixed: true,
        consistency_score: 0.8,
        category_definition_id: 11,
        category_name: 'שירותים',
        category_name_en: 'Services',
        parent_category_name: 'כללי',
        parent_category_name_en: 'General',
        first_detected_date: '2025-08-01',
        last_charge_date: '2026-02-01',
        occurrence_count: 5,
        total_spent: 60,
      },
    ];

    const storedSubscriptions = [
      {
        id: 101,
        pattern_key: 'streaming-service',
        display_name: 'Streaming Service',
        user_frequency: 'monthly',
        user_amount: 22,
        billing_day: 1,
        status: 'active',
        category_definition_id: 10,
        category_name: 'בידור',
        category_name_en: 'Entertainment',
        category_icon: 'tv',
        category_color: '#abcdef',
        parent_category_name: 'פנאי',
        parent_category_name_en: 'Leisure',
        is_manual: 0,
      },
      {
        id: 200,
        pattern_key: 'manual-weekly',
        display_name: 'Manual Weekly',
        user_frequency: 'weekly',
        user_amount: 10,
        billing_day: 5,
        status: 'active',
        category_definition_id: 12,
        category_name: 'שונות',
        category_name_en: 'Misc',
        category_icon: 'dots',
        category_color: '#ffcc00',
        parent_category_name: 'כללי',
        parent_category_name_en: 'General',
        is_manual: 1,
        detected_amount: 0,
      },
      {
        id: 300,
        pattern_key: 'cancelled-service',
        display_name: 'Cancelled Service',
        user_frequency: 'monthly',
        user_amount: 9,
        status: 'cancelled',
        is_manual: 1,
      },
    ];

    const query = vi.fn(async (sql: string, params: any[] = []) => {
      const text = String(sql);
      if (text.includes('FROM subscriptions s')) {
        return { rows: storedSubscriptions };
      }
      if (text.includes('SELECT id FROM subscriptions WHERE pattern_key = $1')) {
        return { rows: params[0] === 'existing-manual' ? [{ id: 777 }] : [] };
      }
      if (text.startsWith('INSERT INTO subscriptions (') && text.includes('RETURNING id')) {
        return { rows: [{ id: 555 }] };
      }
      if (text.includes('FROM subscription_alerts sa')) {
        return {
          rows: [
            {
              id: 1,
              subscription_id: 101,
              subscription_name: 'Streaming Service',
              alert_type: 'price_increase',
              severity: 'critical',
              is_dismissed: 0,
              created_at: '2026-02-10T00:00:00.000Z',
            },
          ],
        };
      }
      if (text.includes('ORDER BY charge_date DESC')) {
        return {
          rows: [
            { charge_date: '2026-02-01', amount: 30 },
            { charge_date: '2026-01-01', amount: 20 },
          ],
        };
      }
      if (text.includes("GROUP BY strftime('%Y-%m', t.date)")) {
        return {
          rows: [
            { month: '2026-01', pattern_key: 'streaming-service', monthly_amount: 20, charge_count: 1 },
            { month: '2026-02', pattern_key: 'streaming-service', monthly_amount: 30, charge_count: 1 },
            { month: '2026-02', pattern_key: 'unknown-key', monthly_amount: 100, charge_count: 1 },
          ],
        };
      }
      if (text.includes('SELECT * FROM subscriptions WHERE id = $1')) {
        if (params[0] === 101) {
          return {
            rows: [
              {
                id: 101,
                status: 'active',
                user_amount: 20,
                detected_amount: 20,
              },
            ],
          };
        }
        return { rows: [] };
      }
      if (text.includes('INSERT INTO subscription_history')) {
        return { rows: [], rowCount: 1 };
      }
      if (text.startsWith('UPDATE subscriptions SET')) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('SELECT is_manual FROM subscriptions WHERE id = $1')) {
        if (params[0] === 500) return { rows: [] };
        if (params[0] === 200) return { rows: [{ is_manual: 1 }] };
        return { rows: [{ is_manual: 0 }] };
      }
      if (text.startsWith('DELETE FROM subscriptions WHERE id = $1')) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('UPDATE subscription_alerts SET')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    subscriptionsService.__setDatabase({ query });
    subscriptionsService.__setRecurringAnalyzer({
      analyzeRecurringPatterns: async () => ({ patterns }),
      normalizePatternKey: (value: string) =>
        typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, '-') : '',
      selectDominantCluster: (charges: any[]) => ({ charges }),
    });

    const list = await subscriptionsService.getSubscriptions({ locale: 'en' });
    expect(list.subscriptions.length).toBeGreaterThan(0);

    const filtered = await subscriptionsService.getSubscriptions({ status: 'cancelled', locale: 'en' });
    expect(filtered.subscriptions.every((sub: any) => sub.status === 'cancelled')).toBe(true);

    const summary = await subscriptionsService.getSubscriptionSummary({ locale: 'en' });
    expect(summary.total_count).toBeGreaterThan(0);
    expect(summary.monthly_total).toBeGreaterThan(0);

    const creep = await subscriptionsService.getSubscriptionCreep({ months: 2 });
    expect(creep.data.length).toBeGreaterThan(0);

    const alerts = await subscriptionsService.getSubscriptionAlerts({ locale: 'en', include_dismissed: true });
    expect(alerts.total_count).toBeGreaterThan(0);

    const renewals = await subscriptionsService.getUpcomingRenewals({ days: 60, locale: 'en' });
    expect(Array.isArray(renewals.renewals)).toBe(true);

    await expect(
      subscriptionsService.updateSubscription(101, {
        status: 'paused',
        user_amount: 25,
      }),
    ).resolves.toEqual({ success: true, id: 101 });

    await expect(subscriptionsService.updateSubscription(999, { status: 'active' })).rejects.toThrow(
      'Subscription not found',
    );

    await expect(
      subscriptionsService.addManualSubscription({
        display_name: 'Existing Manual',
        user_amount: 15,
      }),
    ).rejects.toThrow('A subscription with this name already exists');

    await expect(
      subscriptionsService.addManualSubscription({
        display_name: 'Fresh Manual',
        user_frequency: 'monthly',
        user_amount: 18,
      }),
    ).resolves.toEqual({ success: true, id: 555 });

    await expect(subscriptionsService.deleteSubscription(100)).resolves.toEqual({
      success: true,
      action: 'cancelled',
    });
    await expect(subscriptionsService.deleteSubscription(200)).resolves.toEqual({
      success: true,
      action: 'deleted',
    });
    await expect(subscriptionsService.deleteSubscription(500)).rejects.toThrow('Subscription not found');

    await expect(subscriptionsService.dismissAlert(1)).resolves.toEqual({ success: true });

    const refreshFromString = await subscriptionsService.refreshDetection('en');
    expect(refreshFromString.success).toBe(true);

    const refreshWithInvalidStatus = await subscriptionsService.refreshDetection({
      locale: 'en',
      defaultStatus: 'invalid-status',
    });
    expect(refreshWithInvalidStatus.success).toBe(true);

    const autoRun = await subscriptionsService.maybeRunAutoDetection({
      locale: 'en',
      defaultStatus: 'review',
      debounceMs: 1000,
    });
    expect(autoRun.success).toBe(true);

    const debounced = await subscriptionsService.maybeRunAutoDetection({
      locale: 'en',
      defaultStatus: 'review',
      debounceMs: 1000,
    });
    expect(debounced).toEqual({
      success: false,
      skipped: true,
      reason: 'debounced',
    });
  });
});
