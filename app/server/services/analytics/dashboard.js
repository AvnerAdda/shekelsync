const { performance } = require('node:perf_hooks');
const actualDatabase = require('../database.js');
const { resolveDateRange } = require('../../../lib/server/query-utils.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');
const { dialect } = require('../../../lib/sql-dialect.js');
const { recordDashboardMetric } = require('./metrics-store.js');
const { createTtlCache } = require('../../../lib/server/ttl-cache.js');

let database = actualDatabase;
const dashboardCache = createTtlCache({ maxEntries: 25, defaultTtlMs: 60 * 1000 });

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


async function getDashboardAnalytics(query = {}) {
  const timerStart = performance.now();
  const { startDate, endDate, months = 3, aggregation = 'daily' } = query;
  const { start, end } = resolveDateRange({ startDate, endDate, months });
  const skipCache =
    process.env.NODE_ENV === 'test' ||
    query.noCache === true ||
    query.noCache === 'true' ||
    query.noCache === '1';
  const cacheKey = JSON.stringify({
    start: start.toISOString(),
    end: end.toISOString(),
    aggregation,
    months,
  });
  if (!skipCache) {
    const cached = dashboardCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

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
            (cd.category_type = 'income' AND t.price > 0 AND COALESCE(cd.is_counted_as_income, 1) = 1)
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
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND tpe.transaction_identifier IS NULL
        AND ${dialect.excludePikadon('t')}
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
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND t.price < 0
        AND cd_parent.category_type = 'expense'
        AND tpe.transaction_identifier IS NULL
        AND ${dialect.excludePikadon('t')}
      GROUP BY cd_parent.id, cd_parent.name, cd_child.id, cd_child.name
      ORDER BY cd_parent.name, total DESC`,
    [start, end],
  );

  const vendorResult = await database.query(
    `SELECT
        t.vendor,
        COUNT(*) as count,
        SUM(ABS(price)) as total,
        fi.id as institution_id,
        fi.display_name_he as institution_name_he,
        fi.display_name_en as institution_name_en,
        fi.logo_url as institution_logo,
        fi.institution_type as institution_type
      FROM transactions t
      LEFT JOIN vendor_credentials vc ON t.vendor = vc.vendor
      LEFT JOIN institution_nodes fi ON vc.institution_id = fi.id AND fi.node_type = 'institution'
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND t.price < 0
        AND tpe.transaction_identifier IS NULL
        AND ${dialect.excludePikadon('t')}
      GROUP BY t.vendor, fi.id, fi.display_name_he, fi.display_name_en, fi.logo_url, fi.institution_type
      ORDER BY total DESC`,
    [start, end],
  );

  const monthExpr = dialect.toChar('t.date', 'YYYY-MM');
  const monthResult = await database.query(
    `SELECT
        ${monthExpr} as month,
        SUM(CASE
          WHEN (
            (cd.category_type = 'income' AND t.price > 0 AND COALESCE(cd.is_counted_as_income, 1) = 1)
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
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND tpe.transaction_identifier IS NULL
        AND ${dialect.excludePikadon('t')}
      GROUP BY ${monthExpr}
      ORDER BY month ASC`,
    [start, end, BANK_CATEGORY_NAME],
  );

  const summaryResult = await database.query(
    `SELECT
        SUM(CASE
          WHEN (
            (cd.category_type = 'income' AND t.price > 0 AND COALESCE(cd.is_counted_as_income, 1) = 1)
            OR (cd.category_type IS NULL AND t.price > 0)
            OR (COALESCE(cd.name, '') = $3 AND t.price > 0)
          ) THEN t.price
          ELSE 0
        END) as total_income,
        SUM(CASE
          WHEN cd.category_type = 'income' AND t.price > 0 AND COALESCE(cd.is_counted_as_income, 1) = 0
          THEN t.price
          ELSE 0
        END) as total_capital_returns,
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
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND tpe.transaction_identifier IS NULL
        AND ${dialect.excludePikadon('t')}`,
    [start, end, BANK_CATEGORY_NAME],
  );

  const summary = summaryResult.rows[0] || {};
  const totalIncome = Number.parseFloat(summary.total_income || 0);
  const totalCapitalReturns = Number.parseFloat(summary.total_capital_returns || 0);
  const totalExpenses = Number.parseFloat(summary.total_expenses || 0);
  const investmentOutflow = Number.parseFloat(summary.investment_outflow || 0);
  const investmentInflow = Number.parseFloat(summary.investment_inflow || 0);
  const netInvestments = investmentOutflow - investmentInflow;
  const netBalance = totalIncome - totalExpenses;

  // Query for pending expenses (processed_date > today)
  const pendingExpensesResult = await database.query(
    `SELECT
        SUM(CASE
          WHEN (cd.category_type = 'expense' OR (cd.category_type IS NULL AND t.price < 0))
            AND t.price < 0 THEN ABS(t.price)
          ELSE 0
        END) as pending_expenses,
        COUNT(CASE
          WHEN (cd.category_type = 'expense' OR (cd.category_type IS NULL AND t.price < 0))
            AND t.price < 0 THEN 1
          ELSE NULL
        END) as pending_count
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND t.processed_date IS NOT NULL
        AND DATE(t.processed_date) > DATE('now')
        AND tpe.transaction_identifier IS NULL
        AND ${dialect.excludePikadon('t')}`,
    [start, end],
  );

  const pendingData = pendingExpensesResult.rows[0] || {};
  const pendingExpenses = Number.parseFloat(pendingData.pending_expenses || 0);
  const pendingCount = Number.parseInt(pendingData.pending_count || 0, 10);

  // Query 1: Current bank balances (latest snapshot per account)
  const currentBankBalancesResult = await database.query(
    `SELECT
      ia.id as account_id,
      ia.account_name,
      ia.institution_id,
      fi.display_name_he as institution_name_he,
      fi.display_name_en as institution_name_en,
      fi.logo_url as institution_logo,
      ih.current_value as current_balance,
      ih.as_of_date
    FROM investment_accounts ia
    JOIN investment_holdings ih ON ia.id = ih.account_id
    LEFT JOIN institution_nodes fi ON ia.institution_id = fi.id AND fi.node_type = 'institution'
    WHERE ia.account_type = 'bank_balance'
      AND ia.is_active = 1
      AND ih.as_of_date = (
        SELECT MAX(as_of_date)
        FROM investment_holdings
        WHERE account_id = ia.id
      )
    ORDER BY ia.account_name`,
    []
  );

  // Query 2: Month-start bank balance (at start of first month in range)
  const startDateStr = start.toISOString().split('T')[0]; // Convert Date to YYYY-MM-DD
  const monthStartDate = startDateStr.substring(0, 7) + '-01'; // YYYY-MM-01
  const monthStartBalancesResult = await database.query(
    `SELECT
      COALESCE(SUM(ih.current_value), 0) as total_balance
    FROM investment_holdings ih
    JOIN investment_accounts ia ON ih.account_id = ia.id
    WHERE ia.account_type = 'bank_balance'
      AND ia.is_active = 1
      AND ih.as_of_date = $1`,
    [monthStartDate]
  );

  // Query 3: Bank balance history aggregated by period
  let balanceHistoryGroupBy;
  let balanceHistorySelect;
  switch (aggregation) {
    case 'weekly':
      balanceHistoryGroupBy = dialect.dateTrunc('week', 'ih.as_of_date');
      balanceHistorySelect = `${dialect.dateTrunc('week', 'ih.as_of_date')} as date`;
      break;
    case 'monthly':
      balanceHistoryGroupBy = dialect.dateTrunc('month', 'ih.as_of_date');
      balanceHistorySelect = `${dialect.dateTrunc('month', 'ih.as_of_date')} as date`;
      break;
    case 'daily':
    default:
      balanceHistoryGroupBy = dialect.dateTrunc('day', 'ih.as_of_date');
      balanceHistorySelect = `${dialect.dateTrunc('day', 'ih.as_of_date')} as date`;
  }

  const balanceHistoryResult = await database.query(
    `SELECT
      ${balanceHistorySelect},
      SUM(ih.current_value) as total_balance
    FROM investment_holdings ih
    JOIN investment_accounts ia ON ih.account_id = ia.id
    WHERE ia.account_type = 'bank_balance'
      AND ia.is_active = 1
      AND ih.as_of_date >= $1
      AND ih.as_of_date <= $2
    GROUP BY ${balanceHistoryGroupBy}
    ORDER BY date ASC`,
    [start, end]
  );

  // Calculate bank balance metrics
  const currentBankBalance = currentBankBalancesResult.rows.reduce(
    (sum, row) => sum + Number.parseFloat(row.current_balance || 0),
    0
  );

  const monthStartBankBalance = Number.parseFloat(
    monthStartBalancesResult.rows[0]?.total_balance || 0
  );

  const bankBalanceChange = currentBankBalance - monthStartBankBalance;

  // Query 4: Calculate pikadon (savings/deposits) balance
  // Pikadon transactions are investments (category_definition_id = 84)
  const pikkadonResult = await database.query(
    `SELECT
      SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as pikadon_inflow,
      SUM(CASE WHEN price < 0 THEN price ELSE 0 END) as pikadon_outflow,
      SUM(price) as net_pikadon
    FROM transactions
    WHERE category_definition_id = 84
      AND vendor IN (
        SELECT vendor_code FROM institution_nodes
        WHERE node_type = 'institution'
          AND institution_type IN ('bank', 'financial')
      )
      AND date >= $1`,
    [monthStartDate]
  );

  const pikkadonBalance = Number.parseFloat(
    pikkadonResult.rows[0]?.net_pikadon || 0
  );

  // Query 5: Calculate pending CC debt (expenses after last completed repayment)
  const pendingCCDebtResult = await database.query(
    `WITH last_repayment AS (
      SELECT MAX(t.date) as last_date
      FROM transactions t
      JOIN category_definitions cd ON t.category_definition_id = cd.id
      WHERE cd.name = 'פרעון כרטיס אשראי'
        AND t.status = 'completed'
    ),
    cc_vendors AS (
      SELECT DISTINCT credit_card_vendor as vendor
      FROM account_pairings
      WHERE is_active = 1
    )
    SELECT COALESCE(SUM(ABS(price)), 0) as pending_debt
    FROM transactions t, last_repayment lr
    WHERE t.vendor IN (SELECT vendor FROM cc_vendors)
      AND t.price < 0
      AND t.date > lr.last_date`,
    []
  );

  const pendingCCDebt = Number.parseFloat(
    pendingCCDebtResult.rows[0]?.pending_debt || 0
  );

  // Calculate final balances
  const checkingBalance = currentBankBalance - pikkadonBalance;
  const availableBalance = checkingBalance - pendingCCDebt;

  // Create a map for merging balance history with transaction history
  const balanceHistoryMap = new Map();
  balanceHistoryResult.rows.forEach((row) => {
    balanceHistoryMap.set(row.date, Number.parseFloat(row.total_balance || 0));
  });

  const response = {
    dateRange: { start, end },
    summary: {
      totalIncome,
      totalCapitalReturns,
      totalExpenses,
      netBalance,
      investmentOutflow,
      investmentInflow,
      netInvestments,
      totalAccounts: Number.parseInt(summary.total_accounts || 0, 10) || 0,
      // Pending expenses (future processed_date)
      pendingExpenses,
      pendingCount,
      // Bank balance summary fields
      currentBankBalance,
      monthStartBankBalance,
      bankBalanceChange,
      // Pikadon & available balance (NEW Nov 2025)
      pikkadonBalance,
      checkingBalance,
      pendingCCDebt,
      availableBalance,
    },
    history: historyResult.rows.map((row) => ({
      date: row.date,
      income: Number.parseFloat(row.income || 0),
      expenses: Number.parseFloat(row.expenses || 0),
      // NEW: Add bank balance to history
      bankBalance: balanceHistoryMap.get(row.date) || 0,
    })),
    breakdowns: {
      byCategory: buildCategoryBreakdown(categoryDataResult.rows),
      byVendor: vendorResult.rows.map((row) => ({
        vendor: row.vendor,
        count: Number.parseInt(row.count || 0, 10),
        total: Number.parseFloat(row.total || 0),
        institution: row.institution_id ? {
          id: row.institution_id,
          display_name_he: row.institution_name_he,
          display_name_en: row.institution_name_en,
          logo_url: row.institution_logo,
          institution_type: row.institution_type,
        } : null,
      })),
      byMonth: monthResult.rows.map((row) => ({
        month: row.month,
        income: Number.parseFloat(row.income || 0),
        expenses: Number.parseFloat(row.expenses || 0),
      })),
      // NEW: Bank account breakdown
      byBankAccount: currentBankBalancesResult.rows.map((row) => ({
        accountId: row.account_id,
        accountName: row.account_name,
        currentBalance: Number.parseFloat(row.current_balance || 0),
        asOfDate: row.as_of_date,
        institution: row.institution_id ? {
          id: row.institution_id,
          display_name_he: row.institution_name_he,
          display_name_en: row.institution_name_en,
          logo_url: row.institution_logo,
        } : null,
      })),
    },
  };

  const durationMs = Number((performance.now() - timerStart).toFixed(2));
  const metricPayload = {
    durationMs,
    months,
    aggregation,
    dateRange: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    rowCounts: {
      history: historyResult.rows.length,
      categories: categoryDataResult.rows.length,
      vendors: vendorResult.rows.length,
      months: monthResult.rows.length,
      accounts: currentBankBalancesResult.rows.length,
    },
  };

  console.info('[analytics:dashboard]', JSON.stringify(metricPayload));
  recordDashboardMetric(metricPayload);

  if (!skipCache) {
    dashboardCache.set(cacheKey, response);
  }
  return response;
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
