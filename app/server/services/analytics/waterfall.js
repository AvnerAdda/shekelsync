const { performance } = require('node:perf_hooks');
const actualDatabase = require('../database.js');
const { resolveDateRange } = require('../../../lib/server/query-utils.js');
const { recordWaterfallMetric } = require('./metrics-store.js');

let database = actualDatabase;

function parseFloatSafe(value) {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseIntSafe(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function getIncomeBreakdown(start, end) {
  const result = await database.query(
    `
      SELECT
        cd.name AS category_name,
        cd.name_en AS category_name_en,
        t.vendor,
        SUM(t.price) AS total,
        COUNT(*) AS count,
        COALESCE(cd.is_counted_as_income, 1) AS is_counted_as_income
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN account_pairings ap ON (
        t.vendor = ap.bank_vendor
        AND ap.is_active = 1
        AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
        AND ap.match_patterns IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM json_each(ap.match_patterns)
          WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
        )
      )
      WHERE t.date >= $1 AND t.date <= $2
        AND cd.category_type = 'income'
        AND t.price > 0
        AND ap.id IS NULL
      GROUP BY cd.name, cd.name_en, t.vendor, cd.is_counted_as_income
      ORDER BY total DESC
    `,
    [start, end],
  );

  return result.rows.map((row) => ({
    name: row.vendor || row.category_name_en || row.category_name,
    category: row.category_name_en || row.category_name,
    vendor: row.vendor,
    total: parseFloatSafe(row.total),
    count: parseIntSafe(row.count),
    // Default to true when column is missing/undefined
    isCountedAsIncome: row.is_counted_as_income !== 0 && row.is_counted_as_income !== false,
  }));
}

async function getExpenseBreakdown(start, end) {
  const result = await database.query(
    `
      SELECT
        cd_parent.name AS parent_category,
        cd_parent.name_en AS parent_category_en,
        SUM(ABS(t.price)) AS total,
        COUNT(*) AS count
      FROM transactions t
      JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
      JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
      LEFT JOIN account_pairings ap ON (
        t.vendor = ap.bank_vendor
        AND ap.is_active = 1
        AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
        AND ap.match_patterns IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM json_each(ap.match_patterns)
          WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
        )
      )
      WHERE t.date >= $1 AND t.date <= $2
        AND t.price < 0
        AND cd_parent.category_type = 'expense'
        AND ap.id IS NULL
      GROUP BY cd_parent.name, cd_parent.name_en
      ORDER BY total DESC
    `,
    [start, end],
  );

  return result.rows.map((row) => ({
    name: row.parent_category_en || row.parent_category,
    total: parseFloatSafe(row.total),
    count: parseIntSafe(row.count),
  }));
}

async function getInvestmentBreakdown(start, end) {
  const result = await database.query(
    `
      SELECT
        cd.name AS category_name,
        cd.name_en AS category_name_en,
        SUM(CASE WHEN t.price < 0 THEN ABS(t.price) ELSE 0 END) AS outflow,
        SUM(CASE WHEN t.price > 0 THEN t.price ELSE 0 END) AS inflow,
        COUNT(*) AS count
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN account_pairings ap ON (
        t.vendor = ap.bank_vendor
        AND ap.is_active = 1
        AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
        AND ap.match_patterns IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM json_each(ap.match_patterns)
          WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
        )
      )
      WHERE t.date >= $1 AND t.date <= $2
        AND cd.category_type = 'investment'
        AND ap.id IS NULL
      GROUP BY cd.name, cd.name_en
      ORDER BY outflow DESC
    `,
    [start, end],
  );

  return result.rows.map((row) => ({
    name: row.category_name_en || row.category_name,
    outflow: parseFloatSafe(row.outflow),
    inflow: parseFloatSafe(row.inflow),
    net: parseFloatSafe(row.outflow) - parseFloatSafe(row.inflow),
    count: parseIntSafe(row.count),
  }));
}

function buildWaterfallData(incomeBreakdown, expenseBreakdown, investmentBreakdown, totalCapitalReturns) {
  const waterfallData = [];
  let runningTotal = 0;

  incomeBreakdown.forEach((row) => {
    const value = row.total;
    const isCapitalReturn = row.isCountedAsIncome === false;

    waterfallData.push({
      name: row.name,
      value,
      type: isCapitalReturn ? 'capital_return' : 'income',
      cumulative: isCapitalReturn ? runningTotal : runningTotal + value,
      startValue: runningTotal,
      color: isCapitalReturn ? '#B2DFDB' : '#10b981',  // Teal for capital returns
      count: row.count,
      isCountedAsIncome: row.isCountedAsIncome !== false,
    });

    // Only add to running total if counted as income
    if (!isCapitalReturn) {
      runningTotal += value;
    }
  });

  expenseBreakdown.forEach((row) => {
    const value = row.total;
    waterfallData.push({
      name: row.name,
      value: -value,
      type: 'expense',
      cumulative: runningTotal - value,
      startValue: runningTotal,
      color: '#ef4444',
      count: row.count,
    });
    runningTotal -= value;
  });

  // Calculate total net investment considering capital returns
  const totalInvestmentNet = investmentBreakdown.reduce((sum, row) => sum + row.net, 0);
  const netNewInvestment = Math.max(0, totalInvestmentNet - totalCapitalReturns);

  // Show net new investment as a single line item (if positive)
  if (netNewInvestment > 0) {
    waterfallData.push({
      name: 'Net New Investment',
      value: -netNewInvestment,
      type: 'investment',
      cumulative: runningTotal - netNewInvestment,
      startValue: runningTotal,
      color: '#3b82f6',
      count: investmentBreakdown.reduce((sum, row) => sum + row.count, 0),
    });
    runningTotal -= netNewInvestment;
  }

  return { waterfallData, runningTotal };
}

async function getWaterfallAnalytics(query = {}) {
  const { startDate, endDate, months = 3 } = query;
  const timerStart = performance.now();
  const { start, end } = resolveDateRange({ startDate, endDate, months });

  const [incomeBreakdown, expenseBreakdown, investmentBreakdown] = await Promise.all([
    getIncomeBreakdown(start, end),
    getExpenseBreakdown(start, end),
    getInvestmentBreakdown(start, end),
  ]);

  // Only count income items that are marked as counted (excludes Capital Returns)
  const totalIncome = incomeBreakdown
    .filter((row) => row.isCountedAsIncome !== false)
    .reduce((sum, row) => sum + row.total, 0);
  const totalCapitalReturns = incomeBreakdown
    .filter((row) => row.isCountedAsIncome === false)
    .reduce((sum, row) => sum + row.total, 0);
  const totalExpenses = expenseBreakdown.reduce((sum, row) => sum + row.total, 0);
  const totalInvestmentOutflow = investmentBreakdown.reduce((sum, row) => sum + row.outflow, 0);
  const totalInvestmentInflow = investmentBreakdown.reduce((sum, row) => sum + row.inflow, 0);
  const netInvestments = totalInvestmentOutflow - totalInvestmentInflow;

  // Calculate effective net investment (accounting for capital returns)
  const effectiveNetInvestment = Math.max(0, netInvestments - totalCapitalReturns);
  const netBalance = totalIncome - totalExpenses - effectiveNetInvestment;

  const { waterfallData, runningTotal } = buildWaterfallData(
    incomeBreakdown,
    expenseBreakdown,
    investmentBreakdown,
    totalCapitalReturns,
  );

  waterfallData.push({
    name: 'Net Balance',
    value: netBalance,
    type: 'net',
    cumulative: runningTotal,
    startValue: 0,
    color: netBalance >= 0 ? '#10b981' : '#ef4444',
    count: 0,
  });

  const totalTransactions =
    incomeBreakdown.reduce((sum, row) => sum + row.count, 0) +
    expenseBreakdown.reduce((sum, row) => sum + row.count, 0) +
    investmentBreakdown.reduce((sum, row) => sum + row.count, 0);

  const response = {
    dateRange: { start, end },
    summary: {
      totalIncome,
      totalCapitalReturns,
      totalExpenses,
      netInvestments,
      netBalance,
      totalTransactions,
    },
    waterfallData,
    breakdown: {
      income: incomeBreakdown,
      expenses: expenseBreakdown.map((row) => ({
        name: row.name,
        total: row.total,
        count: row.count,
      })),
      investments: investmentBreakdown,
    },
  };

  const durationMs = Number((performance.now() - timerStart).toFixed(2));
  const metricPayload = {
    durationMs,
    months,
    dateRange: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    rowCounts: {
      income: incomeBreakdown.length,
      expenses: expenseBreakdown.length,
      investments: investmentBreakdown.length,
      waterfallPoints: waterfallData.length,
    },
  };

  console.info('[analytics:waterfall]', JSON.stringify(metricPayload));
  recordWaterfallMetric(metricPayload);

  return response;
}

module.exports = {
  getWaterfallAnalytics,
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
