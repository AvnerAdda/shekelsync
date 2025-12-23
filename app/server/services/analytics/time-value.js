const database = require('../database.js');

/**
 * Calculate time value of money - hours worked per purchase/category
 */
async function getTimeValueAnalytics() {
  // Get last 3 months of data
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const now = new Date();

  // Calculate income and hourly wage
  const incomeResult = await database.query(
    `SELECT
      SUM(t.price) as total_income,
      COUNT(DISTINCT strftime('%Y-%m', t.date)) as months
    FROM transactions t
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
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    WHERE t.status = 'completed'
      AND ap.id IS NULL
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
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    WHERE t.status = 'completed'
      AND ap.id IS NULL
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
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent_cd ON cd.parent_id = parent_cd.id
    WHERE t.status = 'completed'
      AND ap.id IS NULL
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
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    WHERE t.status = 'completed'
      AND ap.id IS NULL
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

  return {
    hourlyWage: Math.round(hourlyWage),
    totalIncome: Math.round(totalIncome),
    totalExpenses: Math.round(totalExpenses),
    topCategories,
    categoryCosts,
    biggestPurchase
  };
}

module.exports = {
  getTimeValueAnalytics
};
