const actualDatabase = require('../database.js');
const { resolveDateRange } = require('../../../lib/server/query-utils.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');
const { dialect } = require('../../../lib/sql-dialect.js');

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
    history: historyResult.rows.map((row) => ({
      date: row.date,
      income: Number.parseFloat(row.income || 0),
      expenses: Number.parseFloat(row.expenses || 0),
    })),
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
