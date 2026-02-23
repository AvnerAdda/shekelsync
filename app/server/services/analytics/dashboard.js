const { performance } = require('node:perf_hooks');
const actualDatabase = require('../database.js');
const { resolveDateRange } = require('../../../lib/server/query-utils.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');
const { getCreditCardRepaymentCategoryCondition } = require('../accounts/repayment-category.js');
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

const SALARY_MATCH_SQL = `
  (
    LOWER(COALESCE(cd.name, '')) LIKE '%salary%'
    OR LOWER(COALESCE(cd.name_en, '')) LIKE '%salary%'
    OR LOWER(COALESCE(cd.name_fr, '')) LIKE '%salaire%'
    OR LOWER(COALESCE(cd.name, '')) LIKE '%משכורת%'
    OR LOWER(COALESCE(cd.name, '')) LIKE '%שכר%'
    OR LOWER(COALESCE(parent_cd.name, '')) LIKE '%salary%'
    OR LOWER(COALESCE(parent_cd.name_en, '')) LIKE '%salary%'
    OR LOWER(COALESCE(parent_cd.name_fr, '')) LIKE '%salaire%'
    OR LOWER(COALESCE(parent_cd.name, '')) LIKE '%משכורת%'
    OR LOWER(COALESCE(parent_cd.name, '')) LIKE '%שכר%'
  )
`;

const PIKADON_MATCH_SQL = `
  (
    t.is_pikadon_related = 1
    OR LOWER(COALESCE(cd.name, '')) LIKE '%פיקדון%'
    OR LOWER(COALESCE(cd.name, '')) LIKE '%פקדון%'
    OR LOWER(COALESCE(cd.name_en, '')) LIKE '%pikadon%'
    OR LOWER(COALESCE(cd.name_en, '')) LIKE '%term deposit%'
    OR LOWER(COALESCE(cd.name_en, '')) LIKE '%fixed deposit%'
  )
`;

const COUNTED_INCOME_SQL = `
  (
    (cd.category_type = 'income' AND t.price > 0 AND COALESCE(cd.is_counted_as_income, 1) = 1)
    OR (cd.category_type IS NULL AND t.price > 0)
    OR (COALESCE(cd.name, '') = $3 AND t.price > 0)
  )
`;

const EXPENSE_SQL = `
  (
    (cd.category_type = 'expense' OR (cd.category_type IS NULL AND t.price < 0))
    AND t.price < 0
  )
`;

const CAPITAL_RETURNS_SQL = `
  (cd.category_type = 'income' AND t.price > 0 AND COALESCE(cd.is_counted_as_income, 1) = 0)
`;

const INVESTMENT_OUTFLOW_SQL = `
  (cd.category_type = 'investment' AND t.price < 0)
`;

const INVESTMENT_INFLOW_SQL = `
  (cd.category_type = 'investment' AND t.price > 0)
`;

function parseBooleanParam(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
      return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
      return false;
    }
  }
  return defaultValue;
}

function resolveDateAggregation(column, aggregation = 'daily') {
  const unit = aggregation === 'weekly'
    ? 'week'
    : aggregation === 'monthly'
      ? 'month'
      : 'day';
  const truncExpr = dialect.dateTrunc(unit, column);
  return {
    groupBy: truncExpr,
    select: `${truncExpr} as date`,
  };
}

async function getDashboardAnalytics(query = {}) {
  const timerStart = performance.now();
  const { startDate, endDate, months = 3, aggregation = 'daily' } = query;
  const includeBreakdowns = parseBooleanParam(query.includeBreakdowns, true);
  const includeSummary = parseBooleanParam(query.includeSummary, true);
  const { start, end } = resolveDateRange({ startDate, endDate, months });
  const skipCache =
    process.env.NODE_ENV === 'test' ||
    parseBooleanParam(query.noCache, false);
  const cacheKey = JSON.stringify({
    start: start.toISOString(),
    end: end.toISOString(),
    aggregation,
    months,
    includeBreakdowns,
    includeSummary,
  });
  if (!skipCache) {
    const cached = dashboardCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }
  const creditCardRepaymentCondition = getCreditCardRepaymentCategoryCondition('cd');

  const { groupBy: dateGroupBy, select: dateSelect } = resolveDateAggregation('t.date', aggregation);

  const historyResult = await database.query(
    `WITH base_history AS (
      SELECT
        ${dateSelect},
        SUM(CASE
          WHEN ${COUNTED_INCOME_SQL} THEN t.price
          ELSE 0
        END) as income,
        SUM(CASE
          WHEN ${EXPENSE_SQL} THEN ABS(t.price)
          ELSE 0
        END) as expenses,
        SUM(CASE
          WHEN ${CAPITAL_RETURNS_SQL} THEN t.price
          ELSE 0
        END) as capital_returns,
        SUM(CASE
          WHEN ${COUNTED_INCOME_SQL}
            AND ${SALARY_MATCH_SQL}
          THEN t.price
          ELSE 0
        END) as salary_income,
        SUM(CASE
          WHEN (${creditCardRepaymentCondition}) AND t.price < 0
          THEN ABS(t.price)
          ELSE 0
        END) as card_repayments,
        SUM(CASE
          WHEN ${EXPENSE_SQL}
            AND EXISTS (
              SELECT 1
              FROM account_pairings ap
              WHERE ap.is_active = 1
                AND ap.credit_card_vendor = t.vendor
                AND (
                  ap.credit_card_account_number IS NULL
                  OR ap.credit_card_account_number = t.account_number
                )
            )
          THEN ABS(t.price)
          ELSE 0
        END) as paired_card_expenses
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent_cd ON parent_cd.id = cd.parent_id
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND tpe.transaction_identifier IS NULL
        AND ${dialect.excludePikadon('t')}
      GROUP BY ${dateGroupBy}
    ),
    paired_repayment_history AS (
      SELECT
        ${dateSelect},
        SUM(CASE
          WHEN (${creditCardRepaymentCondition}) AND t.price < 0
          THEN ABS(t.price)
          ELSE 0
        END) as paired_card_repayments
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND tpe.transaction_identifier IS NOT NULL
        AND ${dialect.excludePikadon('t')}
      GROUP BY ${dateGroupBy}
    ),
    history_dates AS (
      SELECT date FROM base_history
      UNION
      SELECT date FROM paired_repayment_history
    )
    SELECT
      hd.date as date,
      COALESCE(bh.income, 0) as income,
      COALESCE(bh.expenses, 0) as expenses,
      COALESCE(bh.capital_returns, 0) as capital_returns,
      COALESCE(bh.salary_income, 0) as salary_income,
      COALESCE(bh.card_repayments, 0) as card_repayments,
      COALESCE(bh.paired_card_expenses, 0) as paired_card_expenses,
      COALESCE(prh.paired_card_repayments, 0) as paired_card_repayments
    FROM history_dates hd
    LEFT JOIN base_history bh ON hd.date = bh.date
    LEFT JOIN paired_repayment_history prh ON hd.date = prh.date
    ORDER BY hd.date ASC`,
    [start, end, BANK_CATEGORY_NAME],
  );

  const monthExpr = dialect.toChar('t.date', 'YYYY-MM');
  let categoryDataResult = { rows: [] };
  let vendorResult = { rows: [] };
  let monthResult = { rows: [] };
  if (includeBreakdowns) {
    [
      categoryDataResult,
      vendorResult,
      monthResult,
    ] = await Promise.all([
      database.query(
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
      ),

      database.query(
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
      ),

      database.query(
        `SELECT
          ${monthExpr} as month,
          SUM(CASE
            WHEN ${COUNTED_INCOME_SQL} THEN t.price
            ELSE 0
          END) as income,
          SUM(CASE
            WHEN ${EXPENSE_SQL} THEN ABS(t.price)
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
      ),
    ]);
  }

  let totalIncome = 0;
  let totalCapitalReturns = 0;
  let totalExpenses = 0;
  let investmentOutflow = 0;
  let investmentInflow = 0;
  let netInvestments = 0;
  let netBalance = 0;
  let totalAccounts = 0;
  let pendingExpenses = 0;
  let pendingCount = 0;
  let currentBankBalance = 0;
  let monthStartBankBalance = 0;
  let bankBalanceChange = 0;
  let pikkadonBalance = 0;
  let checkingBalance = 0;
  let pendingCCDebt = 0;
  let availableBalance = 0;
  let currentBankBalancesResult = { rows: [] };
  const balanceHistoryMap = new Map();

  if (includeSummary) {
    const [summaryResult, pendingExpensesResult] = await Promise.all([
      database.query(
        `SELECT
          SUM(CASE
            WHEN ${COUNTED_INCOME_SQL} THEN t.price
            ELSE 0
          END) as total_income,
          SUM(CASE
            WHEN ${CAPITAL_RETURNS_SQL} THEN t.price
            ELSE 0
          END) as total_capital_returns,
          SUM(CASE
            WHEN ${EXPENSE_SQL} THEN ABS(t.price)
            ELSE 0
          END) as total_expenses,
          SUM(CASE
            WHEN ${INVESTMENT_OUTFLOW_SQL} THEN ABS(t.price)
            ELSE 0
          END) as investment_outflow,
          SUM(CASE
            WHEN ${INVESTMENT_INFLOW_SQL} THEN t.price
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
      ),

      // Query for pending expenses (processed_date > today)
      database.query(
        `SELECT
          SUM(CASE
            WHEN ${EXPENSE_SQL} THEN ABS(t.price)
            ELSE 0
          END) as pending_expenses,
          COUNT(CASE
            WHEN ${EXPENSE_SQL} THEN 1
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
      ),
    ]);

    const summary = summaryResult.rows[0] || {};
    totalIncome = Number.parseFloat(summary.total_income || 0);
    totalCapitalReturns = Number.parseFloat(summary.total_capital_returns || 0);
    totalExpenses = Number.parseFloat(summary.total_expenses || 0);
    investmentOutflow = Number.parseFloat(summary.investment_outflow || 0);
    investmentInflow = Number.parseFloat(summary.investment_inflow || 0);
    netInvestments = investmentOutflow - investmentInflow;
    netBalance = totalIncome - totalExpenses;
    totalAccounts = Number.parseInt(summary.total_accounts || 0, 10) || 0;

    const pendingData = pendingExpensesResult.rows[0] || {};
    pendingExpenses = Number.parseFloat(pendingData.pending_expenses || 0);
    pendingCount = Number.parseInt(pendingData.pending_count || 0, 10);

    const startDateStr = start.toISOString().split('T')[0];
    const monthStartDate = `${startDateStr.substring(0, 7)}-01`;
    const { groupBy: balanceHistoryGroupBy, select: balanceHistorySelect } = resolveDateAggregation(
      'ih.as_of_date',
      aggregation,
    );

    const [
      currentBankBalancesResultRaw,
      monthStartBalancesResult,
      balanceHistoryResult,
      pikkadonResult,
      pendingCCDebtResult,
    ] = await Promise.all([
      // Query 1: Current bank balances (latest snapshot per account)
      database.query(
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
        [],
      ),

      // Query 2: Month-start bank balance (latest snapshot on or before the month start)
      database.query(
        `SELECT
          COALESCE(SUM(latest.current_value), 0) as total_balance
        FROM (
          SELECT ih.account_id, ih.current_value
          FROM investment_holdings ih
          JOIN investment_accounts ia ON ih.account_id = ia.id
          WHERE ia.account_type = 'bank_balance'
            AND ia.is_active = 1
            AND ih.as_of_date = (
              SELECT MAX(ih2.as_of_date)
              FROM investment_holdings ih2
              WHERE ih2.account_id = ih.account_id
                AND ih2.as_of_date <= $1
            )
        ) latest`,
        [monthStartDate],
      ),

      // Query 3: Bank balance history aggregated by period
      database.query(
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
        [start, end],
      ),

      // Query 4: Calculate pikadon (savings/deposits) balance within the selected range
      database.query(
        `SELECT
        SUM(CASE WHEN t.price > 0 THEN t.price ELSE 0 END) as pikadon_inflow,
        SUM(CASE WHEN t.price < 0 THEN t.price ELSE 0 END) as pikadon_outflow,
        SUM(t.price) as net_pikadon
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      WHERE ${PIKADON_MATCH_SQL}
        AND t.vendor IN (
          SELECT vendor_code FROM institution_nodes
          WHERE node_type = 'institution'
            AND institution_type IN ('bank', 'financial')
        )
        AND t.date >= $1
        AND t.date <= $2`,
        [monthStartDate, end],
      ),

      // Query 5: Calculate pending CC debt (expenses after last completed repayment)
      database.query(
        `WITH last_repayment AS (
          SELECT MAX(t.date) as last_date
          FROM transactions t
          JOIN category_definitions cd ON t.category_definition_id = cd.id
          WHERE (${creditCardRepaymentCondition})
            AND t.status = 'completed'
        ),
        cc_vendors AS (
          SELECT DISTINCT credit_card_vendor as vendor
          FROM account_pairings
          WHERE is_active = 1
        )
        SELECT COALESCE(SUM(ABS(t.price)), 0) as pending_debt
        FROM transactions t
        CROSS JOIN last_repayment lr
        WHERE t.vendor IN (SELECT vendor FROM cc_vendors)
          AND t.price < 0
          AND (lr.last_date IS NULL OR t.date > lr.last_date)`,
        [],
      ),
    ]);

    currentBankBalancesResult = currentBankBalancesResultRaw;

    // Calculate bank balance metrics
    currentBankBalance = currentBankBalancesResult.rows.reduce(
      (sum, row) => sum + Number.parseFloat(row.current_balance || 0),
      0,
    );

    monthStartBankBalance = Number.parseFloat(monthStartBalancesResult.rows[0]?.total_balance || 0);
    bankBalanceChange = currentBankBalance - monthStartBankBalance;

    pikkadonBalance = Number.parseFloat(pikkadonResult.rows[0]?.net_pikadon || 0);
    pendingCCDebt = Number.parseFloat(pendingCCDebtResult.rows[0]?.pending_debt || 0);

    // Calculate final balances
    checkingBalance = currentBankBalance - pikkadonBalance;
    availableBalance = checkingBalance - pendingCCDebt;

    // Create a map for merging balance history with transaction history
    balanceHistoryResult.rows.forEach((row) => {
      balanceHistoryMap.set(row.date, Number.parseFloat(row.total_balance || 0));
    });
  }

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
      totalAccounts,
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
      capitalReturns: Number.parseFloat(row.capital_returns || 0),
      cardRepayments: Number.parseFloat(row.card_repayments || 0),
      pairedCardExpenses: Number.parseFloat(row.paired_card_expenses || 0),
      pairedCardRepayments: Number.parseFloat(row.paired_card_repayments || 0),
      salaryIncome: Number.parseFloat(row.salary_income || 0),
      // NEW: Add bank balance to history
      ...(includeSummary ? { bankBalance: balanceHistoryMap.get(row.date) || 0 } : {}),
    })),
    breakdowns: {
      byCategory: includeBreakdowns ? buildCategoryBreakdown(categoryDataResult.rows) : [],
      byVendor: includeBreakdowns
        ? vendorResult.rows.map((row) => ({
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
        }))
        : [],
      byMonth: includeBreakdowns
        ? monthResult.rows.map((row) => ({
          month: row.month,
          income: Number.parseFloat(row.income || 0),
          expenses: Number.parseFloat(row.expenses || 0),
        }))
        : [],
      // NEW: Bank account breakdown
      byBankAccount: includeBreakdowns && includeSummary
        ? currentBankBalancesResult.rows.map((row) => ({
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
        }))
        : [],
    },
  };

  const durationMs = Number((performance.now() - timerStart).toFixed(2));
  const metricPayload = {
    durationMs,
    months,
    aggregation,
    includeBreakdowns,
    includeSummary,
    dateRange: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    rowCounts: {
      history: historyResult.rows.length,
      categories: includeBreakdowns ? categoryDataResult.rows.length : 0,
      vendors: includeBreakdowns ? vendorResult.rows.length : 0,
      months: includeBreakdowns ? monthResult.rows.length : 0,
      accounts: includeSummary ? currentBankBalancesResult.rows.length : 0,
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
