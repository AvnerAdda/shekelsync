import { expect, Page, Request, Route } from '@playwright/test';

type HandlerContext = {
  page: Page;
  route: Route;
  request: Request;
  url: URL;
};

type Handler = (ctx: HandlerContext) => Promise<void> | void;

const jsonResponse = (data: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(data),
});

const respondWith =
  (data: unknown, status = 200): Handler =>
  async ({ route }) => {
    await route.fulfill(jsonResponse(data, status));
  };

const respondOK: Handler = async ({ route }) => {
  await route.fulfill(jsonResponse({ success: true }, 200));
};

const credentials = [
  {
    id: 1,
    vendor: 'isracard',
    nickname: 'Test Card',
    created_at: '2025-09-01T00:00:00.000Z',
    username: 'test-user',
    password: 'secret',
  },
];

const scrapeEvents = [
  {
    id: 1,
    created_at: '2025-09-20T00:00:00.000Z',
    status: 'success',
  },
];

const accountsLastUpdate = [
  {
    id: 1,
    lastUpdate: '2025-09-15T00:00:00.000Z',
    lastScrapeStatus: 'success',
  },
];

const investmentAccounts = [
  {
    id: 101,
    account_name: 'Brokerage Demo',
    account_type: 'brokerage',
    account_number: '1234',
    currency: 'ILS',
    last_update_date: '2025-09-20T00:00:00.000Z',
    total_value: 24000,
  },
];

const categoryHierarchy = {
  categories: [
    {
      id: 1,
      name: 'Expenses',
      name_en: 'Expenses',
      parent_id: null,
      category_type: 'expense',
      display_order: 1,
      icon: 'Payments',
      color: '#1976d2',
      description: 'Expense categories',
      is_active: true,
      hierarchy_path: '1',
      depth_level: 0,
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z',
      transaction_count: 0,
      total_amount: 0,
      children: [
        {
          id: 2,
          name: 'Rent',
          name_en: 'Rent',
          parent_id: 1,
          category_type: 'expense',
          display_order: 1,
          icon: 'Home',
          color: '#1565c0',
          description: '',
          is_active: true,
          hierarchy_path: '1>2',
          depth_level: 1,
          transaction_count: 0,
          total_amount: 0,
          children: [],
        },
        {
          id: 3,
          name: 'Groceries',
          name_en: 'Groceries',
          parent_id: 1,
          category_type: 'expense',
          display_order: 2,
          icon: 'ShoppingCart',
          color: '#1e88e5',
          description: '',
          is_active: true,
          hierarchy_path: '1>3',
          depth_level: 1,
          transaction_count: 0,
          total_amount: 0,
          children: [],
        },
      ],
    },
  ],
  uncategorized: {
    totalCount: 0,
    totalAmount: 0,
    recentTransactions: [],
  },
  bankTransactions: {
    totalCount: 0,
    totalAmount: 0,
    recentTransactions: [],
  },
};

const budgetsUsage = [
  {
    id: 1,
    category_definition_id: 2,
    category_name: 'Rent',
    category_name_en: 'Rent',
    parent_category_name: 'Housing',
    parent_category_name_en: 'Housing',
    period_type: 'monthly',
    budget_limit: 4000,
    is_active: true,
    spent: 3200,
    remaining: 800,
    percentage: 80,
    status: 'warning',
  },
  {
    id: 2,
    category_definition_id: 3,
    category_name: 'Groceries',
    category_name_en: 'Groceries',
    parent_category_name: 'Expenses',
    parent_category_name_en: 'Expenses',
    period_type: 'monthly',
    budget_limit: 2500,
    is_active: true,
    spent: 1200,
    remaining: 1300,
    percentage: 48,
    status: 'good',
  },
];

const onboardingStatus = {
  isComplete: true,
  completedSteps: {
    profile: true,
    bankAccount: true,
    creditCard: true,
    firstScrape: true,
    explored: true,
  },
  stats: {
    accountCount: 1,
    bankAccountCount: 1,
    creditCardCount: 1,
    transactionCount: 12,
    lastScrapeDate: '2025-09-20T00:00:00.000Z',
    hasProfile: true,
  },
  suggestedAction: null,
};

const analyticsDashboard = {
  summary: {
    totalIncome: 2000,
    totalExpenses: 1500,
    netBalance: 500,
    investmentOutflow: 300,
    investmentInflow: 150,
    netInvestments: -150,
  },
  history: [
    { date: '2025-09-01', income: 1000, expenses: 750 },
    { date: '2025-09-02', income: 1000, expenses: 750 },
  ],
  categories: [],
  topVendors: [],
};

const analyticsBreakdown = {
  breakdowns: {
    byCategory: [
      {
        parentId: 1,
        category: 'Housing',
        icon: 'Home',
        color: '#1976d2',
        total: 3200,
        count: 3,
        subcategories: [
          {
            id: 2,
            name: 'Rent',
            total: 3000,
            count: 1,
            color: '#1565c0',
            icon: 'Apartment',
            description: 'Monthly rent payments',
          },
        ],
      },
    ],
    byVendor: [{ vendor: 'Landlord', total: 3000, count: 1 }],
    byMonth: [{ month: '2025-09', total: 1500 }],
  },
  summary: {
    total: 1500,
    count: 5,
    average: 300,
    min: 50,
    max: 600,
  },
};

const waterfallFlow = {
  summary: {
    totalIncome: 2000,
    totalExpenses: 1500,
    netInvestments: -150,
    netBalance: 350,
    totalTransactions: 12,
  },
  waterfallData: [
    {
      name: 'Income',
      value: 2000,
      type: 'income',
      cumulative: 2000,
      startValue: 0,
      color: '#16a34a',
      count: 4,
    },
    {
      name: 'Expenses',
      value: -1500,
      type: 'expense',
      cumulative: 500,
      startValue: 2000,
      color: '#dc2626',
      count: 8,
    },
    {
      name: 'Investments',
      value: -150,
      type: 'investment',
      cumulative: 350,
      startValue: 500,
      color: '#3b82f6',
      count: 2,
    },
  ],
  breakdown: {
    income: [],
    expenses: [],
    investments: [],
  },
};

const investmentsSummary = {
  summary: {
    totalPortfolioValue: 38000,
    totalCostBasis: 33000,
    gainLoss: 5000,
    gainLossPercentage: 15.15,
    liquid: {
      totalValue: 24000,
      totalCost: 20000,
      gainLoss: 4000,
      gainLossPercentage: 20,
    },
    restricted: {
      totalValue: 14000,
      totalCost: 13000,
      gainLoss: 1000,
      gainLossPercentage: 7.69,
    },
  },
  accounts: [
    {
      id: 101,
      account_name: 'Brokerage Demo',
      account_type: 'brokerage',
      institution: 'Demo Brokerage',
      account_number: '1234',
      currency: 'ILS',
      notes: 'Mock brokerage account',
      is_liquid: true,
      investment_category: 'liquid',
      current_value: 24000,
      cost_basis: 20000,
      as_of_date: '2025-09-20T00:00:00.000Z',
      assets: [
        {
          asset_name: 'MSFT',
          asset_type: 'stock',
          units: 20,
          average_cost: 3000,
          current_value: 3200,
          cost_basis: 3000,
        },
      ],
    },
    {
      id: 202,
      account_name: 'Pension Fund',
      account_type: 'pension',
      institution: 'Pension Authority',
      account_number: '8877',
      currency: 'ILS',
      notes: 'Mock pension fund',
      is_liquid: false,
      investment_category: 'restricted',
      current_value: 14000,
      cost_basis: 13000,
      as_of_date: '2025-09-20T00:00:00.000Z',
      assets: [],
    },
  ],
  breakdown: [
    {
      type: 'brokerage',
      name: 'Brokerage Account',
      name_he: 'חשבון ברוקר',
      totalValue: 24000,
      totalCost: 20000,
      count: 1,
      percentage: 63.16,
      accounts: [
        {
          id: 101,
          account_name: 'Brokerage Demo',
          current_value: 24000,
          cost_basis: 20000,
          investment_category: 'liquid',
          as_of_date: '2025-09-20T00:00:00.000Z',
          institution: 'Demo Brokerage',
          assets: [
            {
              asset_name: 'MSFT',
              asset_type: 'stock',
              units: 20,
              average_cost: 3000,
              current_value: 3200,
              cost_basis: 3000,
            },
          ],
        },
      ],
    },
    {
      type: 'pension',
      name: 'Pension Fund',
      name_he: 'קרן פנסיה',
      totalValue: 14000,
      totalCost: 13000,
      count: 1,
      percentage: 36.84,
      accounts: [
        {
          id: 202,
          account_name: 'Pension Fund',
          current_value: 14000,
          cost_basis: 13000,
          investment_category: 'restricted',
          as_of_date: '2025-09-20T00:00:00.000Z',
          institution: 'Pension Authority',
          assets: [],
        },
      ],
    },
  ],
  summary: {
    totalPortfolioValue: 38000,
    totalCostBasis: 33000,
    unrealizedGainLoss: 5000,
    roi: 15.15,
    totalAccounts: 2,
    accountsWithValues: 2,
    oldestUpdateDate: '2025-09-20T00:00:00.000Z',
    newestUpdateDate: '2025-09-20T00:00:00.000Z',
    liquid: {
      totalValue: 24000,
      totalCost: 20000,
      unrealizedGainLoss: 4000,
      roi: 20,
      accountsCount: 1,
    },
    restricted: {
      totalValue: 14000,
      totalCost: 13000,
      unrealizedGainLoss: 1000,
      roi: 7.69,
      accountsCount: 1,
    },
  },
  timeline: [
    { date: '2025-08-01', totalValue: 36000, totalCost: 32000, gainLoss: 4000 },
    { date: '2025-09-01', totalValue: 38000, totalCost: 33000, gainLoss: 5000 },
  ],
  liquidAccounts: [],
  restrictedAccounts: [],
};

const defaultProfile = {
  profile: {
    id: 1,
    username: 'Jane Doe',
    marital_status: 'Single',
    age: 32,
    birth_date: '1993-06-15',
    occupation: 'Engineer',
    monthly_income: 15000,
    family_status: 'Single',
    location: 'Tel Aviv',
    industry: 'Tech',
    children_count: 0,
    household_size: 1,
    home_ownership: 'rent',
    education_level: 'bachelor',
    employment_status: 'employed',
  },
  spouse: null,
  children: [],
};

const analyticsInvestments = {
  summary: {
    totalCount: 3,
    totalInflow: 1200,
    totalOutflow: 900,
    net: 300,
  },
  transactions: [
    {
      identifier: 'txn-1',
      vendor: 'Tel Aviv Exchange',
      date: '2025-09-10',
      name: 'Stock Purchase',
      price: -500,
      category_name: 'Investments',
      parent_name: 'Financial',
    },
    {
      identifier: 'txn-2',
      vendor: 'Mutual Fund',
      date: '2025-09-12',
      name: 'Fund Contribution',
      price: -400,
      category_name: 'Investments',
      parent_name: 'Financial',
    },
    {
      identifier: 'txn-3',
      vendor: 'Brokerage Demo',
      date: '2025-09-15',
      name: 'Dividend',
      price: 200,
      category_name: 'Income',
      parent_name: 'Investments',
    },
  ],
  timeline: [
    { month: '2025-07', inflow: 400, outflow: 300, net: 100 },
    { month: '2025-08', inflow: 400, outflow: 350, net: 50 },
    { month: '2025-09', inflow: 400, outflow: 250, net: 150 },
  ],
};

const personalIntelligence = {
  temporalIntelligence: {
    monthOverMonth: {
      change: 5,
      trend: 'up',
      description: 'Spending decreased 5% vs last month.',
    },
    streaks: [],
    paydayEffect: {
      lift: 12,
      description: 'Spending spikes after payday.',
    },
  },
  behavioralIntelligence: {
    impulseScore: 72,
    impulseDrivers: ['Weekend dining', 'Online shopping'],
    paydaySensitivity: 'medium',
  },
  comparativeIntelligence: {
    peerGroup: 'Families with similar income',
    savingsRanking: 65,
    spendingRanking: 45,
  },
  microInsights: [
    {
      title: 'Subscription review',
      description: 'Three subscriptions renewed this month. Check if all are still needed.',
      category: 'subscriptions',
    },
  ],
  efficiencyMetrics: {
    savingsRate: 0.22,
    expenseRatio: 0.55,
    runwayMonths: 7,
  },
  predictiveAnalytics: {
    projectedBalance: 1200,
    forecastHorizon: '3_months',
    riskLevel: 'moderate',
  },
  psychologicalInsights: {
    spendingTriggers: ['Weekend leisure'],
    financialPersonality: 'Planner',
  },
  recommendations: [
    {
      title: 'Reduce dining spend',
      message: 'Aim to cut weekend dining by ₪250 to unlock additional savings.',
      potentialSavings: 250,
    },
  ],
  overallHealthScore: 78,
  healthBreakdown: {
    savingsScore: 80,
    diversityScore: 68,
    impulseScore: 72,
    runwayScore: 70,
  },
};

const spendingBreakdown = {
  period: { start: '2025-01-01', end: '2025-01-31' },
  breakdown: [
    {
      spending_category: 'essential',
      transaction_count: 15,
      total_amount: 3200,
      avg_transaction: 213,
      first_transaction_date: '2025-01-01',
      last_transaction_date: '2025-01-25',
      actual_percentage: 52,
      target_percentage: 50,
      variance: 2,
      status: 'over',
    },
    {
      spending_category: 'reward',
      transaction_count: 8,
      total_amount: 900,
      avg_transaction: 112,
      first_transaction_date: '2025-01-02',
      last_transaction_date: '2025-01-24',
      actual_percentage: 15,
      target_percentage: 15,
      variance: 0,
      status: 'on_track',
    },
  ],
  total_spending: 4100,
  total_income: 8000,
  targets: {
    essential: 50,
    growth: 20,
    stability: 10,
    reward: 15,
  },
  categories_by_allocation: {
    essential: [
      {
        category_definition_id: 1,
        category_name: 'Groceries',
        spending_category: 'essential',
        total_amount: 2000,
        percentage_of_income: 25,
        transaction_count: 10,
      },
    ],
    reward: [],
    growth: [],
    stability: [],
    unallocated: [],
  },
};

const notificationsResponse = {
  success: true,
  data: {
    summary: {
      total: 2,
      by_type: {
        budget_warning: 1,
        unusual_spending: 1,
      },
      by_severity: {
        critical: 1,
        warning: 1,
        info: 0,
      },
    },
    notifications: [
      {
        id: 'notif-1',
        type: 'budget_warning',
        severity: 'critical',
        title: 'Budget exceeded',
        message: 'Housing budget is over the limit by ₪600.',
        data: {
          category: 'Housing',
          overrun: 600,
        },
        timestamp: '2025-09-20T09:30:00.000Z',
        actionable: true,
        actions: [
          {
            label: 'Review budgets',
            action: 'bulk_refresh',
          },
        ],
      },
      {
        id: 'notif-2',
        type: 'unusual_spending',
        severity: 'warning',
        title: 'Unusual transaction',
        message: '₪1,200 spent at Mega Electronics looks higher than usual.',
        data: {
          vendor: 'Mega Electronics',
          amount: 1200,
        },
        timestamp: '2025-09-19T14:15:00.000Z',
        actionable: false,
      },
    ],
  },
};

const defaultHandlers: Record<string, Handler> = {
  'GET /api/ping': respondWith({ status: 'ok' }),
  'GET /api/credentials': respondWith(credentials),
  'POST /api/credentials': respondOK,
  'GET /api/accounts/last-update': respondWith(accountsLastUpdate),
  'GET /api/accounts/unpaired-transactions-count': respondWith({ count: 0 }),
  'GET /api/accounts/pairing': respondWith({ pairings: [] }),
  'GET /api/accounts/find-settlement-candidates': respondWith({ candidates: [], stats: {} }),
  'GET /api/accounts/truly-unpaired-transactions': respondWith({ transactions: [] }),
  'GET /api/scrape_events': respondWith(scrapeEvents),
  'POST /api/scrape': respondOK,
  'POST /api/scrape/bulk': respondOK,
  'GET /api/categories/hierarchy': respondWith(categoryHierarchy),
  'GET /api/categories/transactions': respondWith({ transactions: [] }),
  'GET /api/get_all_categories': respondWith([
    { category: 'Housing', count: 12 },
    { category: 'Transportation', count: 6 },
  ]),
  'GET /api/investments/accounts': respondWith({ accounts: investmentAccounts }),
  'GET /api/investments/assets': respondWith([]),
  'GET /api/investments/holdings': respondWith([]),
  'GET /api/investments/pending-suggestions': respondWith([]),
  'GET /api/investments/history': respondWith({ history: [] }),
  'GET /api/investments/summary': respondWith(investmentsSummary),
  'GET /api/investments/patterns': respondWith([]),
  'GET /api/investments/check-existing': respondWith({ exists: false }),
  'GET /api/analytics/dashboard': respondWith(analyticsDashboard),
  'GET /api/analytics/breakdown': respondWith(analyticsBreakdown),
  'GET /api/analytics/waterfall-flow': respondWith(waterfallFlow),
  'GET /api/analytics/unified-category': respondWith({ categories: [] }),
  'GET /api/analytics/investments': respondWith(analyticsInvestments),
  'GET /api/analytics/personal-intelligence': respondWith(personalIntelligence),
  'GET /api/forecast/daily': respondWith({
    budgetOutlook: [],
    budgetSummary: { totalBudgets: 0, highRisk: 0, exceeded: 0, totalProjectedOverrun: 0 },
  }),
  'GET /api/spending-categories/breakdown': respondWith(spendingBreakdown),
  'POST /api/spending-categories/initialize': respondWith({ success: true, created: 4, skipped: 0, total: 4 }),
  'GET /api/spending-categories/mappings': respondWith({ mappings: [] }),
  'PUT /api/spending-categories/targets': respondOK,
  'GET /api/analytics/category-details': respondWith({
    summary: {},
    transactions: [],
  }),
  'GET /api/analytics/transactions-by-date': respondWith({ transactions: [] }),
  'GET /api/budgets/usage': respondWith(budgetsUsage),
  'GET /api/budgets': respondWith(budgetsUsage),
  'POST /api/budgets': respondOK,
  'PUT /api/budgets': respondOK,
  'DELETE /api/budgets': respondOK,
  'GET /api/categorization_rules': respondWith([]),
  'POST /api/categorization_rules/auto-create': respondOK,
  'GET /api/categorization_rules/preview': respondWith({
    totalCount: 0,
    transactions: [],
  }),
  'GET /api/data/export': respondWith({ ok: true }),
  'POST /api/data/export': respondOK,
  'GET /api/onboarding/status': respondWith(onboardingStatus),
  'POST /api/onboarding/dismiss': respondOK,
  'GET /api/notifications': respondWith(notificationsResponse),
  'GET /api/notifications?limit=20': respondWith(notificationsResponse),
  'POST /api/scrape/bulk': respondWith({
    success: true,
    totalProcessed: 1,
    successCount: 1,
    totalTransactions: 12,
  }),
  'GET /api/profile': respondWith(defaultProfile),
  'PUT /api/profile': async ({ route, request }) => {
    const payload = request.postData() ? JSON.parse(request.postData() as string) : defaultProfile;
    await route.fulfill(jsonResponse(payload, 200));
  },
  'GET /api/patterns/index': respondWith({ patterns: [] }),
  'GET /api/patterns': respondWith({ patterns: [] }),
};

export async function setupRendererTest(
  page: Page,
  overrides: Record<string, Handler> = {},
) {
  await page.addInitScript((session) => {
    try {
      window.localStorage.setItem('clarify.auth.session', JSON.stringify(session));
    } catch (error) {
      console.warn('[setupRendererTest] Failed to seed auth session:', error);
    }
  }, {
    accessToken: 'test-token',
    tokenType: 'Bearer',
    user: {
      name: 'Demo User',
      email: 'demo@example.com',
    },
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      // eslint-disable-next-line no-console
      console.error(`[console.${msg.type()}] ${msg.text()}`);
    }
  });

  page.on('pageerror', (error) => {
    // eslint-disable-next-line no-console
    console.error(`[pageerror] ${error.message}`);
  });

  const handlers = { ...defaultHandlers, ...overrides };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'OPTIONS') {
      return route.fulfill({ status: 204 });
    }

    const key = `${method} ${url.pathname}`;
    const handler = handlers[key] || handlers[url.pathname];

    if (handler) {
      await handler({ page, route, request, url });
      return;
    }

    await route.fulfill(jsonResponse({}));
  });
}

export const goHome = async (page: Page) => {
  await page.goto('/#/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('banner').getByText('ShekelSync', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Account' })).toBeVisible();
};

export type { Handler };
