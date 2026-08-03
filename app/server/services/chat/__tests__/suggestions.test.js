const {
  generateSuggestions,
  __clearCache,
} = require('../suggestions.js');

describe('chat suggestions', () => {
  afterEach(() => {
    __clearCache();
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
        if (text.includes('FROM spending_category_targets target')) {
          return {
            rows: [
              { spending_category: 'essential', target_percentage: '50', total_amount: '700' },
              { spending_category: 'growth', target_percentage: '20', total_amount: '300' },
            ],
          };
        }
        return { rows: [] };
      }),
    };

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
});
