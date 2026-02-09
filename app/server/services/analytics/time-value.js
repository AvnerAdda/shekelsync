const database = require('../database.js');
const { createTtlCache } = require('../../../lib/server/ttl-cache.js');

const timeValueCache = createTtlCache({ maxEntries: 10, defaultTtlMs: 60 * 1000 });

/**
 * Calculate time value of money - hours worked per purchase/category
 */
async function getTimeValueAnalytics(params = {}) {
  const skipCache =
    process.env.NODE_ENV === 'test' ||
    params.noCache === true ||
    params.noCache === 'true' ||
    params.noCache === '1';
  // Get last 3 months of data
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const now = new Date();
  const cacheKey = JSON.stringify({
    start: threeMonthsAgo.toISOString().split('T')[0],
    end: now.toISOString().split('T')[0],
  });
  if (!skipCache) {
    const cached = timeValueCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // Calculate income and hourly wage
  const incomeResult = await database.query(
    `SELECT
      SUM(t.price) as total_income,
      COUNT(DISTINCT strftime('%Y-%m', t.date)) as months
    FROM transactions t
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    WHERE t.status = 'completed'
      AND tpe.transaction_identifier IS NULL
      AND cd.name NOT IN ('החזר קרן', 'ריבית מהשקעות', 'פיקדונות')
      AND t.category_type = 'income'
      AND t.price > 0
      AND t.date >= $1
      AND t.date <= $2`,
    [threeMonthsAgo.toISOString(), now.toISOString()]
  );

  const totalIncome = incomeResult.rows[0]?.total_income || 0;
  const months = incomeResult.rows[0]?.months || 3;
  
  // Estimate monthly income and hourly wage (assuming ~160 hours/month)
  const monthlyIncome = totalIncome / months;
  const hourlyWage = monthlyIncome / 160;

  // Get total expenses
  const expensesResult = await database.query(
    `SELECT
      SUM(ABS(t.price)) as total_expenses
    FROM transactions t
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    WHERE t.status = 'completed'
      AND tpe.transaction_identifier IS NULL
      AND cd.name NOT IN ('החזר קרן', 'ריבית מהשקעות', 'פיקדונות')
      AND (t.category_type = 'expense' OR t.price < 0)
      AND t.date >= $1
      AND t.date <= $2`,
    [threeMonthsAgo.toISOString(), now.toISOString()]
  );

  const totalExpenses = expensesResult.rows[0]?.total_expenses || 0;

  // Get category spending and calculate hours
  const categoriesResult = await database.query(
    `SELECT
      COALESCE(cd.name, parent_cd.name, 'Uncategorized') as category,
      SUM(ABS(t.price)) as amount
    FROM transactions t
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent_cd ON cd.parent_id = parent_cd.id
    WHERE t.status = 'completed'
      AND tpe.transaction_identifier IS NULL
      AND cd.name NOT IN ('החזר קרן', 'ריבית מהשקעות', 'פיקדונות')
      AND (t.category_type = 'expense' OR t.price < 0)
      AND t.date >= $1
      AND t.date <= $2
    GROUP BY category
    ORDER BY amount DESC
    LIMIT 10`,
    [threeMonthsAgo.toISOString(), now.toISOString()]
  );

  const topCategories = (categoriesResult.rows || []).map(cat => ({
    category: cat.category,
    amount: cat.amount,
    hours: hourlyWage > 0 ? cat.amount / hourlyWage : 0
  }));

  // Get biggest purchase
  const biggestPurchaseResult = await database.query(
    `SELECT
      t.name,
      ABS(t.price) as amount
    FROM transactions t
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    WHERE t.status = 'completed'
      AND tpe.transaction_identifier IS NULL
      AND cd.name NOT IN ('החזר קרן', 'ריבית מהשקעות', 'פיקדונות')
      AND (t.category_type = 'expense' OR t.price < 0)
      AND t.date >= $1
      AND t.date <= $2
    ORDER BY ABS(t.price) DESC
    LIMIT 1`,
    [threeMonthsAgo.toISOString(), now.toISOString()]
  );

  const biggestPurchase = biggestPurchaseResult.rows[0] ? {
    name: biggestPurchaseResult.rows[0].name,
    amount: biggestPurchaseResult.rows[0].amount,
    hours: hourlyWage > 0 ? biggestPurchaseResult.rows[0].amount / hourlyWage : 0,
    days: hourlyWage > 0 ? (biggestPurchaseResult.rows[0].amount / hourlyWage) / 8 : 0 // 8-hour workday
  } : null;

  // Category costs in hours
  const categoryCosts = topCategories.map(cat => ({
    category: cat.category,
    hours: cat.hours,
    amount: cat.amount
  }));

  const response = {
    hourlyWage: Math.round(hourlyWage),
    totalIncome: Math.round(totalIncome),
    totalExpenses: Math.round(totalExpenses),
    topCategories,
    categoryCosts,
    biggestPurchase
  };
  if (!skipCache) {
    timeValueCache.set(cacheKey, response);
  }
  return response;
}

module.exports = {
  getTimeValueAnalytics
};
