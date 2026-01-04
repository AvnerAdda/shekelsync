const database = require('../database.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function ema(values, alpha = 0.5) {
  if (!values || values.length === 0) return 0;
  let current = values[0];
  for (let i = 1; i < values.length; i += 1) {
    current = alpha * values[i] + (1 - alpha) * current;
  }
  return current;
}

function scaleBanded(value, points) {
  if (!points || points.length === 0) return value;
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  if (value <= sorted[0][0]) return sorted[0][1];
  for (let i = 1; i < sorted.length; i += 1) {
    const [x0, y0] = sorted[i - 1];
    const [x1, y1] = sorted[i];
    if (value <= x1) {
      const t = (value - x0) / (x1 - x0 || 1);
      return y0 + t * (y1 - y0);
    }
  }
  return sorted[sorted.length - 1][1];
}

function average(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function standardDeviation(values) {
  if (!values || values.length === 0) return 0;
  const avg = average(values);
  const variance = average(values.map((v) => (v - avg) ** 2));
  return Math.sqrt(variance);
}

function toIso(date) {
  if (date instanceof Date) {
    return date.toISOString().split('T')[0];
  }
  return date;
}

async function fetchMonthlyCashFlow(runQuery, start, end) {
  const result = await runQuery(
    `
    SELECT
      strftime('%Y-%m', t.date) AS month,
      SUM(CASE
        WHEN (
          (cd.category_type = 'income' AND t.price > 0 AND COALESCE(cd.is_counted_as_income, 1) = 1)
          OR (cd.category_type IS NULL AND t.price > 0)
          OR (COALESCE(cd.name, '') = $3 AND t.price > 0)
        ) THEN t.price
        ELSE 0
      END) AS income,
      SUM(CASE
        WHEN (cd.category_type = 'expense' OR (cd.category_type IS NULL AND t.price < 0))
          AND t.price < 0
          AND COALESCE(cd.name, '') != $3
          AND COALESCE(parent.name, '') != $3
        THEN ABS(t.price)
        ELSE 0
      END) AS expense,
      COUNT(*) AS txn_count
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
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
      AND ap.id IS NULL
    GROUP BY strftime('%Y-%m', t.date)
    ORDER BY month ASC
    `,
    [start, end, BANK_CATEGORY_NAME],
  );

  return result.rows.map((row) => ({
    month: row.month,
    income: Number.parseFloat(row.income || 0),
    expense: Number.parseFloat(row.expense || 0),
    txnCount: Number.parseInt(row.txn_count || 0, 10),
  }));
}

async function fetchExpenseTransactions(runQuery, start, end) {
  const result = await runQuery(
    `
    SELECT
      t.date,
      ABS(t.price) AS amount,
      cd.name AS category_name,
      parent.name AS parent_category
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
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
      AND (cd.category_type = 'expense' OR cd.category_type IS NULL)
      AND COALESCE(cd.name, '') != $3
      AND COALESCE(parent.name, '') != $3
      AND ap.id IS NULL
    ORDER BY t.date ASC
    `,
    [start, end, BANK_CATEGORY_NAME],
  );

  return result.rows.map((row) => ({
    date: new Date(row.date),
    amount: Number.parseFloat(row.amount || 0),
    category: row.category_name || 'Uncategorized',
    parentCategory: row.parent_category || 'Uncategorized',
  }));
}

async function fetchBalanceTotals(runQuery) {
  const result = await runQuery(
    `
    SELECT
      SUM(CASE WHEN (cd.category_type = 'income' OR (cd.category_type IS NULL AND t.price > 0)) AND t.price > 0 THEN t.price ELSE 0 END) AS total_income,
      SUM(CASE WHEN (cd.category_type = 'expense' OR (cd.category_type IS NULL AND t.price < 0)) AND t.price < 0 AND COALESCE(cd.name, '') != $1 AND COALESCE(parent.name, '') != $1 THEN ABS(t.price) ELSE 0 END) AS total_expenses
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
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
    WHERE ap.id IS NULL
    `,
    [BANK_CATEGORY_NAME],
  );

  const { total_income: income, total_expenses: expenses } = result.rows[0] || {};
  return {
    totalIncome: Number.parseFloat(income || 0),
    totalExpenses: Number.parseFloat(expenses || 0),
  };
}

function computeEntropyScore(expenseTransactions) {
  const totals = expenseTransactions.reduce((acc, txn) => {
    const key = txn.parentCategory || 'Uncategorized';
    acc[key] = (acc[key] || 0) + txn.amount;
    return acc;
  }, {});

  const categories = Object.keys(totals);
  const total = Object.values(totals).reduce((sum, v) => sum + v, 0);
  if (total === 0 || categories.length <= 1) {
    return { score: 0, categoryCount: categories.length };
  }

  const entropy = Object.values(totals).reduce((sum, v) => {
    const p = v / total;
    return sum - p * Math.log(p);
  }, 0);

  const maxEntropy = Math.log(categories.length);
  const normalized = maxEntropy > 0 ? entropy / maxEntropy : 0;
  return {
    score: clamp(normalized * 100),
    categoryCount: categories.length,
  };
}

function computeEnhancedScores({ months, monthlyCashFlow, expenses, currentBalance, dateRange }) {
  const notes = [];
  const hasIncome = monthlyCashFlow.some((m) => m.income > 0);
  const hasExpenses = monthlyCashFlow.some((m) => m.expense > 0);
  const periodIncome = monthlyCashFlow.reduce((sum, m) => sum + m.income, 0);
  const periodExpenses = monthlyCashFlow.reduce((sum, m) => sum + m.expense, 0);
  const dayCount = Math.max(1, Math.round((dateRange.endDate - dateRange.startDate) / DAY_MS));
  const monthsEquivalent = Math.max(1, dayCount / 30);
  const avgMonthlyIncome = periodIncome / monthsEquivalent;

  // Savings: time-window savings rate, banded mapping.
  const savingsRate = periodIncome > 0 ? (periodIncome - periodExpenses) / periodIncome : 0;
  const savingsScore = clamp(
    scaleBanded(savingsRate, [
      [-0.5, 0],
      [0, 0],
      [0.1, 40],
      [0.15, 70],
      [0.25, 95],
      [0.35, 100],
    ]),
  );
  const savingsConfidence = hasIncome && hasExpenses && periodIncome > 0 && dayCount >= 30;
  if (!hasIncome) {
    notes.push('Savings score is low-confidence: no income data in the window.');
  }

  // Diversity: normalized entropy of parent categories.
  const { score: diversityScoreRaw, categoryCount } = computeEntropyScore(expenses);
  const diversityConfidence = expenses.length >= 20 && categoryCount >= 3;
  if (!diversityConfidence) {
    notes.push('Diversity score is low-confidence: fewer than 20 expense transactions or <3 categories.');
  }

  // Impulse Control: micro-transaction spend share over the time window.
  const microThreshold = Math.min(200, Math.max(50, avgMonthlyIncome * 0.003));
  const expenseCount = expenses.length;
  const totalExpenseAmount = expenses.reduce((sum, txn) => sum + txn.amount, 0);
  const microExpenses = expenses.filter((txn) => txn.amount < microThreshold);
  const microSpend = microExpenses.reduce((sum, txn) => sum + txn.amount, 0);
  const microAvg = microExpenses.length > 0 ? average(microExpenses.map((t) => t.amount)) : 0;
  const microShare = totalExpenseAmount > 0 ? microSpend / totalExpenseAmount : 0;

  let impulseScore = clamp(
    scaleBanded(microShare, [
      [0, 100],
      [0.1, 90],
      [0.2, 75],
      [0.35, 50],
      [0.5, 20],
      [1, 0],
    ]),
  );
  if (microAvg > 0 && microAvg < 15) {
    impulseScore = Math.min(100, impulseScore + 5);
  }

  const impulseConfidence = expenseCount >= 30;
  if (!impulseConfidence) {
    notes.push('Impulse score is low-confidence: fewer than 30 expense transactions.');
  }
  if (microShare > 0.2) {
    notes.push(
      `High micro-spend share (~${Math.round(microShare * 100)}% of expenses) is dragging impulse control; consider batching or reducing small purchases.`,
    );
  }

  // Runway: balance vs average daily burn with volatility penalty.
  const avgDailyBurn = periodExpenses / dayCount;
  const runwayDays = avgDailyBurn > 0 ? Math.max(0, currentBalance) / avgDailyBurn : Infinity;
  const expenseVolatility = (() => {
    const endMonthKey = dateRange.endDate.toISOString().slice(0, 7);
    const endDate = dateRange.endDate;
    const endMonthLastDay = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate();
    const shouldExcludeEndMonth = endDate.getDate() !== endMonthLastDay;
    const expensesOnly = monthlyCashFlow
      .filter((m) => !shouldExcludeEndMonth || m.month !== endMonthKey)
      .map((m) => m.expense);
    const mean = average(expensesOnly);
    const std = standardDeviation(expensesOnly);
    return mean > 0 ? std / mean : 0;
  })();

  let runwayScore = clamp(
    scaleBanded(runwayDays, [
      [0, 5],
      [15, 30],
      [30, 50],
      [60, 70],
      [90, 85],
      [180, 100],
    ]),
  );

  if (!hasIncome && hasExpenses) {
    runwayScore = clamp(runwayScore - 15);
    notes.push('Runway penalized: missing income data inflates uncertainty.');
  }
  if (expenseVolatility > 0.4) {
    runwayScore = clamp(runwayScore - 8);
    notes.push('Runway penalized: high month-to-month expense volatility.');
  }

  const runwayConfidence = hasIncome && hasExpenses && avgDailyBurn > 0;
  if (!runwayConfidence) {
    notes.push('Runway score is low-confidence: missing income/expense data or zero burn.');
  }

  const weights = {
    savings: 0.35,
    diversity: 0.2,
    impulse: 0.2,
    runway: 0.25,
  };

  const adjusted = {
    savings: savingsConfidence ? savingsScore : Math.min(50, savingsScore),
    diversity: diversityConfidence ? diversityScoreRaw : Math.min(50, diversityScoreRaw),
    impulse: impulseConfidence ? impulseScore : Math.min(50, impulseScore),
    runway: runwayConfidence ? runwayScore : Math.min(50, runwayScore),
  };

  const overallScore = Math.round(
    adjusted.savings * weights.savings +
    adjusted.diversity * weights.diversity +
    adjusted.impulse * weights.impulse +
    adjusted.runway * weights.runway,
  );

  const rawBreakdown = {
    savingsScore: Math.round(savingsScore),
    diversityScore: Math.round(diversityScoreRaw),
    impulseScore: Math.round(impulseScore),
    runwayScore: Math.round(runwayScore),
  };

  return {
    overallScore,
    breakdown: rawBreakdown,
    adjustedBreakdown: {
      savingsScore: Math.round(adjusted.savings),
      diversityScore: Math.round(adjusted.diversity),
      impulseScore: Math.round(adjusted.impulse),
      runwayScore: Math.round(adjusted.runway),
    },
    confidence: {
      savings: savingsConfidence,
      diversity: diversityConfidence,
      impulse: impulseConfidence,
      runway: runwayConfidence,
    },
    meta: {
      periodIncome,
      periodExpenses,
      currentBalance,
      avgDailyBurn: Math.round(avgDailyBurn),
      runwayDays: Math.round(runwayDays),
      microThreshold: Math.round(microThreshold),
      microAverage: Math.round(microAvg),
      microShare: Number(microShare.toFixed(2)),
      expenseVolatility: Number(expenseVolatility.toFixed(2)),
    },
    notes,
  };
}

async function computeEnhancedHealthScore({ months, startDate, endDate, currentBalance, client }) {
  const runner = client && typeof client.query === 'function' ? client.query.bind(client) : database.query;
  const startIso = toIso(startDate);
  const endIso = toIso(endDate);

  const [monthlyCashFlow, expenses, balanceTotals] = await Promise.all([
    fetchMonthlyCashFlow(runner, startIso, endIso),
    fetchExpenseTransactions(runner, startIso, endIso),
    currentBalance === undefined ? fetchBalanceTotals(runner) : null,
  ]);

  const effectiveBalance =
    currentBalance !== undefined
      ? currentBalance
      : (balanceTotals?.totalIncome || 0) - (balanceTotals?.totalExpenses || 0);

  return computeEnhancedScores({
    months,
    monthlyCashFlow,
    expenses,
    currentBalance: effectiveBalance,
    dateRange: { startDate: new Date(startIso), endDate: new Date(endIso) },
  });
}

module.exports = {
  computeEnhancedHealthScore,
  _internal: {
    computeEnhancedScores,
  },
};

module.exports.default = module.exports;
