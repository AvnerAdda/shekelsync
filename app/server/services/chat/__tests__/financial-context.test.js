const {
  buildContext,
  formatContextForPrompt,
  getSchemaDescription,
} = require('../financial-context.js');

describe('financial-context service', () => {
  it('builds summary-only context when all permissions are disabled', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            transaction_count: '2',
            total_income: '1200',
            total_expenses: '450',
            earliest_date: '2025-01-01',
            latest_date: '2025-01-31',
          },
        ],
      }),
    };

    const context = await buildContext(
      db,
      {
        allowTransactionAccess: false,
        allowCategoryAccess: false,
        allowAnalyticsAccess: false,
      },
      { months: 2, startDate: '2025-01-01', endDate: '2025-01-31' },
    );

    expect(context.hasData).toBe(true);
    expect(context.permissions).toEqual({
      transactions: false,
      categories: false,
      analytics: false,
    });
    expect(context.summary).toMatchObject({
      transactionCount: 2,
      totalIncome: 1200,
      totalExpenses: 450,
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('builds full context when all permissions are enabled', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [
            {
              transaction_count: '4',
              total_income: '1500',
              total_expenses: '800',
              earliest_date: '2025-01-01',
              latest_date: '2025-02-01',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { category: 'Food', category_type: 'expense', total_expenses: '520', count: '3' },
            { category: null, category_type: null, total_expenses: '180', count: '1' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { category: 'Food', budget: '600', spent: '540' },
            { category: 'Transport', budget: '300', spent: '120' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              name: 'Grocery',
              merchant_name: 'Merchant_1',
              price: '-120',
              date: '2025-02-01',
              category: 'Food',
              vendor: 'isracard',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              merchant_name: 'Merchant_1',
              visit_count: '5',
              total_spent: '730',
              avg_transaction: '146',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { month: '2025-01', income: '1000', expenses: '600' },
            { month: '2025-02', income: '500', expenses: '200' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              total_value: '40000',
              liquid_value: '10000',
              account_count: '2',
            },
          ],
        }),
    };

    const context = await buildContext(
      db,
      {
        allowTransactionAccess: true,
        allowCategoryAccess: true,
        allowAnalyticsAccess: true,
      },
      { months: 3 },
    );

    expect(context.hasData).toBe(true);
    expect(context.categories).toEqual([
      { name: 'Food', type: 'expense', totalExpenses: 520, count: 3 },
      { name: 'Uncategorized', type: null, totalExpenses: 180, count: 1 },
    ]);
    expect(context.budgets).toEqual([
      { category: 'Food', budget: 600, spent: 540, remaining: 60, percentUsed: 90 },
      { category: 'Transport', budget: 300, spent: 120, remaining: 180, percentUsed: 40 },
    ]);
    expect(context.recentTransactions?.[0]).toMatchObject({
      merchantName: 'Merchant_1',
      price: -120,
      category: 'Food',
    });
    expect(context.topMerchants?.[0]).toEqual({
      name: 'Merchant_1',
      visits: 5,
      total: 730,
      avgTransaction: 146,
    });
    expect(context.monthlyTrends).toEqual([
      { month: '2025-01', income: 1000, expenses: 600, netSavings: 400 },
      { month: '2025-02', income: 500, expenses: 200, netSavings: 300 },
    ]);
    expect(context.analytics).toEqual({
      avgMonthlyIncome: 750,
      avgMonthlyExpenses: 400,
      avgMonthlySavings: 350,
      savingsRate: 47,
    });
    expect(context.investments).toEqual({
      totalValue: 40000,
      liquidValue: 10000,
      accountCount: 2,
    });
    expect(db.query).toHaveBeenCalledTimes(7);
  });

  it('swallows investment-query failures while keeping analytics context', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [
            {
              transaction_count: '1',
              total_income: '400',
              total_expenses: '100',
              earliest_date: '2025-01-01',
              latest_date: '2025-01-02',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ month: '2025-01', income: '400', expenses: '100' }],
        })
        .mockRejectedValueOnce(new Error('missing investment tables')),
    };

    const context = await buildContext(
      db,
      {
        allowTransactionAccess: false,
        allowCategoryAccess: false,
        allowAnalyticsAccess: true,
      },
      { months: 1 },
    );

    expect(context.analytics).toEqual({
      avgMonthlyIncome: 400,
      avgMonthlyExpenses: 100,
      avgMonthlySavings: 300,
      savingsRate: 75,
    });
    expect(context.investments).toBeUndefined();
    expect(db.query).toHaveBeenCalledTimes(3);
  });

  it('formats prompt context with sections, status markers, and denied permission note', () => {
    const formatted = formatContextForPrompt({
      hasData: true,
      summary: {
        transactionCount: 10,
        totalIncome: 5000,
        totalExpenses: 3200,
        timeRange: { months: 3 },
      },
      categories: [
        { name: 'Food', totalExpenses: 1000, count: 4 },
        { name: 'Transport', totalExpenses: 600, count: 3 },
        { name: 'Housing', totalExpenses: 1200, count: 1 },
        { name: 'Health', totalExpenses: 250, count: 1 },
        { name: 'Leisure', totalExpenses: 150, count: 1 },
        { name: 'IgnoredSixth', totalExpenses: 80, count: 1 },
      ],
      budgets: [
        { category: 'Food', spent: 650, budget: 600, percentUsed: 108 },
        { category: 'Transport', spent: 450, budget: 500, percentUsed: 90 },
        { category: 'Health', spent: 100, budget: 400, percentUsed: 25 },
      ],
      analytics: {
        avgMonthlyIncome: 1667,
        avgMonthlyExpenses: 1067,
        avgMonthlySavings: 600,
        savingsRate: 36,
      },
      investments: {
        totalValue: 25000,
        liquidValue: 10000,
        accountCount: 2,
      },
      permissions: {
        transactions: false,
        categories: true,
        analytics: false,
      },
    });

    expect(formatted).toContain('FINANCIAL SUMMARY (Last 3 months):');
    expect(formatted).toContain('TOP SPENDING CATEGORIES:');
    expect(formatted).toContain('BUDGET STATUS (This Month):');
    expect(formatted).toContain('⚠️ OVER');
    expect(formatted).toContain('⚡ WARNING');
    expect(formatted).toContain('✓');
    expect(formatted).toContain('MONTHLY AVERAGES:');
    expect(formatted).toContain('INVESTMENTS:');
    expect(formatted).toContain('NOTE: User has not granted access to: transaction details, analytics and trends');
    expect(formatted).not.toContain('IgnoredSixth');
  });

  it('returns no-data message when context has no data', () => {
    const formatted = formatContextForPrompt({ hasData: false });
    expect(formatted).toContain('No financial data available yet');
  });

  it('returns schema description containing core tables and SQL guidance', () => {
    const schema = getSchemaDescription();
    expect(schema).toContain('transactions:');
    expect(schema).toContain('category_definitions:');
    expect(schema).toContain('transaction_pairing_exclusions:');
    expect(schema).toContain('Always use parameterized-style placeholders ($1, $2)');
    expect(schema).toContain('Always use SQLite syntax');
  });
});
