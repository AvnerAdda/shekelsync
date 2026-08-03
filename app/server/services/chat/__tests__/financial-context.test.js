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
    expect(context.profile).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(2);
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
            {
              username: 'Dana',
              marital_status: 'Married',
              age: '35',
              occupation: 'Engineer',
              monthly_income: '22000',
              employment_status: 'employed',
              family_status: 'married_with_children',
              location: 'Tel Aviv',
              industry: 'Tech',
              children_count: '2',
              household_size: '4',
              spouse_name: 'Alex',
              spouse_occupation: 'Designer',
              spouse_monthly_income: '9000',
              children_count_actual: '2',
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
            {
              merchant_name: 'Merchant_1',
              occurrence_count: '4',
              avg_amount: '182.50',
              first_seen: '2025-01-01',
              last_seen: '2025-02-01',
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
            { income: '900', expenses: '500' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              total_value: '40000',
              liquid_value: '10000',
              account_count: '2',
              holding_count: '6',
              latest_as_of_date: '2025-02-01',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              action_type: 'quest_reduce_spending',
              severity: 'low',
              action_count: '2',
              potential_impact: '1200',
              avg_confidence: '0.8',
              nearest_deadline: '2025-02-15',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { status: 'active', subscription_count: '3', monthly_total: '250' },
            { status: 'review', subscription_count: '1', monthly_total: '80' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { renewal_count: '2', next_renewal_date: '2025-02-10', monthly_total: '120' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { severity: 'warning', alert_count: '1' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              transaction_count: '4',
              earliest_transaction_date: '2025-01-01',
              latest_transaction_date: '2025-02-01',
              active_months: '2',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { scrape_count: '3', latest_scrape_at: '2025-02-02' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { spending_category: 'essential', target_percentage: '50', total_amount: '600' },
            { spending_category: 'growth', target_percentage: '20', total_amount: '400' },
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
    expect(context.profile).toEqual({
      name: 'Dana',
      maritalStatus: 'Married',
      age: 35,
      occupation: 'Engineer',
      employmentStatus: 'employed',
      monthlyIncome: 22000,
      familyStatus: 'married_with_children',
      location: 'Tel Aviv',
      industry: 'Tech',
      childrenCount: 2,
      householdSize: 4,
      spouseName: 'Alex',
      spouseOccupation: 'Designer',
      spouseMonthlyIncome: 9000,
    });
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
      holdingCount: 6,
      latestAsOfDate: '2025-02-01',
    });
    expect(context.smartActions).toEqual([
      expect.objectContaining({
        actionType: 'quest_reduce_spending',
        count: 2,
        potentialImpact: 1200,
        nearestDeadline: '2025-02-15',
      }),
    ]);
    expect(context.subscriptions).toMatchObject({
      byStatus: [
        { status: 'active', count: 3, monthlyTotal: 250 },
        { status: 'review', count: 1, monthlyTotal: 80 },
      ],
      upcoming: { count: 2, nextRenewalDate: '2025-02-10', monthlyTotal: 120 },
      alerts: [{ severity: 'warning', count: 1 }],
    });
    expect(context.dataFreshness).toEqual({
      transactionCount: 4,
      earliestTransactionDate: '2025-01-01',
      latestTransactionDate: '2025-02-01',
      activeMonths: 2,
      scrapeCount: 3,
      latestScrapeAt: '2025-02-02',
    });
    expect(context.spendingTargets).toEqual([
      { spendingCategory: 'essential', targetPercentage: 50, actualPercentage: 60, driftPercentage: 10, amount: 600 },
      { spendingCategory: 'growth', targetPercentage: 20, actualPercentage: 40, driftPercentage: 20, amount: 400 },
    ]);
    expect(db.query).toHaveBeenCalled();
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
          rows: [],
        })
        .mockResolvedValueOnce({
          rows: [{ month: '2025-01', income: '400', expenses: '100' }],
        })
        .mockResolvedValueOnce({
          rows: [{ income: '0', expenses: '0' }],
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
    expect(db.query).toHaveBeenCalled();
  });

  it('formats prompt context with sections, status markers, and denied permission note', () => {
    const formatted = formatContextForPrompt({
      hasData: true,
      profile: {
        name: 'Dana',
        occupation: 'Engineer',
        monthlyIncome: 22000,
        maritalStatus: 'Married',
      },
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
        holdingCount: 5,
        latestAsOfDate: '2025-02-01',
      },
      smartActions: [
        {
          actionType: 'quest_reduce_spending',
          severity: 'low',
          count: 2,
          potentialImpact: 1200,
          nearestDeadline: '2025-02-15',
          nextStep: 'choose one spending category to reduce this month',
        },
      ],
      subscriptions: {
        byStatus: [
          { status: 'active', count: 3, monthlyTotal: 250 },
          { status: 'review', count: 1, monthlyTotal: 80 },
        ],
        upcoming: { count: 2, nextRenewalDate: '2025-02-10' },
        alerts: [{ severity: 'warning', count: 1 }],
      },
      spendingTargets: [
        { spendingCategory: 'essential', targetPercentage: 50, actualPercentage: 60, driftPercentage: 10, amount: 600 },
      ],
      dataFreshness: {
        transactionCount: 10,
        activeMonths: 3,
        latestTransactionDate: '2025-02-01',
        latestScrapeAt: '2025-02-02',
      },
      permissions: {
        transactions: false,
        categories: true,
        analytics: false,
      },
    });

    expect(formatted).toContain('USER PROFILE:');
    expect(formatted).toContain('Name: Dana');
    expect(formatted).toContain('Occupation: Engineer');
    expect(formatted).toContain('Reported monthly income: ₪22,000');
    expect(formatted).toContain('FINANCIAL SUMMARY (Last 3 months):');
    expect(formatted).toContain('TOP SPENDING CATEGORIES:');
    expect(formatted).toContain('BUDGET STATUS (This Month):');
    expect(formatted).toContain('⚠️ OVER');
    expect(formatted).toContain('⚡ WARNING');
    expect(formatted).toContain('✓');
    expect(formatted).toContain('MONTHLY AVERAGES:');
    expect(formatted).toContain('INVESTMENTS:');
    expect(formatted).toContain('Active holdings: 5');
    expect(formatted).toContain('ACTIVE PROACTIVE ACTIONS:');
    expect(formatted).toContain('SUBSCRIPTION SIGNALS:');
    expect(formatted).toContain('SPENDING TARGETS (This Month):');
    expect(formatted).toContain('DATA FRESHNESS:');
    expect(formatted).toContain('NOTE: User has not granted access to: transaction details, analytics and trends');
    expect(formatted).toContain('IgnoredSixth');
  });

  it('returns no-data message when context has no data', () => {
    const formatted = formatContextForPrompt({ hasData: false });
    expect(formatted).toContain('No financial data available yet');
  });

  it('includes profile in no-data responses', () => {
    const formatted = formatContextForPrompt({
      hasData: false,
      profile: {
        name: 'Dana',
        occupation: 'Engineer',
      },
    });
    expect(formatted).toContain('USER PROFILE:');
    expect(formatted).toContain('Name: Dana');
    expect(formatted).toContain('No financial data available yet');
  });

  it('returns schema description containing core tables and SQL guidance', () => {
    const schema = getSchemaDescription();
    expect(schema).toContain('transactions:');
    expect(schema).toContain('category_definitions:');
    expect(schema).toContain('investment_holdings:');
    expect(schema).toContain('spending_category_targets:');
    expect(schema).not.toContain('subscriptions:');
    expect(schema).not.toContain('smart_action_items:');
    expect(schema).toContain('user_profile:');
    expect(schema).toContain('transaction_pairing_exclusions:');
    expect(schema).toContain('Always use parameterized-style placeholders ($1, $2)');
    expect(schema).toContain('Always use SQLite syntax');
  });
});
