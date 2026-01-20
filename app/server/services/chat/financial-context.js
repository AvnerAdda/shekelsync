/**
 * Financial Context Builder Module
 * Builds efficient financial context for OpenAI based on user permissions
 */

const { dialect } = require('../../../lib/sql-dialect.js');
const { resolveDateRange } = require('../../../lib/server/query-utils.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');

const PAIRING_EXCLUSION_JOIN = `
  LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
    ON t.identifier = tpe.transaction_identifier
    AND t.vendor = tpe.transaction_vendor
`;
const EXCLUDE_PIKADON = dialect.excludePikadon('t');
const CATEGORY_TYPE_EXPR = 'COALESCE(cd.category_type, t.category_type)';
const INCOME_CASE = `
  (
    (${CATEGORY_TYPE_EXPR} = 'income' AND t.price > 0 AND COALESCE(cd.is_counted_as_income, 1) = 1)
    OR (${CATEGORY_TYPE_EXPR} IS NULL AND t.price > 0)
    OR (COALESCE(cd.name, '') = $3 AND t.price > 0)
  )
`;
const EXPENSE_CASE = `
  (
    (${CATEGORY_TYPE_EXPR} = 'expense' OR (${CATEGORY_TYPE_EXPR} IS NULL AND t.price < 0))
    AND t.price < 0
  )
`;

/**
 * Build financial context respecting user permissions
 * @param {Object} db - Database client
 * @param {Object} permissions - User's chatbot permissions
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Financial context object
 */
async function buildContext(db, permissions, options = {}) {
  const months = options.months || 3;
  const { start, end } = resolveDateRange({
    startDate: options.startDate,
    endDate: options.endDate,
    months,
  });
  const startDateStr = start.toISOString().split('T')[0];
  const endDateStr = end.toISOString().split('T')[0];

  const context = {
    hasData: false,
    permissions: {
      transactions: permissions.allowTransactionAccess,
      categories: permissions.allowCategoryAccess,
      analytics: permissions.allowAnalyticsAccess,
    },
  };

  // Always get basic summary stats (no permission needed for aggregates)
  const summaryResult = await db.query(`
    SELECT
      COUNT(*) as transaction_count,
      SUM(CASE WHEN ${INCOME_CASE} THEN t.price ELSE 0 END) as total_income,
      SUM(CASE WHEN ${EXPENSE_CASE} THEN ABS(t.price) ELSE 0 END) as total_expenses,
      MIN(t.date) as earliest_date,
      MAX(t.date) as latest_date
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    ${PAIRING_EXCLUSION_JOIN}
    WHERE t.date >= $1 AND t.date <= $2
      AND tpe.transaction_identifier IS NULL
      AND ${EXCLUDE_PIKADON}
  `, [startDateStr, endDateStr, BANK_CATEGORY_NAME]);

  const summary = summaryResult.rows[0] || {};
  context.summary = {
    transactionCount: parseInt(summary.transaction_count || 0, 10),
    totalIncome: parseFloat(summary.total_income || 0),
    totalExpenses: parseFloat(summary.total_expenses || 0),
    timeRange: {
      months,
      from: summary.earliest_date,
      to: summary.latest_date,
    },
  };

  context.hasData = context.summary.transactionCount > 0;

  // Category breakdown (requires category permission)
  if (permissions.allowCategoryAccess) {
    const categoriesResult = await db.query(`
      SELECT
        COALESCE(parent.name, cd.name) as category,
        COALESCE(parent.category_type, cd.category_type, t.category_type) as category_type,
        SUM(ABS(t.price)) as total_expenses,
        COUNT(*) as count
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      ${PAIRING_EXCLUSION_JOIN}
      WHERE t.date >= $1 AND t.date <= $2
        AND t.price < 0
        AND (
          COALESCE(parent.category_type, cd.category_type, t.category_type) = 'expense'
          OR (parent.category_type IS NULL AND cd.category_type IS NULL AND t.category_type IS NULL)
        )
        AND tpe.transaction_identifier IS NULL
        AND ${EXCLUDE_PIKADON}
      GROUP BY COALESCE(parent.name, cd.name), COALESCE(parent.category_type, cd.category_type, t.category_type)
      ORDER BY total_expenses DESC
      LIMIT 15
    `, [startDateStr, endDateStr]);

    context.categories = categoriesResult.rows.map(c => ({
      name: c.category || 'Uncategorized',
      type: c.category_type,
      totalExpenses: parseFloat(c.total_expenses || 0),
      count: parseInt(c.count, 10),
    }));

    // Get budget status
    const budgetResult = await db.query(`
      SELECT
        cd.name as category,
        cb.budget_limit as budget,
        SUM(CASE WHEN t.price < 0 AND tpe.transaction_identifier IS NULL AND ${EXCLUDE_PIKADON}
          THEN ABS(t.price) ELSE 0 END) as spent
      FROM category_budgets cb
      JOIN category_definitions cd ON cb.category_definition_id = cd.id
      LEFT JOIN transactions t ON t.category_definition_id = cd.id
        AND t.date >= date('now', 'start of month')
        AND t.price < 0
      LEFT JOIN transaction_pairing_exclusions tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE cb.is_active = 1 AND cb.period_type = 'monthly'
      GROUP BY cd.id, cd.name, cb.budget_limit
    `);

    context.budgets = budgetResult.rows.map(b => ({
      category: b.category,
      budget: parseFloat(b.budget || 0),
      spent: parseFloat(b.spent || 0),
      remaining: parseFloat(b.budget || 0) - parseFloat(b.spent || 0),
      percentUsed: b.budget > 0 ? Math.round((parseFloat(b.spent || 0) / parseFloat(b.budget)) * 100) : 0,
    }));
  }

  // Recent transactions (requires transaction permission)
  if (permissions.allowTransactionAccess) {
    const recentResult = await db.query(`
      SELECT
        t.name,
        t.merchant_name,
        t.price,
        t.date,
        COALESCE(parent.name, cd.name) as category,
        t.vendor
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      ${PAIRING_EXCLUSION_JOIN}
      WHERE tpe.transaction_identifier IS NULL
        AND ${EXCLUDE_PIKADON}
      ORDER BY t.date DESC
      LIMIT 30
    `);

    context.recentTransactions = recentResult.rows.map(t => ({
      name: t.name,
      merchantName: t.merchant_name,
      price: parseFloat(t.price),
      date: t.date,
      category: t.category,
      vendor: t.vendor,
    }));

    // Top merchants
    const merchantsResult = await db.query(`
      SELECT
        merchant_name,
        COUNT(*) as visit_count,
        SUM(ABS(price)) as total_spent,
        AVG(ABS(price)) as avg_transaction
      FROM transactions t
      ${PAIRING_EXCLUSION_JOIN}
      WHERE date >= $1 AND date <= $2
        AND price < 0
        AND merchant_name IS NOT NULL
        AND tpe.transaction_identifier IS NULL
        AND ${EXCLUDE_PIKADON}
      GROUP BY merchant_name
      ORDER BY total_spent DESC
      LIMIT 10
    `, [startDateStr, endDateStr]);

    context.topMerchants = merchantsResult.rows.map(m => ({
      name: m.merchant_name,
      visits: parseInt(m.visit_count, 10),
      total: parseFloat(m.total_spent || 0),
      avgTransaction: parseFloat(m.avg_transaction || 0),
    }));
  }

  // Analytics data (requires analytics permission)
  if (permissions.allowAnalyticsAccess) {
    const monthExpr = dialect.toChar('t.date', 'YYYY-MM');
    // Monthly trends
    const trendsResult = await db.query(`
      SELECT
        ${monthExpr} as month,
        SUM(CASE WHEN ${INCOME_CASE} THEN t.price ELSE 0 END) as income,
        SUM(CASE WHEN ${EXPENSE_CASE} THEN ABS(t.price) ELSE 0 END) as expenses
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      ${PAIRING_EXCLUSION_JOIN}
      WHERE t.date >= $1 AND t.date <= $2
        AND tpe.transaction_identifier IS NULL
        AND ${EXCLUDE_PIKADON}
      GROUP BY ${monthExpr}
      ORDER BY month DESC
    `, [startDateStr, endDateStr, BANK_CATEGORY_NAME]);

    context.monthlyTrends = trendsResult.rows.map(t => ({
      month: t.month,
      income: parseFloat(t.income || 0),
      expenses: parseFloat(t.expenses || 0),
      netSavings: parseFloat(t.income || 0) - parseFloat(t.expenses || 0),
    }));

    // Calculate averages and projections
    if (context.monthlyTrends.length > 0) {
      const avgIncome = context.monthlyTrends.reduce((s, t) => s + t.income, 0) / context.monthlyTrends.length;
      const avgExpenses = context.monthlyTrends.reduce((s, t) => s + t.expenses, 0) / context.monthlyTrends.length;

      context.analytics = {
        avgMonthlyIncome: Math.round(avgIncome),
        avgMonthlyExpenses: Math.round(avgExpenses),
        avgMonthlySavings: Math.round(avgIncome - avgExpenses),
        savingsRate: avgIncome > 0 ? Math.round(((avgIncome - avgExpenses) / avgIncome) * 100) : 0,
      };
    }

    // Investment summary (if available)
    try {
      const investmentResult = await db.query(`
        SELECT
          SUM(current_value) as total_value,
          SUM(CASE WHEN is_liquid = 1 THEN current_value ELSE 0 END) as liquid_value,
          COUNT(DISTINCT id) as account_count
        FROM investment_accounts
        WHERE is_active = 1
      `);

      if (investmentResult.rows.length > 0 && investmentResult.rows[0].total_value) {
        context.investments = {
          totalValue: parseFloat(investmentResult.rows[0].total_value || 0),
          liquidValue: parseFloat(investmentResult.rows[0].liquid_value || 0),
          accountCount: parseInt(investmentResult.rows[0].account_count || 0, 10),
        };
      }
    } catch {
      // Investment tables might not exist
    }
  }

  return context;
}

/**
 * Format context as a string for the system prompt
 * @param {Object} context - The financial context object
 * @returns {string} Formatted context string
 */
function formatContextForPrompt(context) {
  if (!context.hasData) {
    return 'No financial data available yet. The user needs to connect their accounts first.';
  }

  const parts = [];

  // Summary
  parts.push(`FINANCIAL SUMMARY (Last ${context.summary.timeRange.months} months):`);
  parts.push(`- Total transactions: ${context.summary.transactionCount}`);
  parts.push(`- Total income: ₪${Math.round(context.summary.totalIncome).toLocaleString()}`);
  parts.push(`- Total expenses: ₪${Math.round(context.summary.totalExpenses).toLocaleString()}`);
  parts.push(`- Net: ₪${Math.round(context.summary.totalIncome - context.summary.totalExpenses).toLocaleString()}`);

  // Categories
  if (context.categories && context.categories.length > 0) {
    parts.push('\nTOP SPENDING CATEGORIES:');
    context.categories.slice(0, 5).forEach((c, i) => {
      parts.push(`${i + 1}. ${c.name}: ₪${Math.round(c.totalExpenses).toLocaleString()} (${c.count} transactions)`);
    });
  }

  // Budgets
  if (context.budgets && context.budgets.length > 0) {
    parts.push('\nBUDGET STATUS (This Month):');
    context.budgets.forEach(b => {
      const status = b.percentUsed > 100 ? '⚠️ OVER' : b.percentUsed > 80 ? '⚡ WARNING' : '✓';
      parts.push(`- ${b.category}: ₪${Math.round(b.spent).toLocaleString()} / ₪${Math.round(b.budget).toLocaleString()} (${b.percentUsed}%) ${status}`);
    });
  }

  // Analytics
  if (context.analytics) {
    parts.push('\nMONTHLY AVERAGES:');
    parts.push(`- Average income: ₪${context.analytics.avgMonthlyIncome.toLocaleString()}`);
    parts.push(`- Average expenses: ₪${context.analytics.avgMonthlyExpenses.toLocaleString()}`);
    parts.push(`- Average savings: ₪${context.analytics.avgMonthlySavings.toLocaleString()}`);
    parts.push(`- Savings rate: ${context.analytics.savingsRate}%`);
  }

  // Investments
  if (context.investments) {
    parts.push('\nINVESTMENTS:');
    parts.push(`- Total portfolio value: ₪${Math.round(context.investments.totalValue).toLocaleString()}`);
    parts.push(`- Liquid investments: ₪${Math.round(context.investments.liquidValue).toLocaleString()}`);
    parts.push(`- Number of accounts: ${context.investments.accountCount}`);
  }

  // Permission notices
  const denied = [];
  if (!context.permissions.transactions) denied.push('transaction details');
  if (!context.permissions.categories) denied.push('category analysis');
  if (!context.permissions.analytics) denied.push('analytics and trends');

  if (denied.length > 0) {
    parts.push(`\nNOTE: User has not granted access to: ${denied.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Get database schema information for SQL queries
 * @returns {string} Schema description
 */
function getSchemaDescription() {
  return `
DATABASE SCHEMA (for SQL queries):

transactions:
  - identifier (TEXT) - unique transaction identifier
  - id (INTEGER PRIMARY KEY)
  - name (TEXT) - transaction description
  - merchant_name (TEXT) - merchant name (anonymized as Merchant_N)
  - price (REAL) - amount (negative for expenses, positive for income)
  - date (TEXT) - transaction date (YYYY-MM-DD)
  - processed_date (TEXT) - processed/settlement date (YYYY-MM-DD)
  - status (TEXT) - e.g. 'completed', 'pending', 'canceled'
  - category_definition_id (INTEGER) - FK to category_definitions
  - category_type (TEXT) - cached category type if available
  - vendor (TEXT) - bank/card provider
  - account_number (TEXT) - account identifier
  - is_pikadon_related (INTEGER) - 1 if related to deposit/withdrawal savings (exclude from spend)

category_definitions:
  - id (INTEGER PRIMARY KEY)
  - name (TEXT) - category name
  - parent_id (INTEGER) - FK to parent category
  - category_type (TEXT) - 'expense', 'income', etc.

category_budgets:
  - id (INTEGER PRIMARY KEY)
  - category_definition_id (INTEGER) - FK to category_definitions
  - period_type (TEXT) - 'weekly', 'monthly', or 'yearly'
  - budget_limit (REAL) - budget amount
  - is_active (INTEGER) - 1 if active

investment_accounts:
  - id (INTEGER PRIMARY KEY)
  - name (TEXT) - account name
  - account_type (TEXT) - type of investment
  - current_value (REAL) - current value
  - is_liquid (INTEGER) - 1 if liquid
  - is_active (INTEGER) - 1 if active

transaction_pairing_exclusions:
  - transaction_identifier (TEXT)
  - transaction_vendor (TEXT)
  - pairing_id (INTEGER)
  - created_at (TEXT)
  - updated_at (TEXT)

Use these tables for SQL queries. Always use parameterized-style placeholders ($1, $2) even though we'll inject values directly.
Always use SQLite syntax (datetime(), strftime(), etc.).
`;
}

module.exports = {
  buildContext,
  formatContextForPrompt,
  getSchemaDescription,
};
