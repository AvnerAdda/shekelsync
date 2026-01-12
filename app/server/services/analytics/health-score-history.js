const database = require('../database.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');
const { computeEnhancedHealthScore } = require('./health-score-enhanced.js');

let dateFnsPromise = null;

async function loadDateFns() {
  if (!dateFnsPromise) {
    dateFnsPromise = import('date-fns');
  }
  return dateFnsPromise;
}

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function toIsoDate(date) {
  if (!(date instanceof Date)) return String(date);
  return date.toISOString().split('T')[0];
}

function average(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

async function fetchBalanceBase(client, beforeDateIso) {
  const result = await client.query(
    `
    SELECT
      SUM(CASE
        WHEN (cd.category_type = 'income' OR (cd.category_type IS NULL AND t.price > 0))
          AND t.price > 0
          AND t.date < $1
        THEN t.price
        ELSE 0
      END) AS total_income,
      SUM(CASE
        WHEN (cd.category_type = 'expense' OR (cd.category_type IS NULL AND t.price < 0))
          AND t.price < 0
          AND t.date < $1
          AND COALESCE(cd.name, '') != $2
          AND COALESCE(parent.name, '') != $2
        THEN ABS(t.price)
        ELSE 0
      END) AS total_expenses
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    `,
    [beforeDateIso, BANK_CATEGORY_NAME],
  );

  const { total_income: income, total_expenses: expenses } = result.rows[0] || {};
  return Number.parseFloat(income || 0) - Number.parseFloat(expenses || 0);
}

async function fetchDailyNetFlows(client, startDateIso, endDateIso) {
  const result = await client.query(
    `
    SELECT
      t.date AS date,
      SUM(CASE
        WHEN (cd.category_type = 'income' OR (cd.category_type IS NULL AND t.price > 0))
          AND t.price > 0
        THEN t.price
        ELSE 0
      END) AS income,
      SUM(CASE
        WHEN (cd.category_type = 'expense' OR (cd.category_type IS NULL AND t.price < 0))
          AND t.price < 0
          AND COALESCE(cd.name, '') != $3
          AND COALESCE(parent.name, '') != $3
        THEN ABS(t.price)
        ELSE 0
      END) AS expenses
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    WHERE t.date >= $1 AND t.date <= $2
    GROUP BY t.date
    ORDER BY t.date ASC
    `,
    [startDateIso, endDateIso, BANK_CATEGORY_NAME],
  );

  return result.rows.map((row) => ({
    date: row.date,
    income: Number.parseFloat(row.income || 0),
    expenses: Number.parseFloat(row.expenses || 0),
  }));
}

function detectTrend(points) {
  if (!points || points.length === 0) {
    return { direction: 'flat', delta: 0, startAverage: 0, endAverage: 0 };
  }

  const window = Math.min(7, points.length);
  const startAverage = average(points.slice(0, window).map((p) => p.overallHealthScore));
  const endAverage = average(points.slice(-window).map((p) => p.overallHealthScore));
  const delta = Number((endAverage - startAverage).toFixed(1));

  const threshold = 1.5;
  const direction = delta > threshold ? 'up' : delta < -threshold ? 'down' : 'flat';

  return {
    direction,
    delta,
    startAverage: Number(startAverage.toFixed(1)),
    endAverage: Number(endAverage.toFixed(1)),
  };
}

async function getHealthScoreHistory(params = {}) {
  const { subDays, addDays } = await loadDateFns();

  const historyDays = clampInt(Number.parseInt(params.days, 10) || 60, 7, 120);
  const windowDays = clampInt(Number.parseInt(params.windowDays, 10) || historyDays, 7, 120);

  const endDate = new Date();
  const startDate = subDays(endDate, historyDays - 1);
  const startIso = toIsoDate(startDate);
  const endIso = toIsoDate(endDate);

  const historyDates = Array.from({ length: historyDays }, (_, idx) => addDays(startDate, idx));
  const historyIsoDates = historyDates.map(toIsoDate);

  const client = await database.getClient();

  try {
    const [baseBalance, dailyFlows] = await Promise.all([
      fetchBalanceBase(client, startIso),
      fetchDailyNetFlows(client, startIso, endIso),
    ]);

    const flowsByDate = new Map(dailyFlows.map((row) => [row.date, row]));
    const balancesByDate = new Map();

    let runningBalance = baseBalance;
    for (const dateIso of historyIsoDates) {
      const flow = flowsByDate.get(dateIso);
      if (flow) {
        runningBalance += flow.income - flow.expenses;
      }
      balancesByDate.set(dateIso, runningBalance);
    }

    const points = [];
    for (const pointDate of historyDates) {
      const pointIso = toIsoDate(pointDate);
      const windowStart = subDays(pointDate, windowDays - 1);
      const currentBalance = balancesByDate.get(pointIso) ?? baseBalance;

      const score = await computeEnhancedHealthScore({
        months: Math.max(1, Math.round(windowDays / 30)),
        startDate: windowStart,
        endDate: pointDate,
        currentBalance,
        client,
      });

      points.push({
        date: pointIso,
        overallHealthScore: score.overallScore,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      startDate: startIso,
      endDate: endIso,
      historyDays,
      windowDays,
      points,
      trend: detectTrend(points),
    };
  } finally {
    client.release();
  }
}

module.exports = {
  getHealthScoreHistory,
};

module.exports.default = module.exports;

