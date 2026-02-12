import { afterEach, describe, expect, it, vi } from 'vitest';

type Category = {
  id: number;
  name: string;
  name_en: string;
  name_fr: string;
  icon: string;
  color: string;
  parent_id: number | null;
  category_type: 'expense' | 'income' | 'investment';
};

type Budget = {
  id: number;
  category_definition_id: number;
  period_type: 'monthly';
  budget_limit: number;
  is_active: 0 | 1;
};

type Tx = {
  date: string;
  name: string;
  price: number;
  category_type: 'expense' | 'income' | 'investment';
  category_definition_id: number | null;
  status: 'completed';
  identifier: string;
  vendor: string;
};

type PairingExclusion = {
  transaction_identifier: string;
  transaction_vendor: string;
};

type Dataset = {
  categories: Category[];
  budgets: Budget[];
  transactions: Tx[];
  exclusions: PairingExclusion[];
};

type ForecastModule = {
  generateDailyForecast: (options?: Record<string, unknown>) => Promise<any>;
  getForecast: (options?: Record<string, unknown>) => Promise<any>;
  __setDatabaseCtor?: (ctor: any) => void;
  _internal?: {
    buildBudgetOutlook?: (result: any) => any;
  };
};

let cachedForecastModule: ForecastModule | null = null;

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function sameExclusion(tx: Tx, ex: PairingExclusion): boolean {
  return tx.identifier === ex.transaction_identifier && tx.vendor === ex.transaction_vendor;
}

function isExcluded(tx: Tx, exclusions: PairingExclusion[]): boolean {
  return exclusions.some((ex) => sameExclusion(tx, ex));
}

function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

function dayOfWeek(date: string): string {
  return String(new Date(date).getDay());
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function toAllTransactionsRow(tx: Tx, categoriesById: Map<number, Category>) {
  const category = tx.category_definition_id ? categoriesById.get(tx.category_definition_id) : null;
  const parent = category?.parent_id ? categoriesById.get(category.parent_id) : null;

  return {
    date: tx.date,
    name: tx.name,
    price: tx.price,
    category_type: tx.category_type,
    category_name: category?.name ?? null,
    parent_category_name: parent?.name ?? null,
    day_of_week: dayOfWeek(tx.date),
    day_of_month: dayOfMonth(tx.date),
    month: monthKey(tx.date),
  };
}

function buildRichDataset(now = new Date()): Dataset {
  const categories: Category[] = [
    { id: 1, name: 'Rent', name_en: 'Rent', name_fr: 'Loyer', icon: 'home', color: '#5C6AC4', parent_id: null, category_type: 'expense' },
    { id: 2, name: 'Groceries', name_en: 'Groceries', name_fr: 'Courses', icon: 'cart', color: '#2E7D32', parent_id: null, category_type: 'expense' },
    { id: 3, name: 'Dining', name_en: 'Dining', name_fr: 'Restaurants', icon: 'food', color: '#EF6C00', parent_id: null, category_type: 'expense' },
    { id: 50, name: 'Salary', name_en: 'Salary', name_fr: 'Salaire', icon: 'money', color: '#1976D2', parent_id: null, category_type: 'income' },
    { id: 60, name: 'Investments', name_en: 'Investments', name_fr: 'Investissements', icon: 'chart', color: '#6A1B9A', parent_id: null, category_type: 'investment' },
  ];

  const transactions: Tx[] = [];
  for (let monthOffset = 0; monthOffset < 8; monthOffset += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const prefix = `${yyyy}-${mm}`;

    transactions.push(
      { date: `${prefix}-03`, name: 'Salary Payroll', price: 12000, category_type: 'income', category_definition_id: 50, status: 'completed', identifier: `salary-${prefix}`, vendor: 'employer' },
      { date: `${prefix}-05`, name: 'Rent Payment', price: -3900, category_type: 'expense', category_definition_id: 1, status: 'completed', identifier: `rent-${prefix}`, vendor: 'landlord' },
      { date: `${prefix}-02`, name: 'Supermarket A', price: -240, category_type: 'expense', category_definition_id: 2, status: 'completed', identifier: `groc-a-${prefix}`, vendor: 'supermarket' },
      { date: `${prefix}-04`, name: 'Supermarket B', price: -220, category_type: 'expense', category_definition_id: 2, status: 'completed', identifier: `groc-b-${prefix}`, vendor: 'supermarket' },
      { date: `${prefix}-06`, name: 'Supermarket C', price: -260, category_type: 'expense', category_definition_id: 2, status: 'completed', identifier: `groc-c-${prefix}`, vendor: 'supermarket' },
      { date: `${prefix}-08`, name: 'Supermarket D', price: -230, category_type: 'expense', category_definition_id: 2, status: 'completed', identifier: `groc-d-${prefix}`, vendor: 'supermarket' },
      { date: `${prefix}-10`, name: 'Restaurant Night', price: -180, category_type: 'expense', category_definition_id: 3, status: 'completed', identifier: `dining-${prefix}`, vendor: 'restaurant' },
      { date: `${prefix}-12`, name: 'Broker Transfer', price: -900, category_type: 'investment', category_definition_id: 60, status: 'completed', identifier: `invest-${prefix}`, vendor: 'broker' },
    );
  }

  const currentPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  transactions.push({
    date: `${currentPrefix}-09`,
    name: 'Excluded Purchase',
    price: -999,
    category_type: 'expense',
    category_definition_id: 3,
    status: 'completed',
    identifier: 'excluded-1',
    vendor: 'excluded-vendor',
  });

  const budgets: Budget[] = [
    { id: 11, category_definition_id: 1, period_type: 'monthly', budget_limit: 4200, is_active: 1 },
    { id: 12, category_definition_id: 2, period_type: 'monthly', budget_limit: 900, is_active: 1 },
    { id: 13, category_definition_id: 3, period_type: 'monthly', budget_limit: 500, is_active: 1 },
  ];

  const exclusions: PairingExclusion[] = [
    { transaction_identifier: 'excluded-1', transaction_vendor: 'excluded-vendor' },
  ];

  return { categories, budgets, transactions, exclusions };
}

function buildOldOnlyDataset(now = new Date()): Dataset {
  const rich = buildRichDataset(now);
  const oldDate = new Date(now.getFullYear(), now.getMonth() - 18, 15);
  const yyyy = oldDate.getFullYear();
  const mm = String(oldDate.getMonth() + 1).padStart(2, '0');
  const dd = String(oldDate.getDate()).padStart(2, '0');

  return {
    categories: rich.categories,
    budgets: [],
    exclusions: [],
    transactions: [
      {
        date: `${yyyy}-${mm}-${dd}`,
        name: 'Legacy Expense',
        price: -300,
        category_type: 'expense',
        category_definition_id: 3,
        status: 'completed',
        identifier: 'legacy-1',
        vendor: 'legacy-vendor',
      },
    ],
  };
}

function buildEmptyDataset(): Dataset {
  return {
    categories: [],
    budgets: [],
    transactions: [],
    exclusions: [],
  };
}

function executeQuery(dataset: Dataset, sql: string, params: unknown[]) {
  const q = normalize(sql);
  const categoriesById = new Map(dataset.categories.map((c) => [c.id, c]));

  if (q.includes('FROM transactions t') && q.includes('ORDER BY t.date;')) {
    let rows = dataset.transactions.filter((tx) => tx.status === 'completed');
    rows = rows.filter((tx) => !isExcluded(tx, dataset.exclusions));
    if (q.includes('AND t.date >= ?')) {
      const since = String(params[0] ?? '');
      rows = rows.filter((tx) => tx.date >= since);
    }
    return rows
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((tx) => toAllTransactionsRow(tx, categoriesById));
  }

  if (q.includes("WHERE strftime('%Y-%m', t.date) = ?") && q.includes('ORDER BY t.date;')) {
    const currentMonth = String(params[0] ?? '');
    const rows = dataset.transactions
      .filter((tx) => tx.status === 'completed')
      .filter((tx) => !isExcluded(tx, dataset.exclusions))
      .filter((tx) => monthKey(tx.date) === currentMonth)
      .sort((a, b) => a.date.localeCompare(b.date));

    return rows.map((tx) => {
      const category = tx.category_definition_id ? categoriesById.get(tx.category_definition_id) : null;
      return {
        date: tx.date,
        name: tx.name,
        price: tx.price,
        category_type: tx.category_type,
        category_name: category?.name ?? null,
        day_of_week: dayOfWeek(tx.date),
        day_of_month: dayOfMonth(tx.date),
      };
    });
  }

  if (q.includes('FROM category_definitions') && q.includes("WHERE category_type = 'expense'")) {
    return dataset.categories
      .filter((c) => c.category_type === 'expense')
      .map((c) => ({
        id: c.id,
        name: c.name,
        name_en: c.name_en,
        name_fr: c.name_fr,
        icon: c.icon,
        color: c.color,
        parent_id: c.parent_id,
      }));
  }

  if (q.includes('SUM(ABS(t.price)) AS spent') && q.includes("strftime('%Y-%m', t.date) = ?")) {
    const month = String(params[0] ?? '');
    const grouped = new Map<number, number>();
    for (const tx of dataset.transactions) {
      if (tx.status !== 'completed') continue;
      if (tx.category_type !== 'expense') continue;
      if (tx.price >= 0) continue;
      if (!tx.category_definition_id) continue;
      if (monthKey(tx.date) !== month) continue;
      if (isExcluded(tx, dataset.exclusions)) continue;
      grouped.set(tx.category_definition_id, (grouped.get(tx.category_definition_id) || 0) + Math.abs(tx.price));
    }

    return Array.from(grouped.entries()).map(([categoryId, spent]) => {
      const cat = categoriesById.get(categoryId);
      return {
        category_definition_id: categoryId,
        category_name: cat?.name ?? null,
        category_name_en: cat?.name_en ?? null,
        category_name_fr: cat?.name_fr ?? null,
        category_icon: cat?.icon ?? null,
        category_color: cat?.color ?? null,
        parent_category_id: cat?.parent_id ?? null,
        spent,
      };
    });
  }

  if (q.includes('FROM category_budgets cb') && q.includes('cb.period_type = \'monthly\'')) {
    return dataset.budgets
      .filter((b) => b.is_active === 1 && b.period_type === 'monthly')
      .map((b) => {
        const cat = categoriesById.get(b.category_definition_id);
        return {
          budget_id: b.id,
          category_definition_id: b.category_definition_id,
          period_type: b.period_type,
          budget_limit: b.budget_limit,
          is_active: b.is_active,
          category_name: cat?.name ?? null,
          category_name_en: cat?.name_en ?? null,
          category_name_fr: cat?.name_fr ?? null,
          category_icon: cat?.icon ?? null,
          category_color: cat?.color ?? null,
          parent_category_id: cat?.parent_id ?? null,
        };
      });
  }

  return [];
}

function createBetterSqliteMock(dataset: Dataset) {
  return function FakeDatabase() {
    return {
      pragma: () => undefined,
      prepare: (sql: string) => ({
        run: () => ({ changes: 1 }),
        get: () => undefined,
        all: (...params: unknown[]) => executeQuery(dataset, sql, params),
      }),
      close: () => undefined,
    };
  };
}

async function loadForecastModule(dataset: Dataset): Promise<ForecastModule> {
  if (!cachedForecastModule) {
    const imported = await import('../forecast.js');
    cachedForecastModule = imported.default ?? imported;
  }
  (cachedForecastModule as any).__setDatabaseCtor(createBetterSqliteMock(dataset));
  return cachedForecastModule;
}

afterEach(() => {
  if (cachedForecastModule && typeof (cachedForecastModule as any).__resetDatabaseCtor === 'function') {
    (cachedForecastModule as any).__resetDatabaseCtor();
  }
});

describe('forecast service integration', () => {
  it('generates daily forecasts and scenarios from mocked sqlite data', async () => {
    const forecast = await loadForecastModule(buildRichDataset());

    const result = await forecast.generateDailyForecast({
      includeToday: true,
      forecastDays: 10,
      historyMonths: 24,
      monteCarloRuns: 8,
      noCache: true,
    });

    expect(result.forecastPeriod.days).toBe(10);
    expect(result.dailyForecasts).toHaveLength(10);
    expect(result.monteCarloResults.numSimulations).toBe(8);
    expect(result.scenarios.p50.dailyResults).toHaveLength(10);
    expect(result.analysisInfo.totalTransactions).toBeGreaterThan(20);
    expect(result.categoryPatterns.some((p: any) => p.category === 'Rent')).toBe(true);
    expect(result.categoryPatterns.some((p: any) => p.category === 'Groceries')).toBe(true);
    expect(Object.keys(result.monthlyAdjustments).length).toBeGreaterThan(0);
  });

  it('uses cached forecasts when cache is enabled and bypasses with noCache', async () => {
    const forecast = await loadForecastModule(buildRichDataset());

    const cachedA = await forecast.generateDailyForecast({
      includeToday: true,
      forecastDays: 5,
      historyMonths: 24,
      monteCarloRuns: 4,
      cacheDurationMs: 120_000,
    });

    const cachedB = await forecast.generateDailyForecast({
      includeToday: true,
      forecastDays: 5,
      historyMonths: 24,
      monteCarloRuns: 4,
      cacheDurationMs: 120_000,
    });

    expect(cachedB).toBe(cachedA);

    const uncached = await forecast.generateDailyForecast({
      includeToday: true,
      forecastDays: 5,
      historyMonths: 24,
      monteCarloRuns: 4,
      noCache: true,
    });

    expect(uncached).not.toBe(cachedA);
  });

  it('bypasses cache when cacheDurationMs=0 or noCache string flag is provided', async () => {
    const forecast = await loadForecastModule(buildRichDataset());

    const uncachedA = await forecast.generateDailyForecast({
      includeToday: true,
      forecastDays: 4,
      historyMonths: 24,
      monteCarloRuns: 3,
      cacheDurationMs: 0,
    });
    const uncachedB = await forecast.generateDailyForecast({
      includeToday: true,
      forecastDays: 4,
      historyMonths: 24,
      monteCarloRuns: 3,
      cacheDurationMs: 0,
    });
    expect(uncachedB).not.toBe(uncachedA);

    const uncachedStringA = await forecast.generateDailyForecast({
      includeToday: true,
      forecastDays: 4,
      historyMonths: 24,
      monteCarloRuns: 3,
      noCache: '1',
    });
    const uncachedStringB = await forecast.generateDailyForecast({
      includeToday: true,
      forecastDays: 4,
      historyMonths: 24,
      monteCarloRuns: 3,
      noCache: '1',
    });
    expect(uncachedStringB).not.toBe(uncachedStringA);
  });

  it('falls back to all transactions when recent history window is empty', async () => {
    const forecast = await loadForecastModule(buildOldOnlyDataset());

    const result = await forecast.generateDailyForecast({
      includeToday: true,
      forecastDays: 3,
      historyMonths: 1,
      monteCarloRuns: 3,
      noCache: true,
    });

    expect(result.forecastPeriod.days).toBe(3);
    expect(result.analysisInfo.totalTransactions).toBe(1);
    expect(result.analysisInfo.historySince).toBeNull();
  });

  it('supports historyMonths=0 and string-based numeric option parsing', async () => {
    const forecast = await loadForecastModule(buildRichDataset());

    const result = await forecast.generateDailyForecast({
      includeToday: true,
      forecastDays: '3',
      forecastMonths: 2,
      historyMonths: 0,
      monteCarloRuns: 'invalid-value',
      noCache: true,
    });

    expect(result.forecastPeriod.days).toBe(3);
    expect(result.analysisInfo.historySince).toBeNull();
    expect(result.monteCarloResults.numSimulations).toBeGreaterThan(0);
  });

  it('throws a clear error when no transactions are available', async () => {
    const forecast = await loadForecastModule(buildEmptyDataset());

    await expect(
      forecast.generateDailyForecast({
        includeToday: true,
        forecastDays: 2,
        historyMonths: 12,
        monteCarloRuns: 3,
        noCache: true,
      }),
    ).rejects.toThrow('No transactions found in database');
  });

  it('logs the month-end rollover note when forecasting from the last day of month', async () => {
    vi.useFakeTimers();
    const monthEnd = new Date('2026-01-31T12:00:00.000Z');
    vi.setSystemTime(monthEnd);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const forecast = await loadForecastModule(buildRichDataset(monthEnd));
    const result = await forecast.generateDailyForecast({
      includeToday: false,
      forecastDays: 1,
      historyMonths: 24,
      monteCarloRuns: 2,
      noCache: true,
      verbose: true,
    });

    expect(result.forecastPeriod.start).toBe('2026-02-01');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Today is the last day of the month'),
    );

    logSpy.mockRestore();
    vi.useRealTimers();
  });

  it('returns budget outlook and enriched quest-facing patterns via getForecast', async () => {
    const forecast = await loadForecastModule(buildRichDataset());

    const result = await forecast.getForecast({
      includeToday: true,
      forecastDays: 7,
      historyMonths: 24,
      monteCarloRuns: 6,
      noCache: true,
    });

    expect(Array.isArray(result.budgetOutlook)).toBe(true);
    expect(result.budgetOutlook.length).toBeGreaterThan(0);
    expect(result.budgetSummary.totalBudgets).toBeGreaterThan(0);
    expect(result.budgetSummary.highRisk + result.budgetSummary.exceeded).toBeGreaterThanOrEqual(1);
    expect(result.patterns.some((p: any) => p.categoryName === 'Rent' && p.categoryDefinitionId === 1)).toBe(true);
    expect(result.patterns.some((p: any) => p.categoryName === 'Rent' && p.fixedDayOfMonth !== null)).toBe(true);
    expect(result.forecastByCategory).toBeInstanceOf(Map);
  });

  it('handles category/budget query failures in buildBudgetOutlook and still returns a fallback outlook', async () => {
    const forecast = await loadForecastModule(buildEmptyDataset());
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const closeMock = vi.fn();

    const failingCtor = function FailingDb() {
      return {
        prepare: (sql: string) => ({
          all: () => {
            const q = normalize(sql);
            if (
              q.includes('FROM category_definitions') ||
              q.includes('SUM(ABS(t.price)) AS spent') ||
              q.includes('FROM category_budgets cb')
            ) {
              throw new Error('forced query failure');
            }
            return [];
          },
        }),
        close: closeMock,
      };
    };

    forecast.__setDatabaseCtor?.(failingCtor as any);

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const syntheticResult = {
      dailyForecasts: [
        {
          date: today,
          predictions: [
            {
              categoryType: 'expense',
              category: 'Fallback Category',
              transactionName: 'Fallback Category',
              probabilityWeightedAmount: 120,
            },
          ],
        },
      ],
      scenarios: {
        p10: { dailyResults: [{ date: today, expenses: 80 }] },
        p50: { dailyResults: [{ date: today, expenses: 100 }] },
        p90: { dailyResults: [{ date: today, expenses: 130 }] },
      },
    };

    const outlook = forecast._internal?.buildBudgetOutlook?.(syntheticResult);
    expect(outlook).toBeTruthy();
    expect(outlook.budgetOutlook).toHaveLength(1);
    expect(outlook.budgetOutlook[0].categoryName).toBe('Fallback Category');
    expect(closeMock).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('derives budgeted and unbudgeted status branches in buildBudgetOutlook', async () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const currentMonthPrefix = `${yyyy}-${mm}`;
    const mkDate = (day: number) => `${currentMonthPrefix}-${String(day).padStart(2, '0')}`;

    const dataset: Dataset = {
      categories: [
        { id: 1, name: 'Rent', name_en: 'Rent', name_fr: 'Loyer', icon: 'home', color: '#111111', parent_id: null, category_type: 'expense' },
        { id: 2, name: 'Groceries', name_en: 'Groceries', name_fr: 'Courses', icon: 'cart', color: '#222222', parent_id: null, category_type: 'expense' },
        { id: 3, name: 'Dining', name_en: 'Dining', name_fr: 'Restaurants', icon: 'food', color: '#333333', parent_id: null, category_type: 'expense' },
        { id: 4, name: 'NoBudgetRisk', name_en: 'NoBudgetRisk', name_fr: 'SansBudgetRisque', icon: 'risk', color: '#444444', parent_id: null, category_type: 'expense' },
        { id: 5, name: 'NoBudgetExceeded', name_en: 'NoBudgetExceeded', name_fr: 'SansBudgetDepasse', icon: 'alert', color: '#555555', parent_id: null, category_type: 'expense' },
      ],
      budgets: [
        { id: 11, category_definition_id: 1, period_type: 'monthly', budget_limit: 100, is_active: 1 },
        { id: 12, category_definition_id: 2, period_type: 'monthly', budget_limit: 200, is_active: 1 },
        { id: 13, category_definition_id: 3, period_type: 'monthly', budget_limit: 500, is_active: 1 },
      ],
      transactions: [
        { date: mkDate(3), name: 'Rent Payment', price: -120, category_type: 'expense', category_definition_id: 1, status: 'completed', identifier: 'rent-1', vendor: 'rent' },
        { date: mkDate(4), name: 'Groceries Buy', price: -160, category_type: 'expense', category_definition_id: 2, status: 'completed', identifier: 'gro-1', vendor: 'gro' },
        { date: mkDate(5), name: 'Dining Night', price: -100, category_type: 'expense', category_definition_id: 3, status: 'completed', identifier: 'din-1', vendor: 'din' },
        { date: mkDate(6), name: 'NoBudget Risk Spend', price: -300, category_type: 'expense', category_definition_id: 4, status: 'completed', identifier: 'nbr-1', vendor: 'nbr' },
        { date: mkDate(7), name: 'NoBudget Exceeded Spend', price: -300, category_type: 'expense', category_definition_id: 5, status: 'completed', identifier: 'nbe-1', vendor: 'nbe' },
      ],
      exclusions: [],
    };

    const forecast = await loadForecastModule(dataset);
    const today = mkDate(Math.max(1, now.getDate()));
    const syntheticResult = {
      dailyForecasts: [
        {
          date: today,
          predictions: [
            { categoryType: 'expense', category: 'Rent', transactionName: 'Rent', probabilityWeightedAmount: 10 },
            { categoryType: 'expense', category: 'Groceries', transactionName: 'Groceries', probabilityWeightedAmount: 50 },
            { categoryType: 'expense', category: 'Dining', transactionName: 'Dining', probabilityWeightedAmount: 50 },
            { categoryType: 'expense', category: 'NoBudgetRisk', transactionName: 'NoBudgetRisk', probabilityWeightedAmount: 20 },
            { categoryType: 'expense', category: 'NoBudgetExceeded', transactionName: 'NoBudgetExceeded', probabilityWeightedAmount: -60 },
          ],
        },
      ],
      scenarios: {
        p10: { dailyResults: [{ date: today, expenses: -50 }] },
        p50: { dailyResults: [{ date: today, expenses: 100 }] },
        p90: { dailyResults: [{ date: today, expenses: 100 }] },
      },
    };

    const outlook = forecast._internal?.buildBudgetOutlook?.(syntheticResult);
    expect(outlook).toBeTruthy();
    expect(outlook.budgetOutlook.length).toBeGreaterThanOrEqual(5);

    const byName = new Map(outlook.budgetOutlook.map((row: any) => [row.categoryName, row]));
    expect(byName.get('Rent').status).toBe('exceeded');
    expect(byName.get('Groceries').status).toBe('at_risk');
    expect(byName.get('Dining').status).toBe('on_track');
    expect(byName.get('NoBudgetRisk').status).toBe('at_risk');
    expect(byName.get('NoBudgetExceeded').status).toBe('exceeded');
    expect(outlook.budgetSummary.exceeded).toBeGreaterThan(0);
    expect(outlook.budgetSummary.highRisk).toBeGreaterThan(0);
    expect(outlook.budgetSummary.totalProjectedOverrun).toBeGreaterThan(0);
  });

  it('marks medium-utilization budgets as at_risk and no-budget categories above p50 as at_risk', async () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const currentMonthPrefix = `${yyyy}-${mm}`;
    const mkDate = (day: number) => `${currentMonthPrefix}-${String(day).padStart(2, '0')}`;
    const today = mkDate(Math.max(1, now.getDate()));

    const dataset: Dataset = {
      categories: [
        { id: 1, name: 'Utilities', name_en: 'Utilities', name_fr: 'Utilities', icon: 'bolt', color: '#111111', parent_id: null, category_type: 'expense' },
        { id: 2, name: 'NoLimitMidRisk', name_en: 'NoLimitMidRisk', name_fr: 'NoLimitMidRisk', icon: 'risk', color: '#222222', parent_id: null, category_type: 'expense' },
      ],
      budgets: [
        { id: 31, category_definition_id: 1, period_type: 'monthly', budget_limit: 1000, is_active: 1 },
      ],
      transactions: [
        { date: mkDate(3), name: 'Utilities Bill', price: -200, category_type: 'expense', category_definition_id: 1, status: 'completed', identifier: 'util-1', vendor: 'util' },
        { date: mkDate(4), name: 'No Limit Spend', price: -260, category_type: 'expense', category_definition_id: 2, status: 'completed', identifier: 'nolimit-1', vendor: 'nolimit' },
      ],
      exclusions: [],
    };

    const forecast = await loadForecastModule(dataset);
    const syntheticResult = {
      dailyForecasts: [
        {
          date: today,
          predictions: [
            { categoryType: 'expense', category: 'Utilities', transactionName: 'Utilities', probabilityWeightedAmount: 600 },
            { categoryType: 'expense', category: 'NoLimitMidRisk', transactionName: 'NoLimitMidRisk', probabilityWeightedAmount: -1 },
          ],
        },
      ],
      scenarios: {
        p10: { dailyResults: [{ date: today, expenses: 80 }] },
        p50: { dailyResults: [{ date: today, expenses: 100 }] },
        p90: { dailyResults: [{ date: today, expenses: 40 }] },
      },
    };

    const outlook = forecast._internal?.buildBudgetOutlook?.(syntheticResult);
    expect(outlook).toBeTruthy();

    const byName = new Map(outlook.budgetOutlook.map((row: any) => [row.categoryName, row]));
    expect(byName.get('Utilities').status).toBe('at_risk');
    expect(byName.get('Utilities').risk).toBeCloseTo(0.8, 2);

    expect(byName.get('NoLimitMidRisk').status).toBe('at_risk');
    expect(byName.get('NoLimitMidRisk').risk).toBe(0.7);
  });
});
