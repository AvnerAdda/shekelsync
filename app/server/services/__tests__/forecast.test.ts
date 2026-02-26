import { beforeAll, describe, expect, it, vi } from 'vitest';

let forecastModule: any;

beforeAll(async () => {
  forecastModule = await import('../forecast.js');
});

describe('forecast service internals', () => {
  it('treats forecastDays=0 as an empty window (no fallback to months)', () => {
    const { resolveForecastWindow, formatDate } = forecastModule._internal;
    const now = new Date(2025, 11, 31, 12, 0, 0);

    const { startDate, endDate } = resolveForecastWindow(now, {
      includeToday: false,
      forecastDays: 0,
      forecastMonths: 6,
    });

    expect(formatDate(startDate)).toBe('2026-01-01');
    expect(formatDate(endDate)).toBe('2025-12-31');
    expect(endDate.getTime()).toBeLessThan(startDate.getTime());
  });

  it('clamps monthly patterns to the last day when the target day does not exist', () => {
    const { calculateDayProbability } = forecastModule._internal;
    const feb28 = new Date(2026, 1, 28);

    const dayOfWeekProb: Record<string, number> = {
      0: 1,
      1: 1,
      2: 1,
      3: 1,
      4: 1,
      5: 1,
      6: 1,
    };

    const incomePattern = {
      categoryType: 'income',
      patternType: 'monthly',
      avgOccurrencesPerMonth: 1,
      dayOfWeekProb,
      dayOfMonthProb: { 31: 1 },
      mostLikelyDaysOfMonth: [{ day: 31, probability: 1 }],
    };

    const expensePattern = {
      categoryType: 'expense',
      patternType: 'monthly',
      avgOccurrencesPerMonth: 1,
      dayOfWeekProb,
      dayOfMonthProb: { 31: 1 },
      mostLikelyDaysOfMonth: [{ day: 31, probability: 1 }],
    };

    expect(calculateDayProbability(incomePattern, feb28, {}, 'salary')).toBeGreaterThan(0);
    expect(calculateDayProbability(expensePattern, feb28, {}, 'rent')).toBeGreaterThan(0);
  });

  it('suppresses monthly patterns when the last occurrence was very recent (even across a month boundary)', () => {
    const { calculateDayProbability } = forecastModule._internal;
    const jan1 = new Date(2026, 0, 1);

    const basePattern = {
      categoryType: 'income',
      patternType: 'monthly',
      avgOccurrencesPerMonth: 1,
      dayOfWeekProb: { [jan1.getDay()]: 0.01 },
      dayOfMonthProb: { 1: 0.01 },
      mostLikelyDaysOfMonth: [{ day: 1, probability: 1 }],
    };

    const tooSoonAcrossMonth = calculateDayProbability(
      { ...basePattern, lastOccurrence: '2025-12-25' }, // 7 days gap
      jan1,
      {},
      'salary',
    );
    const okAcrossMonth = calculateDayProbability(
      { ...basePattern, lastOccurrence: '2025-12-01' }, // 31 days gap
      jan1,
      {},
      'salary',
    );

    expect(tooSoonAcrossMonth).toBe(0);
    expect(okAcrossMonth).toBeGreaterThan(0);
  });

  it('suppresses low-frequency expense patterns until enough spacing has passed', () => {
    const { calculateDayProbability } = forecastModule._internal;
    const jan30 = new Date(2026, 0, 30);

    const lowFrequencyExpense = {
      categoryType: 'expense',
      patternType: 'sporadic',
      avgOccurrencesPerMonth: 0.1,
      dayOfWeekProb: { [jan30.getDay()]: 1 },
      dayOfMonthProb: { 30: 1 },
      mostLikelyDaysOfMonth: [{ day: 30, probability: 1 }],
      lastOccurrence: '2025-12-30',
    };

    const probability = calculateDayProbability(lowFrequencyExpense, jan30, {}, 'rent');
    expect(probability).toBe(0);
  });

  it('suppresses monthly expense patterns late in the current month when nothing has occurred', () => {
    const { adjustProbabilitiesForCurrentMonth } = forecastModule._internal;
    const patterns = {
      rent: {
        categoryType: 'expense',
        patternType: 'monthly',
        avgOccurrencesPerMonth: 1,
        mostLikelyDaysOfMonth: [{ day: 6, probability: 1 }],
      },
    };

    const adjustments = adjustProbabilitiesForCurrentMonth(patterns, [], 25);
    expect(adjustments.rent.probabilityMultiplier).toBe(0);
  });

  it('adjusts multipliers for monthly, weekly and daily patterns based on observed transactions', () => {
    const { adjustProbabilitiesForCurrentMonth } = forecastModule._internal;
    const patterns = {
      salary: {
        categoryType: 'income',
        patternType: 'monthly',
        avgOccurrencesPerMonth: 1,
      },
      rent: {
        categoryType: 'expense',
        patternType: 'monthly',
        avgOccurrencesPerMonth: 1,
      },
      groceries: {
        categoryType: 'expense',
        patternType: 'weekly',
        avgOccurrencesPerMonth: 8,
      },
      coffee: {
        categoryType: 'expense',
        patternType: 'daily',
        avgOccurrencesPerMonth: 18,
      },
    };

    const txns = [
      { name: 'salary', day_of_month: 2, day_of_week: 1, category_name: 'Income', date: '2026-02-02', price: 10000 },
      { name: 'rent', day_of_month: 9, day_of_week: 1, category_name: 'Housing', date: '2026-02-09', price: -4000 },
      { name: 'groceries', day_of_month: 3, day_of_week: 2, category_name: 'Groceries', date: '2026-02-03', price: -300 },
      { name: 'coffee', day_of_month: 20, day_of_week: 5, category_name: 'Coffee', date: '2026-02-20', price: -20 },
    ];

    const adjustments = adjustProbabilitiesForCurrentMonth(patterns, txns, 20);

    expect(adjustments.salary.probabilityMultiplier).toBe(0);
    expect(adjustments.rent.probabilityMultiplier).toBe(0.2);
    expect(adjustments.groceries.probabilityMultiplier).toBeGreaterThan(1);
    expect(adjustments.coffee.probabilityMultiplier).toBeLessThan(1);
  });

  it('uses dominant day cluster to suppress stale monthly expenses with no current-month occurrences', () => {
    const { adjustProbabilitiesForCurrentMonth } = forecastModule._internal;
    const patterns = {
      insurance: {
        categoryType: 'expense',
        patternType: 'monthly',
        avgOccurrencesPerMonth: 1,
        dominantDayCluster: [2, 3],
      },
    };

    const adjustments = adjustProbabilitiesForCurrentMonth(patterns, [], 20);
    expect(adjustments.insurance.probabilityMultiplier).toBe(0);
    expect(adjustments.insurance.expectedRemaining).toBe(0);
  });

  it('computes daily pattern probability from average frequency and day-of-week signal', () => {
    const { calculateDayProbability } = forecastModule._internal;
    const date = new Date(2026, 0, 13); // Tuesday
    const day = date.getDay();

    const pattern = {
      categoryType: 'expense',
      patternType: 'daily',
      avgOccurrencesPerMonth: 15,
      dayOfWeekProb: { 0: 1, 1: 1, 2: 0.5, 3: 1, 4: 1, 5: 1, 6: 1, [day]: 0.5 },
      dayOfMonthProb: {},
    };

    const probability = calculateDayProbability(pattern, date, {}, 'coffee');
    expect(probability).toBeCloseTo(0.25, 6);
  });

  it('returns zero for monthly patterns outside likely day-of-month windows', () => {
    const { calculateDayProbability } = forecastModule._internal;
    const date = new Date(2026, 0, 5);

    const pattern = {
      categoryType: 'expense',
      patternType: 'monthly',
      avgOccurrencesPerMonth: 1,
      dayOfWeekProb: { [date.getDay()]: 1 },
      dayOfMonthProb: { 15: 1 },
      mostLikelyDaysOfMonth: [{ day: 15, probability: 1 }],
    };

    const probability = calculateDayProbability(pattern, date, {}, 'rent');
    expect(probability).toBe(0);
  });

  it('suppresses monthly income outlier days when a recent dominant-cluster occurrence exists', () => {
    const { calculateDayProbability } = forecastModule._internal;
    const outlierDate = new Date(2026, 0, 20);

    const pattern = {
      categoryType: 'income',
      patternType: 'monthly',
      avgOccurrencesPerMonth: 1,
      dayOfWeekProb: { [outlierDate.getDay()]: 1 },
      dayOfMonthProb: { 20: 1, 1: 1, 2: 1 },
      mostLikelyDaysOfMonth: [{ day: 1, probability: 1 }],
      dominantDayCluster: [1, 2],
      lastOccurrence: '2026-01-02',
    };

    const probability = calculateDayProbability(pattern, outlierDate, {}, 'salary');
    expect(probability).toBe(0);
  });

  it('caps high-frequency expense probabilities after multipliers and scaling', () => {
    const { calculateDayProbability } = forecastModule._internal;
    const date = new Date(2026, 0, 10);
    const day = date.getDay();

    const pattern = {
      categoryType: 'expense',
      patternType: 'weekly',
      avgOccurrencesPerMonth: 12,
      dayOfWeekProb: { [day]: 1 },
      dayOfMonthProb: { [date.getDate()]: 1 },
    };

    const probability = calculateDayProbability(
      pattern,
      date,
      { groceries: { probabilityMultiplier: 2 } },
      'groceries',
    );

    expect(probability).toBe(0.7);
  });

  it('enforces a small floor for tail-only expense probabilities', () => {
    const { calculateDayProbability } = forecastModule._internal;
    const date = new Date(2026, 0, 7);

    const pattern = {
      categoryType: 'expense',
      patternType: 'sporadic',
      avgOccurrencesPerMonth: 1,
      dayOfWeekProb: { [date.getDay()]: 0 },
      dayOfMonthProb: { [date.getDate()]: 0 },
      tailOnly: true,
    };

    const probability = calculateDayProbability(pattern, date, {}, 'tail-only');
    expect(probability).toBe(0.04);
  });

  it('suppresses low-frequency patterns outside dominant day grace window', () => {
    const { calculateDayProbability } = forecastModule._internal;
    const date = new Date(2026, 0, 20);

    const pattern = {
      categoryType: 'expense',
      patternType: 'sporadic',
      avgOccurrencesPerMonth: 0.2,
      dayOfWeekProb: { [date.getDay()]: 1 },
      dayOfMonthProb: { 10: 1 },
      mostLikelyDaysOfMonth: [{ day: 10, probability: 1 }],
    };

    const probability = calculateDayProbability(pattern, date, {}, 'annual-fee');
    expect(probability).toBe(0);
  });

  it('handles includeToday and invalid date parsing branches', () => {
    const { resolveForecastWindow, parseLocalDate, formatDate } = forecastModule._internal;
    const now = new Date(2026, 1, 10, 12, 0, 0);

    const { startDate, endDate } = resolveForecastWindow(now, {
      includeToday: true,
      forecastDays: 3,
      forecastMonths: 2,
    });

    expect(formatDate(startDate)).toBe('2026-02-10');
    expect(formatDate(endDate)).toBe('2026-02-12');
    const invalidDate = parseLocalDate('not-a-date');
    expect(Number.isNaN(invalidDate.getTime())).toBe(true);
  });

  it('exposes numeric utilities and db path resolution internals', () => {
    const { parsePositiveInt, mean, standardDeviation, getDayName, resolveForecastDbPath } = forecastModule._internal;

    expect(parsePositiveInt('12.7', 3)).toBe(12);
    expect(parsePositiveInt('0', 3)).toBe(3);
    expect(mean([])).toBe(0);
    expect(mean([2, 4, 6])).toBe(4);
    expect(standardDeviation([])).toBe(0);
    expect(getDayName(2)).toBe('Tuesday');

    const originalPath = process.env.SQLITE_DB_PATH;
    process.env.SQLITE_DB_PATH = '/tmp/forecast-test.sqlite';
    expect(resolveForecastDbPath()).toBe('/tmp/forecast-test.sqlite');
    if (typeof originalPath === 'undefined') {
      delete process.env.SQLITE_DB_PATH;
    } else {
      process.env.SQLITE_DB_PATH = originalPath;
    }
  });

  it('analyzes recurring income clusters while preserving sparse expense and investment tails', () => {
    const { analyzeCategoryPatterns } = forecastModule._internal;
    const makeTxn = (
      date: string,
      name: string,
      price: number,
      categoryType: 'income' | 'expense' | 'investment',
      categoryName: string,
    ) => ({
      date,
      name,
      price,
      category_type: categoryType,
      category_name: categoryName,
      parent_category_name: null,
      day_of_week: String(new Date(date).getDay()),
      day_of_month: Number(date.slice(8, 10)),
      month: date.slice(0, 7),
    });

    const patterns = analyzeCategoryPatterns([
      makeTxn('2025-01-05', 'Salary Payroll', 12000, 'income', 'Salary'),
      makeTxn('2025-02-06', 'Salary Payroll', 12000, 'income', 'Salary'),
      makeTxn('2025-03-05', 'Salary Payroll', 12000, 'income', 'Salary'),
      makeTxn('2025-04-28', 'Salary Payroll', 12000, 'income', 'Salary'),
      makeTxn('2025-04-14', 'Groceries One-Off', -90, 'expense', 'Groceries'),
      makeTxn('2024-01-10', 'Broker Transfer', -500, 'investment', 'Investments'),
      makeTxn('2024-08-10', 'Broker Transfer', -500, 'investment', 'Investments'),
      makeTxn('2025-03-10', 'Broker Transfer', -500, 'investment', 'Investments'),
      makeTxn('2025-03-11', 'Excluded Capital Return', -200, 'expense', 'החזר קרן'),
    ]);

    const incomePattern = patterns['Salary Payroll'];
    expect(incomePattern).toBeTruthy();
    expect(incomePattern.patternType).toBe('monthly');
    expect(incomePattern.dominantDayCluster).toEqual(expect.arrayContaining([5, 6]));

    const expensePattern = patterns.Groceries;
    expect(expensePattern.tailOnly).toBe(true);

    const investmentPattern = patterns.Investments;
    expect(investmentPattern.tailOnly).toBe(true);
    expect(investmentPattern.skipReason).toBe('non_recurrent_investment');

    expect(patterns['החזר קרן']).toBeUndefined();
  });

  it('builds pattern caches and reads probability threshold from cache', () => {
    const { buildPatternCaches, getProbabilityThreshold } = forecastModule._internal;
    const patterns: Record<string, any> = {
      salary: {
        category: 'Salary',
        transactionName: 'Salary Payroll',
        categoryType: 'income',
        patternType: 'monthly',
        avgOccurrencesPerMonth: 1,
        dayOfWeekProb: { 1: 1 },
        dayOfMonthProb: { 5: 1 },
        mostLikelyDaysOfMonth: [{ day: 5, probability: 1 }],
        coefficientOfVariation: 0.5,
        lastOccurrence: '2025-04-05',
        dominantDayCluster: [4, 5, 6],
      },
    };

    const entries = buildPatternCaches(patterns);
    expect(entries).toHaveLength(1);
    expect(patterns.salary._cache.domDaysByMonthLength[30].topDomDays).toContain(5);
    expect(getProbabilityThreshold(patterns.salary)).toBeCloseTo(0.03, 6);
  });

  it('handles sampling/simulation helpers deterministically with fixed monthly picks', () => {
    const {
      sampleAmount,
      willOccur,
      buildChosenMonthlyOccurrenceDateByMonth,
      simulateScenario,
      runMonteCarloSimulation,
    } = forecastModule._internal;

    const randomSpy = vi.spyOn(Math, 'random');
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5);
    expect(sampleAmount(5, 10)).toBe(0);
    randomSpy.mockReturnValueOnce(0.2);
    expect(willOccur(0.3)).toBe(true);

    const dailyForecasts = [
      {
        date: '2026-01-05',
        predictions: [{ transactionName: 'Rent', category: 'Rent', isChosenOccurrence: true }],
      },
      {
        date: '2026-01-20',
        predictions: [{ transactionName: 'Rent', category: 'Rent', isChosenOccurrence: false }],
      },
    ];

    const chosenByMonth = buildChosenMonthlyOccurrenceDateByMonth(dailyForecasts);
    expect(chosenByMonth['2026-01'].Rent).toBe('2026-01-05');

    const simulationEntriesByDay = [
      {
        date: '2026-01-05',
        monthKey: '2026-01',
        entries: [{ monthlyKey: 'Rent', patternType: 'monthly', probability: 0.4, avgAmount: 100, stdDev: 0, categoryType: 'expense' }],
      },
      {
        date: '2026-01-20',
        monthKey: '2026-01',
        entries: [{ monthlyKey: 'Rent', patternType: 'monthly', probability: 0.4, avgAmount: 100, stdDev: 0, categoryType: 'expense' }],
      },
    ];

    const scenario = simulateScenario(simulationEntriesByDay, chosenByMonth);
    expect(scenario.totalExpenses).toBe(100);
    expect(scenario.dailyResults[0].expenses).toBe(100);
    expect(scenario.dailyResults[1].expenses).toBe(0);

    const monteCarlo = runMonteCarloSimulation(dailyForecasts, simulationEntriesByDay, 3);
    expect(monteCarlo.numSimulations).toBe(3);
    expect(monteCarlo.base.totalExpenses).toBe(100);
    randomSpy.mockRestore();
  });

  it('normalizes monthly predictions to a single chosen occurrence', () => {
    const { adjustMonthlyPatternForecasts } = forecastModule._internal;
    const dailyForecasts = [
      {
        predictions: [{ transactionName: 'Salary Payroll', category: 'Salary', probability: 0.7, expectedAmount: 100, probabilityWeightedAmount: 70 }],
        expectedIncome: 70,
        expectedExpenses: 0,
        expectedCashFlow: 70,
        topPredictions: [],
      },
      {
        predictions: [{ transactionName: 'Salary Payroll', category: 'Salary', probability: 0.2, expectedAmount: 100, probabilityWeightedAmount: 20 }],
        expectedIncome: 20,
        expectedExpenses: 0,
        expectedCashFlow: 20,
        topPredictions: [],
      },
    ];

    const patterns = {
      salary: {
        patternType: 'monthly',
        transactionName: 'Salary Payroll',
        category: 'Salary',
        categoryType: 'income',
        avgAmount: 100,
      },
    };

    adjustMonthlyPatternForecasts(dailyForecasts, patterns, {});

    expect(dailyForecasts[0].predictions[0].isChosenOccurrence).toBe(true);
    expect(dailyForecasts[0].predictions[0].probability).toBe(1);
    expect(dailyForecasts[0].expectedIncome).toBe(100);

    expect(dailyForecasts[1].predictions[0].isChosenOccurrence).toBe(false);
    expect(dailyForecasts[1].predictions[0].probability).toBe(0);
    expect(dailyForecasts[1].expectedIncome).toBe(0);
  });

  it('handles category-definition loading failures without throwing', () => {
    const { loadCategoryDefinitions } = forecastModule._internal;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = {
      prepare: () => ({
        all: () => {
          throw new Error('query failed');
        },
      }),
    };

    const loaded = loadCategoryDefinitions(db);
    expect(loaded.categoryDefinitionsByName).toEqual({});
    expect(loaded.categoryDefinitionsById).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('loads category definitions into name/id lookups on successful queries', () => {
    const { loadCategoryDefinitions } = forecastModule._internal;
    const db = {
      prepare: () => ({
        all: () => ([
          { id: 1, name: 'Groceries', name_en: 'Groceries', name_fr: 'Courses', icon: 'cart', color: '#00aa00', parent_id: null },
          { id: 2, name: 'Dining', name_en: null, name_fr: null, icon: 'food', color: '#ff6600', parent_id: null },
        ]),
      }),
    };

    const loaded = loadCategoryDefinitions(db as any);
    expect(loaded.categoryDefinitionsByName.Groceries.id).toBe(1);
    expect(loaded.categoryDefinitionsByName.Groceries.name_fr).toBe('Courses');
    expect(loaded.categoryDefinitionsByName.Dining.id).toBe(2);
    expect(loaded.categoryDefinitionsById[1].name).toBe('Groceries');
  });

  it('covers sqlite query helper internals with and without date filters', () => {
    const { getAllTransactions, getCurrentMonthTransactions } = forecastModule._internal;
    const preparedSql: string[] = [];
    const allCalls: unknown[][] = [];
    const db = {
      prepare: (sql: string) => {
        preparedSql.push(sql);
        return {
          all: (...args: unknown[]) => {
            allCalls.push(args);
            return [];
          },
        };
      },
    };

    getAllTransactions(db as any, '2026-01-01');
    getAllTransactions(db as any);
    getCurrentMonthTransactions(db as any, '2026-02');

    expect(preparedSql[0]).toContain('AND t.date >= ?');
    expect(preparedSql[1]).not.toContain('AND t.date >= ?');
    expect(preparedSql[2]).toContain("strftime('%Y-%m', t.date) = ?");
    expect(allCalls[0]).toEqual(['2026-01-01']);
    expect(allCalls[1]).toEqual([]);
    expect(allCalls[2]).toEqual(['2026-02']);
  });

  it('opens forecast database via injected ctor and restores ctor hooks', () => {
    const { openForecastDb } = forecastModule._internal;
    const ctorSpy = vi.fn(function MockCtor() {
      return {
        prepare: () => ({ all: () => [] }),
        close: vi.fn(),
      };
    });

    forecastModule.__setDatabaseCtor?.(ctorSpy);
    const db = openForecastDb();
    expect(ctorSpy).toHaveBeenCalledWith(expect.any(String), { readonly: true });
    db.close();
    forecastModule.__resetDatabaseCtor?.();
  });

  it('runs generateForecastAcrossMonths across month boundaries', () => {
    const { buildPatternCaches, generateForecastAcrossMonths } = forecastModule._internal;
    const now = new Date('2026-01-10T12:00:00.000Z');
    const startDate = new Date('2026-01-10T00:00:00.000Z');
    const endDate = new Date('2026-02-03T00:00:00.000Z');

    const dayOfWeekProb: Record<string, number> = {
      0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1,
    };

    const patterns: Record<string, any> = {
      rent: {
        category: 'Rent',
        transactionName: 'Rent',
        categoryType: 'expense',
        patternType: 'monthly',
        avgAmount: 1000,
        stdDev: 0,
        avgOccurrencesPerMonth: 1,
        coefficientOfVariation: 0.2,
        dayOfWeekProb,
        dayOfMonthProb: { 5: 1 },
        mostLikelyDaysOfMonth: [{ day: 5, probability: 1 }],
      },
      groceries: {
        category: 'Groceries',
        transactionName: 'Groceries',
        categoryType: 'expense',
        patternType: 'weekly',
        avgAmount: 120,
        stdDev: 10,
        avgOccurrencesPerMonth: 8,
        coefficientOfVariation: 0.3,
        dayOfWeekProb,
        dayOfMonthProb: { 10: 1 },
      },
    };

    const entries = buildPatternCaches(patterns);
    const db = {
      prepare: () => ({
        all: () => ([
          {
            date: '2026-01-05',
            name: 'Rent',
            price: -1000,
            category_type: 'expense',
            category_name: 'Rent',
            day_of_week: '1',
            day_of_month: 5,
          },
        ]),
      }),
    };

    const out = generateForecastAcrossMonths(
      patterns,
      entries,
      db as any,
      startDate,
      endDate,
      now,
      null,
    );

    // This boundary can vary by one day across environments due to timezone handling in Date arithmetic.
    expect(out.dailyForecasts.length).toBeGreaterThanOrEqual(24);
    expect(out.dailyForecasts.length).toBeLessThanOrEqual(25);
    expect(Object.keys(out.adjustmentsByMonth)).toEqual(expect.arrayContaining(['2026-01', '2026-02']));
    expect(out.simulationEntriesByDay[0]).toHaveProperty('entries');
  });

  it('covers forecastDay output and monthly expense normalization for expense categories', () => {
    const { buildPatternCaches, forecastDay, adjustMonthlyPatternForecasts } = forecastModule._internal;
    const date = new Date('2026-01-05T00:00:00.000Z');
    const day = date.getDay();

    const patterns: Record<string, any> = {
      salary: {
        category: 'Salary',
        transactionName: 'Salary',
        categoryType: 'income',
        patternType: 'daily',
        avgAmount: 300,
        stdDev: 0,
        avgOccurrencesPerMonth: 30,
        coefficientOfVariation: 0.1,
        dayOfWeekProb: { [day]: 1 },
        dayOfMonthProb: {},
      },
      rent: {
        category: 'Rent',
        transactionName: 'Rent',
        categoryType: 'expense',
        patternType: 'monthly',
        avgAmount: 1200,
        stdDev: 0,
        avgOccurrencesPerMonth: 1,
        coefficientOfVariation: 0.1,
        dayOfWeekProb: { [day]: 1 },
        dayOfMonthProb: { 5: 1 },
        mostLikelyDaysOfMonth: [{ day: 5, probability: 1 }],
      },
      etf: {
        category: 'Investments',
        transactionName: 'ETF Buy',
        categoryType: 'investment',
        patternType: 'weekly',
        avgAmount: 200,
        stdDev: 0,
        avgOccurrencesPerMonth: 4,
        coefficientOfVariation: 0.2,
        dayOfWeekProb: { [day]: 1 },
        dayOfMonthProb: { 5: 1 },
      },
    };

    const entries = buildPatternCaches(patterns);
    const simulationEntries: any[] = [];
    const dayForecast = forecastDay(date, patterns, {}, entries, simulationEntries);

    expect(dayForecast.expectedIncome).toBeGreaterThan(0);
    expect(dayForecast.expectedExpenses).toBeGreaterThan(0);
    expect(dayForecast.expectedInvestments).toBeGreaterThan(0);
    expect(simulationEntries.length).toBeGreaterThan(0);

    const expenseMonthlyDaily = [
      {
        predictions: [{ transactionName: 'Rent', category: 'Rent', probability: 0.8, expectedAmount: 1200, probabilityWeightedAmount: 960 }],
        expectedIncome: 0,
        expectedExpenses: 960,
        expectedCashFlow: -960,
        topPredictions: [],
      },
      {
        predictions: [{ transactionName: 'Rent', category: 'Rent', probability: 0.3, expectedAmount: 1200, probabilityWeightedAmount: 360 }],
        expectedIncome: 0,
        expectedExpenses: 360,
        expectedCashFlow: -360,
        topPredictions: [],
      },
    ];

    adjustMonthlyPatternForecasts(expenseMonthlyDaily, {
      rent: {
        patternType: 'monthly',
        transactionName: 'Rent',
        category: 'Rent',
        categoryType: 'expense',
        avgAmount: 1200,
      },
    }, {});

    expect(expenseMonthlyDaily[0].predictions[0].isChosenOccurrence).toBe(true);
    expect(expenseMonthlyDaily[1].predictions[0].isChosenOccurrence).toBe(false);
    expect(expenseMonthlyDaily[0].expectedExpenses).toBe(1200);
    expect(expenseMonthlyDaily[1].expectedExpenses).toBe(0);
  });

  it('covers simulation branches for monthly skips, non-monthly entries, and zero Monte Carlo runs', () => {
    const {
      sampleAmount,
      willOccur,
      simulateScenario,
      runMonteCarloSimulation,
    } = forecastModule._internal;

    expect(sampleAmount(42, 0)).toBe(42);
    expect(willOccur(0)).toBe(false);
    expect(willOccur(1)).toBe(true);

    const simulationEntriesByDay = [
      {
        date: '2026-01-01',
        monthKey: '2026-01',
        entries: [
          { monthlyKey: 'Rent', patternType: 'monthly', probability: 1, avgAmount: 100, stdDev: 0, categoryType: 'expense' },
          { monthlyKey: 'Salary', patternType: 'weekly', probability: 1, avgAmount: 200, stdDev: 0, categoryType: 'income' },
          { monthlyKey: 'ETF', patternType: 'weekly', probability: 1, avgAmount: 50, stdDev: 0, categoryType: 'investment' },
        ],
      },
    ];

    const scenario = simulateScenario(simulationEntriesByDay, { '2026-01': { Rent: '2026-01-02' } });
    expect(scenario.totalExpenses).toBe(0);
    expect(scenario.totalIncome).toBe(200);
    expect(scenario.totalInvestments).toBe(50);

    const monteCarlo = runMonteCarloSimulation(
      [{ date: '2026-01-01', predictions: [] }],
      simulationEntriesByDay,
      0,
    );
    expect(monteCarlo.numSimulations).toBe(0);
    expect(monteCarlo.worst).toBeUndefined();
    expect(Array.isArray(monteCarlo.allScenarios)).toBe(true);
  });
});
