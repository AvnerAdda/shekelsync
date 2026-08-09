const getSpendingCategoryBreakdown = vi.fn();

let generateSuggestions;
let __clearCache;

beforeAll(async () => {
  const mod = await import('../suggestions.js');
  const api = mod.default ?? mod;
  ({ generateSuggestions, __clearCache } = api);
  api.__setSpendingBreakdownLoader(getSpendingCategoryBreakdown);
});

describe('chat suggestions', () => {
  afterEach(() => {
    __clearCache();
    getSpendingCategoryBreakdown.mockReset();
  });

  it('returns no suggestions without data permissions', async () => {
    const db = { query: vi.fn() };

    const suggestions = await generateSuggestions(db, {
      allowTransactionAccess: false,
      allowCategoryAccess: false,
      allowAnalyticsAccess: false,
    }, 'en');

    expect(suggestions).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('ranks proactive smart actions ahead of generic prompts', async () => {
    const db = {
      query: vi.fn(async (sql) => {
        const text = String(sql);
        if (text.includes('COUNT(*) as transaction_count') && text.includes('latest_transaction_date')) {
          return { rows: [{ transaction_count: '20', latest_transaction_date: '2026-01-10' }] };
        }
        if (text.includes('latest_scrape_at')) {
          return { rows: [{ latest_scrape_at: '2026-01-11' }] };
        }
        if (text.includes('FROM smart_action_items') && text.includes('potential_impact')) {
          return { rows: [{ action_count: '2', potential_impact: '1200' }] };
        }
        if (text.includes('FROM subscriptions s') && text.includes("WHERE status = 'review'")) {
          return { rows: [{ review_count: '1', monthly_total: '80' }] };
        }
        if (text.includes('FROM subscriptions') && text.includes('next_expected_date')) {
          return { rows: [{ renewal_count: '1' }] };
        }
        return { rows: [] };
      }),
    };

    getSpendingCategoryBreakdown.mockResolvedValue({
      breakdown: [
        { spending_category: 'essential', target_percentage: 50, actual_percentage: 70, variance: 20, total_amount: 700 },
        { spending_category: 'growth', target_percentage: 20, actual_percentage: 30, variance: 10, total_amount: 300 },
      ],
    });

    const suggestions = await generateSuggestions(db, {
      allowTransactionAccess: true,
      allowCategoryAccess: true,
      allowAnalyticsAccess: true,
    }, 'en');

    expect(suggestions[0]).toMatchObject({
      category: 'smart_action',
      priority: 100,
      source: 'smart_action_items',
      estimatedImpactMonthly: 1200,
      requiresPermission: ['analytics'],
    });
    expect(suggestions.every((suggestion) => suggestion.text && suggestion.category)).toBe(true);
    expect(suggestions.map((suggestion) => suggestion.priority)).toEqual(
      [...suggestions.map((suggestion) => suggestion.priority)].sort((a, b) => b - a),
    );
  });

  it('uses transaction freshness in the cache key', async () => {
    let latestDate = '2026-01-10';
    let actionCount = '1';
    const db = {
      query: vi.fn(async (sql) => {
        const text = String(sql);
        if (text.includes('COUNT(*) as transaction_count') && text.includes('latest_transaction_date')) {
          return { rows: [{ transaction_count: '20', latest_transaction_date: latestDate }] };
        }
        if (text.includes('latest_scrape_at')) {
          return { rows: [{ latest_scrape_at: '2026-01-11' }] };
        }
        if (text.includes('FROM smart_action_items') && text.includes('potential_impact')) {
          return { rows: [{ action_count: actionCount, potential_impact: '100' }] };
        }
        return { rows: [] };
      }),
    };

    const permissions = {
      allowTransactionAccess: false,
      allowCategoryAccess: false,
      allowAnalyticsAccess: true,
    };

    const first = await generateSuggestions(db, permissions, 'en');
    actionCount = '3';
    const cached = await generateSuggestions(db, permissions, 'en');
    latestDate = '2026-01-12';
    const refreshed = await generateSuggestions(db, permissions, 'en');

    expect(first[0].text).toContain('1 active');
    expect(cached[0].text).toContain('1 active');
    expect(refreshed[0].text).toContain('3 active');
  });

  it('omits the monthly amount when review subscriptions have no known cost', async () => {
    const db = {
      query: vi.fn(async (sql) => {
        const text = String(sql);
        if (text.includes('FROM subscriptions s') && text.includes("WHERE status = 'review'")) {
          return { rows: [{ review_count: '2', monthly_total: null }] };
        }
        return { rows: [] };
      }),
    };

    const suggestions = await generateSuggestions(db, {
      allowTransactionAccess: true,
      allowCategoryAccess: false,
      allowAnalyticsAccess: false,
    }, 'en');

    const review = suggestions.find((s) => s.source === 'subscriptions_review');
    expect(review).toBeDefined();
    expect(review.text).toContain('2 subscriptions marked for review');
    expect(review.text).not.toContain('₪');
    expect(review.estimatedImpactMonthly).toBeNull();
  });

  it('suggests investing materially unallocated monthly income', async () => {
    const db = {
      query: vi.fn(async (sql) => {
        const text = String(sql);
        if (text.includes('as income') && text.includes('as expenses')) {
          return { rows: [{ income: '10000', expenses: '7000' }] };
        }
        return { rows: [] };
      }),
    };

    const suggestions = await generateSuggestions(db, {
      allowTransactionAccess: false,
      allowCategoryAccess: false,
      allowAnalyticsAccess: true,
    }, 'en');

    const savings = suggestions.find((suggestion) => suggestion.source === 'monthly_cashflow');
    expect(savings).toMatchObject({
      category: 'savings',
      priority: 54,
      estimatedImpactMonthly: 3000,
      requiresPermission: ['analytics'],
    });
    expect(savings.text).toContain('₪3,000');
  });

  it('surfaces a spending spike and newly visited merchants', async () => {
    const db = {
      query: vi.fn(async (sql) => {
        const text = String(sql);
        if (text.includes('as this_month') && text.includes('as last_month')) {
          return { rows: [{ this_month: '1500', last_month: '1000' }] };
        }
        if (text.includes('as new_count')) {
          return { rows: [{ new_count: '3' }] };
        }
        return { rows: [] };
      }),
    };

    const suggestions = await generateSuggestions(db, {
      allowTransactionAccess: true,
      allowCategoryAccess: false,
      allowAnalyticsAccess: false,
    }, 'en');

    expect(suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'spike',
        source: 'monthly_spending_change',
        priority: 72,
      }),
      expect.objectContaining({
        category: 'merchant',
        source: 'new_merchant_count',
        priority: 58,
      }),
    ]));
  });
});
