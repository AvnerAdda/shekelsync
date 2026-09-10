const patternV1 = require('./pattern-v1.js');

const MODEL_ID = 'ensemble-v1';

const BLEND_WEIGHTS = Object.freeze({
  short: 0.75,
  medium: 0.5,
  long: 0.25,
});

function parseLocalDate(dateStr) {
  if (typeof dateStr !== 'string') return new Date(dateStr);
  if (dateStr.includes('T')) return new Date(dateStr);
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return new Date(dateStr);
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function horizonDaysFrom(now, targetDateStr) {
  const start = parseLocalDate(formatDate(now));
  const target = parseLocalDate(targetDateStr);
  start.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((target.getTime() - start.getTime()) / 86400000));
}

function patternBlendWeight(horizonDays) {
  if (horizonDays <= 7) return BLEND_WEIGHTS.short;
  if (horizonDays <= 30) return BLEND_WEIGHTS.medium;
  return BLEND_WEIGHTS.long;
}

function buildDailyCategoryTotals(transactions, categoryType = 'expense') {
  const totalsByDate = new Map();
  transactions.forEach((txn) => {
    if (txn.category_type !== categoryType) return;
    const amount = Math.abs(Number(txn.price) || 0);
    if (amount <= 0) return;
    const date = String(txn.date || '').slice(0, 10);
    if (!date) return;
    totalsByDate.set(date, (totalsByDate.get(date) || 0) + amount);
  });
  return [...totalsByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, value }));
}

function holtLinearForecast(series, horizonDays, { alpha = 0.35, beta = 0.12 } = {}) {
  if (!series.length) return 0;
  if (series.length === 1) return series[0].value;

  let level = series[0].value;
  let trend = series[1].value - series[0].value;
  for (let index = 1; index < series.length; index += 1) {
    const value = series[index].value;
    const previousLevel = level;
    level = alpha * value + (1 - alpha) * (level + trend);
    trend = beta * (level - previousLevel) + (1 - beta) * trend;
  }
  return Math.max(0, level + trend * Math.max(1, horizonDays));
}

function buildTimeSeriesDailyForecasts(transactions, dailyForecasts, now) {
  const expenseSeries = buildDailyCategoryTotals(transactions, 'expense');
  const incomeSeries = buildDailyCategoryTotals(transactions, 'income');
  const avgDailyExpense = expenseSeries.length
    ? expenseSeries.reduce((sum, point) => sum + point.value, 0) / expenseSeries.length
    : 0;
  const avgDailyIncome = incomeSeries.length
    ? incomeSeries.reduce((sum, point) => sum + point.value, 0) / incomeSeries.length
    : 0;

  return dailyForecasts.map((day) => {
    const horizon = horizonDaysFrom(now, day.date);
    const tsExpenses = holtLinearForecast(expenseSeries, horizon);
    const tsIncome = holtLinearForecast(incomeSeries, horizon);
    return {
      date: day.date,
      expectedIncome: tsIncome || avgDailyIncome,
      expectedExpenses: tsExpenses || avgDailyExpense,
      expectedCashFlow: (tsIncome || avgDailyIncome) - (tsExpenses || avgDailyExpense),
    };
  });
}

function blendDailyForecasts(patternDays, tsDays, now) {
  return patternDays.map((patternDay, index) => {
    const tsDay = tsDays[index] || tsDayFallback(patternDay);
    const horizon = horizonDaysFrom(now, patternDay.date);
    const patternWeight = patternBlendWeight(horizon);
    const tsWeight = 1 - patternWeight;

    const expectedIncome = (patternWeight * (Number(patternDay.expectedIncome) || 0))
      + (tsWeight * (Number(tsDay.expectedIncome) || 0));
    const expectedExpenses = (patternWeight * (Number(patternDay.expectedExpenses) || 0))
      + (tsWeight * (Number(tsDay.expectedExpenses) || 0));
    const expectedOperatingIncome = blendComponent(patternDay.expectedOperatingIncome, tsDay.expectedIncome, patternWeight);
    const expectedNonOperatingIncome = blendComponent(patternDay.expectedNonOperatingIncome, 0, patternWeight);
    const expectedOperatingExpenses = blendComponent(patternDay.expectedOperatingExpenses, tsDay.expectedExpenses, patternWeight);
    const expectedNonOperatingExpenses = blendComponent(patternDay.expectedNonOperatingExpenses, 0, patternWeight);
    const expectedCashFlow = expectedIncome - expectedExpenses;

    return {
      ...patternDay,
      expectedIncome,
      expectedExpenses,
      expectedOperatingIncome,
      expectedNonOperatingIncome,
      expectedOperatingExpenses,
      expectedNonOperatingExpenses,
      expectedCashFlow,
      expectedOperatingCashFlow: expectedOperatingIncome - expectedOperatingExpenses,
      expectedNonOperatingCashFlow: expectedNonOperatingIncome - expectedNonOperatingExpenses,
      modelBlend: { patternWeight, tsWeight, horizonDays: horizon },
    };
  });
}

function tsDayFallback(patternDay) {
  return {
    expectedIncome: Number(patternDay.expectedIncome) || 0,
    expectedExpenses: Number(patternDay.expectedExpenses) || 0,
  };
}

function blendComponent(patternValue, tsValue, patternWeight) {
  const patternComponent = Number(patternValue) || 0;
  const tsComponent = Number(tsValue) || 0;
  return (patternWeight * patternComponent) + ((1 - patternWeight) * tsComponent);
}

function applyCumulativeCashFlow(dailyForecasts) {
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
  return dailyForecasts;
}

function quantile(sortedValues, percentile) {
  if (!sortedValues.length) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const weight = position - lower;
  return sortedValues[lower] + ((sortedValues[upper] - sortedValues[lower]) * weight);
}

function loadCashFlowResiduals(db, lookbackDays = 120) {
  if (!db) return [];
  try {
    return db.prepare(`
      WITH actuals AS (
        SELECT substr(t.date, 1, 10) AS target_date,
          SUM(CASE WHEN t.category_type = 'income' AND t.price > 0 THEN t.price ELSE 0 END) AS actual_income,
          SUM(CASE WHEN t.category_type = 'expense' AND t.price < 0 THEN ABS(t.price) ELSE 0 END) AS actual_expenses
        FROM transactions t
        LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) excluded
          ON excluded.transaction_identifier = t.identifier AND excluded.transaction_vendor = t.vendor
        WHERE t.status = 'completed'
          AND excluded.transaction_identifier IS NULL
          AND t.category_type IN ('income', 'expense')
        GROUP BY substr(t.date, 1, 10)
      )
      SELECT snapshot.horizon_days,
        (COALESCE(snapshot.expected_cash_flow, 0) - (COALESCE(actual.actual_income, 0) - COALESCE(actual.actual_expenses, 0))) AS cash_flow_error
      FROM forecast_prediction_snapshots snapshot
      INNER JOIN actuals actual ON actual.target_date = snapshot.target_date
      WHERE snapshot.model_id = 'pattern-v1'
        AND snapshot.target_date < date('now', 'localtime')
        AND snapshot.target_date >= date('now', 'localtime', ?)
        AND snapshot.horizon_days BETWEEN 1 AND 90
    `).all(`-${lookbackDays} days`);
  } catch {
    return [];
  }
}

function buildResidualBands(db, dailyForecasts, fallbackScenarios, now) {
  const residuals = loadCashFlowResiduals(db);
  const residualsByHorizon = {
    short: [],
    medium: [],
    long: [],
    all: [],
  };
  residuals.forEach((row) => {
    const error = Number(row.cash_flow_error) || 0;
    residualsByHorizon.all.push(error);
    const horizon = Number(row.horizon_days) || 0;
    if (horizon <= 7) residualsByHorizon.short.push(error);
    else if (horizon <= 30) residualsByHorizon.medium.push(error);
    else residualsByHorizon.long.push(error);
  });

  const bucketForHorizon = (horizon) => {
    if (horizon <= 7) return 'short';
    if (horizon <= 30) return 'medium';
    return 'long';
  };

  const resolveOffsets = (horizon) => {
    const bucket = bucketForHorizon(horizon);
    const bucketValues = [...(residualsByHorizon[bucket] || [])].sort((left, right) => left - right);
    const fallbackValues = [...residualsByHorizon.all].sort((left, right) => left - right);
    const values = bucketValues.length >= 8 ? bucketValues : fallbackValues;
    if (values.length < 8) return null;
    return {
      low: quantile(values, 0.1),
      high: quantile(values, 0.9),
    };
  };

  const buildScenario = (percentileKey, sign) => {
    let cumulativeCashFlow = 0;
    const dailyResults = dailyForecasts.map((day) => {
      const horizon = horizonDaysFrom(now, day.date);
      const offsets = resolveOffsets(horizon);
      const baseCashFlow = Number(day.expectedCashFlow) || 0;
      let cashFlow = baseCashFlow;
      if (offsets) {
        cashFlow = sign < 0
          ? baseCashFlow + offsets.low
          : baseCashFlow + offsets.high;
      } else {
        const fallbackDay = fallbackScenarios?.[percentileKey]?.dailyResults?.find((entry) => entry.date === day.date);
        cashFlow = Number(fallbackDay?.cashFlow ?? baseCashFlow);
      }
      cumulativeCashFlow += cashFlow;
      return {
        date: day.date,
        income: Number(day.expectedIncome) || 0,
        expenses: Number(day.expectedExpenses) || 0,
        cashFlow,
        cumulativeCashFlow,
        operatingCashFlow: Number(day.expectedOperatingCashFlow) || 0,
        nonOperatingCashFlow: Number(day.expectedNonOperatingCashFlow) || 0,
        operatingExpenses: Number(day.expectedOperatingExpenses) || 0,
        nonOperatingExpenses: Number(day.expectedNonOperatingExpenses) || 0,
      };
    });
    const lastDay = dailyResults[dailyResults.length - 1] || {};
    return {
      totalIncome: dailyForecasts.reduce((sum, day) => sum + (Number(day.expectedIncome) || 0), 0),
      totalExpenses: dailyForecasts.reduce((sum, day) => sum + (Number(day.expectedExpenses) || 0), 0),
      totalCashFlow: dailyResults.reduce((sum, day) => sum + (Number(day.cashFlow) || 0), 0),
      cumulativeCashFlow: Number(lastDay.cumulativeCashFlow) || 0,
      dailyResults,
    };
  };

  const p50 = buildScenario('p50', 0);
  p50.dailyResults = dailyForecasts.map((day) => ({
    date: day.date,
    income: Number(day.expectedIncome) || 0,
    expenses: Number(day.expectedExpenses) || 0,
    cashFlow: Number(day.expectedCashFlow) || 0,
    cumulativeCashFlow: Number(day.cumulativeCashFlow) || 0,
    operatingCashFlow: Number(day.expectedOperatingCashFlow) || 0,
    nonOperatingCashFlow: Number(day.expectedNonOperatingCashFlow) || 0,
    operatingExpenses: Number(day.expectedOperatingExpenses) || 0,
    nonOperatingExpenses: Number(day.expectedNonOperatingExpenses) || 0,
  }));

  return {
    p10: patternV1.withCumulative(buildScenario('p10', -1)),
    p50: patternV1.withCumulative(p50),
    p90: patternV1.withCumulative(buildScenario('p90', 1)),
  };
}

function generateForecast(context) {
  const patternResult = patternV1.generateForecast(context);
  const tsDays = buildTimeSeriesDailyForecasts(
    context.allTransactions,
    patternResult.dailyForecasts,
    context.now,
  );
  const blendedDays = applyCumulativeCashFlow(
    blendDailyForecasts(patternResult.dailyForecasts, tsDays, context.now),
  );
  const scenarios = buildResidualBands(
    context.db,
    blendedDays,
    patternResult.scenarios,
    context.now,
  );

  return {
    ...patternResult,
    modelId: MODEL_ID,
    dailyForecasts: blendedDays,
    scenarios,
    ensembleInfo: {
      blendWeights: BLEND_WEIGHTS,
      residualLookbackDays: 120,
    },
  };
}

module.exports = {
  id: MODEL_ID,
  generateForecast,
  _internal: {
    BLEND_WEIGHTS,
    blendDailyForecasts,
    buildDailyCategoryTotals,
    buildResidualBands,
    buildTimeSeriesDailyForecasts,
    holtLinearForecast,
    horizonDaysFrom,
    loadCashFlowResiduals,
    patternBlendWeight,
    quantile,
  },
};
