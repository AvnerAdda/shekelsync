'use strict';

/**
 * Household net income detected from transactions, for payment-to-income
 * (affordability). Uses the same income filter as the spending analytics:
 * income categories, counted as income, excluding capital returns.
 *
 * Returns the median of the last N complete calendar months (UTC) that had
 * income, so a one-off bonus or a missing scrape does not distort it.
 */

const actualDatabase = require('../../database.js');

let database = actualDatabase;

const CAPITAL_RETURN_SUBQUERY = `
  SELECT id FROM category_definitions
  WHERE name = 'החזר קרן'
     OR name_en = 'Capital Returns'
     OR (is_counted_as_income IS NOT NULL AND is_counted_as_income = 0)
`;

function monthStart(index) {
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function detectMonthlyIncome({ months = 6, now = new Date() } = {}) {
  const currentIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const startIndex = currentIndex - months;
  const start = monthStart(startIndex);
  const end = monthStart(currentIndex); // exclusive: current (partial) month ignored

  const result = await database.query(
    `SELECT substr(t.date, 1, 7) AS month, COALESCE(SUM(t.price), 0) AS total
       FROM transactions t
       LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      WHERE t.date >= $1 AND t.date < $2
        AND t.price > 0
        AND (cd.category_type = 'income' OR t.category_type = 'income')
        AND (cd.is_counted_as_income IS NULL OR cd.is_counted_as_income = 1)
        AND (cd.id IS NULL OR cd.id NOT IN (${CAPITAL_RETURN_SUBQUERY}))
      GROUP BY substr(t.date, 1, 7)
      ORDER BY month ASC`,
    [start, end],
  );
  const byMonth = new Map((result.rows || []).map((row) => [row.month, Number(row.total) || 0]));
  const series = [];
  for (let index = startIndex; index < currentIndex; index += 1) {
    const month = monthStart(index).slice(0, 7);
    series.push({ month, total: Math.round(byMonth.get(month) || 0) });
  }
  const withIncome = series.filter((item) => item.total > 0).map((item) => item.total);
  const typical = median(withIncome);
  return {
    monthly: typical === null ? null : Math.round(typical),
    average: withIncome.length ? Math.round(withIncome.reduce((sum, value) => sum + value, 0) / withIncome.length) : null,
    method: 'median',
    monthsWithIncome: withIncome.length,
    months: series,
    source: 'transactions',
  };
}

module.exports = {
  detectMonthlyIncome,
  median,
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};
