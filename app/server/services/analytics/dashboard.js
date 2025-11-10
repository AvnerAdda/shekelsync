const actualDatabase = require('../database.js');
const { resolveDateRange } = require('../../../lib/server/query-utils.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');
const { dialect } = require('../../../lib/sql-dialect.js');
const { BANK_VENDORS, SPECIAL_BANK_VENDORS } = require('../../../utils/constants.js');

let database = actualDatabase;

function buildCategoryBreakdown(rows) {
  const parentMap = new Map();

  rows.forEach((row) => {
    const parentId = row.parent_id;
    if (!parentMap.has(parentId)) {
      parentMap.set(parentId, {
        parentId,
        category: row.parent_name,
        count: 0,
        total: 0,
        subcategories: [],
      });
    }

    const parent = parentMap.get(parentId);
    const count = Number.parseInt(row.count, 10) || 0;
    const total = Number.parseFloat(row.total) || 0;

    parent.count += count;
    parent.total += total;
    parent.subcategories.push({
      id: row.subcategory_id,
      name: row.subcategory_name,
      count,
      total,
    });
  });

  const result = Array.from(parentMap.values());

  result.forEach((parent) => {
    parent.subcategories.sort((a, b) => b.total - a.total);
  });

  result.sort((a, b) => b.total - a.total);
  return result;
}

/**
 * Computes wealth trajectory by working backwards from the current balance
 * @param {Object} options - Configuration options
 * @param {string} options.start - Start date
 * @param {string} options.end - End date
 * @param {number} options.currentBalance - Current bank balance from scraper
 * @param {string} options.balanceDate - Date when balance was updated
 * @param {Array} options.history - Daily income/expense history (already filtered for paired transactions)
 * @returns {Array} Array of {date, balance, income, expenses, netFlow} objects
 */
async function computeWealthTrajectory({ start, end, currentBalance, balanceDate, history }) {
  if (!currentBalance || !balanceDate || !history || history.length === 0) {
    return [];
  }

  // Create a map of date -> {income, expenses} for quick lookup
  const dateMap = new Map();
  history.forEach((row) => {
    const dateStr = new Date(row.date).toISOString().split('T')[0];
    dateMap.set(dateStr, {
      income: Number.parseFloat(row.income || 0),
      expenses: Number.parseFloat(row.expenses || 0),
    });
  });

  // Parse balance date (normalize to YYYY-MM-DD)
  const balanceDateObj = new Date(balanceDate);
  const balanceDateStr = balanceDateObj.toISOString().split('T')[0];

  // Create array of all dates from start to balance date
  const startDate = new Date(start);
  const endDate = new Date(balanceDateStr);
  const dates = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    dates.push(currentDate.toISOString().split('T')[0]);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Work backwards from balance date to compute historical balances
  const trajectory = [];
  let runningBalance = currentBalance;

  // Start from the most recent date (balance date) and work backwards
  for (let i = dates.length - 1; i >= 0; i--) {
    const dateStr = dates[i];
    const dayData = dateMap.get(dateStr) || { income: 0, expenses: 0 };

    trajectory.unshift({
      date: dateStr,
      balance: runningBalance,
      income: dayData.income,
      expenses: dayData.expenses,
      netFlow: dayData.income - dayData.expenses,
    });

    // For previous day: balance = current_balance + expenses - income
    // (because current_balance = previous_balance + income - expenses)
    if (i > 0) {
      runningBalance = runningBalance + dayData.expenses - dayData.income;
    }
  }

  return trajectory;
}

async function getDashboardAnalytics(query = {}) {
  const { startDate, endDate, months = 3, aggregation = 'daily' } = query;
  const { start, end } = resolveDateRange({ startDate, endDate, months });

  let dateGroupBy;
  let dateSelect;
  switch (aggregation) {
    case 'weekly':
      dateGroupBy = dialect.dateTrunc('week', 't.date');
      dateSelect = `${dialect.dateTrunc('week', 't.date')} as date`;
      break;
    case 'monthly':
      dateGroupBy = dialect.dateTrunc('month', 't.date');
      dateSelect = `${dialect.dateTrunc('month', 't.date')} as date`;
      break;
    case 'daily':
    default:
      dateGroupBy = dialect.dateTrunc('day', 't.date');
      dateSelect = `${dialect.dateTrunc('day', 't.date')} as date`;
  }

  const historyResult = await database.query(
    `SELECT
        ${dateSelect},
        SUM(CASE
          WHEN (
            (cd.category_type = 'income' AND t.price > 0)
            OR (cd.category_type IS NULL AND t.price > 0)
            OR (COALESCE(cd.name, '') = $3 AND t.price > 0)
          ) THEN t.price
          ELSE 0
        END) as income,
        SUM(CASE
          WHEN (cd.category_type = 'expense' OR (cd.category_type IS NULL AND t.price < 0))
            AND t.price < 0 THEN ABS(t.price)
          ELSE 0
        END) as expenses
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
        AND ap.id IS NULL
      GROUP BY ${dateGroupBy}
      ORDER BY date ASC`,
    [start, end, BANK_CATEGORY_NAME],
  );

  const categoryDataResult = await database.query(
    `SELECT
        cd_parent.id as parent_id,
        cd_parent.name as parent_name,
        cd_child.id as subcategory_id,
        cd_child.name as subcategory_name,
        COUNT(t.identifier) as count,
        SUM(ABS(t.price)) as total
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
      GROUP BY cd_parent.id, cd_parent.name, cd_child.id, cd_child.name
      ORDER BY cd_parent.name, total DESC`,
    [start, end],
  );

  const vendorResult = await database.query(
    `SELECT
        t.vendor,
        COUNT(*) as count,
        SUM(ABS(price)) as total
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
      WHERE t.date >= $1 AND t.date <= $2
        AND t.price < 0
        AND ap.id IS NULL
      GROUP BY t.vendor
      ORDER BY total DESC`,
    [start, end],
  );

  const monthExpr = dialect.toChar('t.date', 'YYYY-MM');
  const monthResult = await database.query(
    `SELECT
        ${monthExpr} as month,
        SUM(CASE
          WHEN (
            (cd.category_type = 'income' AND t.price > 0)
            OR (cd.category_type IS NULL AND t.price > 0)
            OR (COALESCE(cd.name, '') = $3 AND t.price > 0)
          ) THEN t.price
          ELSE 0
        END) as income,
        SUM(CASE
          WHEN (cd.category_type = 'expense' OR (cd.category_type IS NULL AND t.price < 0))
            AND t.price < 0 THEN ABS(t.price)
          ELSE 0
        END) as expenses
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
        AND ap.id IS NULL
      GROUP BY ${monthExpr}
      ORDER BY month ASC`,
    [start, end, BANK_CATEGORY_NAME],
  );

  const summaryResult = await database.query(
    `SELECT
        SUM(CASE
          WHEN (
            (cd.category_type = 'income' AND t.price > 0)
            OR (cd.category_type IS NULL AND t.price > 0)
            OR (COALESCE(cd.name, '') = $3 AND t.price > 0)
          ) THEN t.price
          ELSE 0
        END) as total_income,
        SUM(CASE
          WHEN (cd.category_type = 'expense' OR (cd.category_type IS NULL AND t.price < 0))
            AND t.price < 0 THEN ABS(t.price)
          ELSE 0
        END) as total_expenses,
        SUM(CASE
          WHEN cd.category_type = 'investment' AND t.price < 0 THEN ABS(t.price)
          ELSE 0
        END) as investment_outflow,
        SUM(CASE
          WHEN cd.category_type = 'investment' AND t.price > 0 THEN t.price
          ELSE 0
        END) as investment_inflow,
        COUNT(DISTINCT t.vendor) as total_accounts
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
        AND ap.id IS NULL`,
    [start, end, BANK_CATEGORY_NAME],
  );

  const summary = summaryResult.rows[0] || {};
  const totalIncome = Number.parseFloat(summary.total_income || 0);
  const totalExpenses = Number.parseFloat(summary.total_expenses || 0);
  const investmentOutflow = Number.parseFloat(summary.investment_outflow || 0);
  const investmentInflow = Number.parseFloat(summary.investment_inflow || 0);
  const netInvestments = investmentOutflow - investmentInflow;
  const netBalance = totalIncome - totalExpenses;

  // Query bank balances at start of period for wealth trajectory baseline
  // Only include actual bank accounts (not credit cards)
  const allBankVendors = [...BANK_VENDORS, ...SPECIAL_BANK_VENDORS];
  const bankVendorPlaceholders = allBankVendors.map((_, i) => `$${i + 3}`).join(', ');

  const bankBalancesResult = await database.query(
    `SELECT
        SUM(current_balance) as total_bank_balance,
        MAX(balance_updated_at) as last_balance_update,
        COUNT(*) as accounts_with_balance
      FROM vendor_credentials
      WHERE current_balance IS NOT NULL
        AND current_balance > 0
        AND vendor IN (${bankVendorPlaceholders})
        AND vendor IN (
          SELECT DISTINCT vendor FROM transactions
          WHERE date >= $1 AND date <= $2
        )`,
    [start, end, ...allBankVendors],
  );

  const bankBalance = bankBalancesResult.rows[0] || {};
  const totalBankBalance = Number.parseFloat(bankBalance.total_bank_balance || 0);
  const lastBalanceUpdate = bankBalance.last_balance_update;
  const accountsWithBalance = Number.parseInt(bankBalance.accounts_with_balance || 0, 10);

  // Get last sync date (most recent successful scrape)
  const lastSyncResult = await database.query(
    `SELECT MAX(created_at) as last_sync_date
      FROM scrape_events
      WHERE status = 'success'
        AND created_at <= $1`,
    [end],
  );
  const lastSyncDate = lastSyncResult.rows[0]?.last_sync_date || null;

  // Compute wealth trajectory by working backwards from current balance
  const wealthTrajectory = await computeWealthTrajectory({
    start,
    end,
    currentBalance: totalBankBalance,
    balanceDate: lastBalanceUpdate,
    history: historyResult.rows,
  });

  return {
    dateRange: { start, end },
    summary: {
      totalIncome,
      totalExpenses,
      netBalance,
      investmentOutflow,
      investmentInflow,
      netInvestments,
      totalAccounts: Number.parseInt(summary.total_accounts || 0, 10) || 0,
    },
    bankBalances: {
      totalBalance: totalBankBalance,
      lastUpdate: lastBalanceUpdate,
      accountsCount: accountsWithBalance,
    },
    lastSyncDate,
    history: historyResult.rows.map((row) => ({
      date: row.date,
      income: Number.parseFloat(row.income || 0),
      expenses: Number.parseFloat(row.expenses || 0),
    })),
    wealthTrajectory,
    breakdowns: {
      byCategory: buildCategoryBreakdown(categoryDataResult.rows),
      byVendor: vendorResult.rows.map((row) => ({
        vendor: row.vendor,
        count: Number.parseInt(row.count || 0, 10),
        total: Number.parseFloat(row.total || 0),
      })),
      byMonth: monthResult.rows.map((row) => ({
        month: row.month,
        income: Number.parseFloat(row.income || 0),
        expenses: Number.parseFloat(row.expenses || 0),
      })),
    },
  };
}

module.exports = {
  getDashboardAnalytics,
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};
module.exports.default = module.exports;
