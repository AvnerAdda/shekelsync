const MODEL_ID = 'pattern-v2';
const { prepareProjectionPolicy } = require('./projection-policy.js');
const { buildIncomeSchedule, applyIncomeSchedule } = require('./income-schedule.js');

function withCumulative(scenario) {
  let cum = 0;
  let operatingCum = 0;
  let nonOperatingCum = 0;
  let operatingExpensesCum = 0;
  let nonOperatingExpensesCum = 0;
  const dailyWithCum = (scenario.dailyResults || []).map((day) => {
    cum += Number(day.cashFlow) || 0;
    operatingCum += Number(day.operatingCashFlow) || 0;
    nonOperatingCum += Number(day.nonOperatingCashFlow) || 0;
    operatingExpensesCum += Number(day.operatingExpenses) || 0;
    nonOperatingExpensesCum += Number(day.nonOperatingExpenses) || 0;
    return {
      ...day,
      cumulativeCashFlow: cum,
      cumulativeOperatingCashFlow: operatingCum,
      cumulativeNonOperatingCashFlow: nonOperatingCum,
      cumulativeOperatingExpenses: operatingExpensesCum,
      cumulativeNonOperatingExpenses: nonOperatingExpensesCum,
    };
  });
  return { ...scenario, dailyResults: dailyWithCum };
}

function generateForecast({
  engine,
  db,
  now,
  currentMonth,
  currentDay,
  allTransactions,
  historicalTransactions = allTransactions,
  truthSnapshot,
  historicalTransactionSummary,
  config,
}) {
  const {
    analyzeCategoryPatterns,
    buildPatternCaches,
    buildVariableExpenseMonthlyBaselines,
    generateForecastAcrossMonths,
    injectResolvedRecurringPredictions,
    runMonteCarloSimulation,
    resolveForecastWindow,
    formatDate,
    isLastDayOfMonth,
    isOperatingIncomePattern,
    isOperatingExpensePattern,
    isNonOperatingIncomePattern,
    isNonOperatingExpensePattern,
    logPatternSummary,
  } = engine;

  let categoryDefinitions = [];
  try {
    categoryDefinitions = db.prepare('SELECT id, name, name_en, parent_id, category_type, is_counted_as_income FROM category_definitions').all();
  } catch { /* Older test fixtures can infer metadata from their transaction rows. */ }
  const policy = prepareProjectionPolicy(historicalTransactions, truthSnapshot, engine, categoryDefinitions);
  const originalTruthSnapshot = truthSnapshot;
  truthSnapshot = policy.truthSnapshot;
  allTransactions = policy.transactions.filter(transaction => !originalTruthSnapshot.excludedTransactionKeys.has(`${transaction.identifier}\u0000${transaction.vendor}`));

  const patterns = analyzeCategoryPatterns(allTransactions);
  const patternEntries = buildPatternCaches(patterns);
  const variableExpenseBaselines = buildVariableExpenseMonthlyBaselines(allTransactions, patterns, now);
  const currentMonthTransactions = allTransactions.filter((txn) => txn.month === currentMonth);
  const categoryCount = Object.keys(patterns).length;
  logPatternSummary(patterns);

  const { startDate: forecastStartDate, endDate: forecastEndDate } = resolveForecastWindow(now, {
    includeToday: config.includeToday,
    forecastDays: config.forecastDays,
    forecastMonths: config.forecastMonths,
  });
  if (!config.includeToday && isLastDayOfMonth(now)) {
    engine.log('ℹ️ Today is the last day of the month; starting forecast from next month.');
  }

  const { dailyForecasts, adjustmentsByMonth, simulationEntriesByDay } = generateForecastAcrossMonths(
    patterns,
    patternEntries,
    db,
    forecastStartDate,
    forecastEndDate,
    now,
    currentMonthTransactions,
    variableExpenseBaselines,
    truthSnapshot.categoryExpectations,
  );
  injectResolvedRecurringPredictions(dailyForecasts, simulationEntriesByDay, truthSnapshot);
  const incomeSchedule = buildIncomeSchedule(historicalTransactions, dailyForecasts.map(day => day.date), now, engine, originalTruthSnapshot);
  applyIncomeSchedule(dailyForecasts, simulationEntriesByDay, incomeSchedule, engine);
  const monteCarloResults = runMonteCarloSimulation(
    dailyForecasts,
    simulationEntriesByDay,
    config.monteCarloRuns,
  );

  let cumulativeCashFlow = 0;
  let cumulativeOperatingCashFlow = 0;
  let cumulativeNonOperatingCashFlow = 0;
  let cumulativeOperatingExpenses = 0;
  let cumulativeNonOperatingExpenses = 0;
  dailyForecasts.forEach((day) => {
    cumulativeCashFlow += Number(day.expectedCashFlow) || 0;
    cumulativeOperatingCashFlow += Number(day.expectedOperatingCashFlow) || 0;
    cumulativeNonOperatingCashFlow += Number(day.expectedNonOperatingCashFlow) || 0;
    cumulativeOperatingExpenses += Number(day.expectedOperatingExpenses) || 0;
    cumulativeNonOperatingExpenses += Number(day.expectedNonOperatingExpenses) || 0;
    day.cumulativeCashFlow = cumulativeCashFlow;
    day.cumulativeOperatingCashFlow = cumulativeOperatingCashFlow;
    day.cumulativeNonOperatingCashFlow = cumulativeNonOperatingCashFlow;
    day.cumulativeOperatingExpenses = cumulativeOperatingExpenses;
    day.cumulativeNonOperatingExpenses = cumulativeNonOperatingExpenses;
  });

  const results = {
    modelId: MODEL_ID,
    generated: new Date().toISOString(),
    truthRevision: truthSnapshot.truthRevision,
    analysisInfo: {
      totalTransactions: historicalTransactionSummary.count,
      projectedEvidenceTransactions: allTransactions.length,
      firstTransaction: historicalTransactionSummary.first,
      lastTransaction: historicalTransactionSummary.last,
      totalCategories: categoryCount,
      variableExpenseBaselines: Object.keys(variableExpenseBaselines).length,
      currentMonth,
      currentDay,
      historySince: historicalTransactionSummary.historySince ?? null,
      currentMonthTransactions: currentMonthTransactions.length,
    },
    forecastPeriod: {
      start: formatDate(forecastStartDate),
      end: formatDate(forecastEndDate),
      days: dailyForecasts.length,
    },
    dailyForecasts,
    monteCarloResults: {
      worstCase: monteCarloResults.worst,
      baseCase: monteCarloResults.base,
      bestCase: monteCarloResults.best,
      numSimulations: monteCarloResults.numSimulations,
    },
    scenarios: {
      p10: withCumulative(monteCarloResults.worst),
      p50: withCumulative(monteCarloResults.base),
      p90: withCumulative(monteCarloResults.best),
    },
    categoryPatterns: Object.values(patterns).map((pattern) => ({
      patternKey: pattern.patternKey,
      category: pattern.category,
      categoryNameEn: pattern.categoryNameEn || null,
      categoryDefinitionId: pattern.categoryDefinitionId ?? null,
      transactionName: pattern.transactionName,
      categoryType: pattern.categoryType,
      incomeType: pattern.categoryType === 'income'
        ? (pattern._cache?.incomeType ?? (isOperatingIncomePattern(pattern) ? 'operating' : 'non_operating'))
        : null,
      expenseType: pattern.categoryType === 'expense'
        ? (pattern._cache?.expenseType ?? (isOperatingExpensePattern(pattern) ? 'operating' : 'non_operating'))
        : null,
      isCountedAsIncome: pattern.isCountedAsIncome,
      patternType: pattern.patternType,
      avgAmount: pattern.avgAmount,
      stdDev: pattern.stdDev,
      minAmount: pattern.minAmount,
      maxAmount: pattern.maxAmount,
      coefficientOfVariation: pattern.coefficientOfVariation,
      isFixedAmount: pattern.isFixedAmount,
      confidence: pattern.confidence,
      monthsOfHistory: pattern.monthsOfHistory,
      avgOccurrencesPerWeek: pattern.avgOccurrencesPerWeek,
      incomeAmountBaseline: pattern.incomeAmountBaseline,
      incomeOneOffCount: pattern.incomeOneOffCount || 0,
      uniqueTransactionNameCount: pattern.uniqueTransactionNameCount,
      insufficientData: pattern.insufficientData || false,
      skipReason: pattern.skipReason || null,
      avgOccurrencesPerMonth: pattern.avgOccurrencesPerMonth,
      mostLikelyDaysOfWeek: pattern.mostLikelyDaysOfWeek,
      mostLikelyDaysOfMonth: pattern.mostLikelyDaysOfMonth,
      lastOccurrence: pattern.lastOccurrence,
      daysSinceLastOccurrence: pattern.daysSinceLastOccurrence,
    })),
    monthlyAdjustments: adjustmentsByMonth,
    _internal: {
      patterns,
      patternEntries,
      simulationEntriesByDay,
      monteCarloResults,
      variableExpenseBaselines,
    },
  };

  return results;
}

module.exports = {
  id: MODEL_ID,
  generateForecast,
  withCumulative,
};
