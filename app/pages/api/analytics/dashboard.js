import { getDB } from '../db.js';
import { startOfWeek, startOfMonth, format } from 'date-fns';
import { resolveDateRange } from './utils.js';
import { BANK_CATEGORY_NAME } from '../../../lib/category-constants.js';
import { dialect } from '../../../lib/sql-dialect.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { startDate, endDate, months = 3, aggregation = 'daily' } = req.query;

    const { start, end } = resolveDateRange({ startDate, endDate, months });

    // Determine aggregation SQL based on period
    let dateGroupBy, dateSelect;
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

    // Get transaction history with aggregation - separated by category type
    // Fallback to price sign if category_definition_id is NULL
    const historyResult = await client.query(
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
      [start, end, BANK_CATEGORY_NAME]
    );

    // Get breakdown by category (EXPENSES ONLY - negative prices)
    // Return hierarchical structure: parent categories with their subcategories
    const categoryDataResult = await client.query(
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
      [start, end]
    );

    // Get breakdown by vendor (EXPENSES ONLY)
    const vendorResult = await client.query(
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
      [start, end]
    );

    // Get breakdown by month - separated by category type
    // Fallback to price sign if category_definition_id is NULL
    const monthExpr = dialect.toChar('t.date', 'YYYY-MM');
    const monthResult = await client.query(
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
      [start, end, BANK_CATEGORY_NAME]
    );

    // Get summary stats - properly separated by category type
    // Fallback to price sign if category_definition_id is NULL
    const summaryResult = await client.query(
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
      [start, end, BANK_CATEGORY_NAME]
    );

    const summary = summaryResult.rows[0];
    const totalIncome = parseFloat(summary.total_income || 0);
    const totalExpenses = parseFloat(summary.total_expenses || 0);
    const investmentOutflow = parseFloat(summary.investment_outflow || 0);
    const investmentInflow = parseFloat(summary.investment_inflow || 0);
    const netInvestments = investmentOutflow - investmentInflow; // Positive = net investment, Negative = net withdrawal
    const netBalance = totalIncome - totalExpenses;

    console.log('Summary calculation:', {
      totalIncome,
      totalExpenses,
      netBalance,
      investmentOutflow,
      investmentInflow,
      netInvestments,
      raw: summary
    });

    res.status(200).json({
      dateRange: { start, end },
      summary: {
        totalIncome,
        totalExpenses,
        netBalance,
        investmentOutflow,
        investmentInflow,
        netInvestments,
        totalAccounts: parseInt(summary.total_accounts || 0)
      },
      history: historyResult.rows.map(row => ({
        date: row.date,
        income: parseFloat(row.income || 0),
        expenses: parseFloat(row.expenses || 0)
      })),
      breakdowns: {
        byCategory: buildCategoryBreakdown(categoryDataResult.rows),
        byVendor: vendorResult.rows.map(row => ({
          vendor: row.vendor,
          count: parseInt(row.count),
          total: parseFloat(row.total)
        })),
        byMonth: monthResult.rows.map(row => ({
          month: row.month,
          income: parseFloat(row.income || 0),
          expenses: parseFloat(row.expenses || 0)
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard analytics:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard analytics', details: error.message });
  } finally {
    client.release();
  }
}

function buildCategoryBreakdown(rows) {
  const parentMap = new Map();

  rows.forEach(row => {
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
    const count = parseInt(row.count);
    const total = parseFloat(row.total);

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

  result.forEach(parent => {
    parent.subcategories.sort((a, b) => b.total - a.total);
  });

  result.sort((a, b) => b.total - a.total);
  return result;
}
