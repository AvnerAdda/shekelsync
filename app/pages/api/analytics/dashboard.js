import { getDB } from '../db.js';
import { startOfWeek, startOfMonth, format } from 'date-fns';
import { buildDuplicateFilter, resolveDateRange } from './utils.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { startDate, endDate, months = 3, aggregation = 'daily', excludeDuplicates = 'true' } = req.query;

    const { start, end } = resolveDateRange({ startDate, endDate, months });

    // Determine aggregation SQL based on period
    let dateGroupBy, dateSelect;
    switch (aggregation) {
      case 'weekly':
        dateGroupBy = "DATE_TRUNC('week', date)";
        dateSelect = "DATE_TRUNC('week', date) as date";
        break;
      case 'monthly':
        dateGroupBy = "DATE_TRUNC('month', date)";
        dateSelect = "DATE_TRUNC('month', date) as date";
        break;
      case 'daily':
      default:
        dateGroupBy = 'date';
        dateSelect = 'date';
    }

    // Build duplicate exclusion clause
    // Check both transaction_duplicates and manual_exclusions tables
    const shouldExcludeDuplicates = excludeDuplicates === 'true';
    const duplicateFilter = shouldExcludeDuplicates
      ? await buildDuplicateFilter(client, 'transactions')
      : '';

    // Get transaction history with aggregation
    const historyResult = await client.query(
      `SELECT
        ${dateSelect},
        SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as income,
        SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as expenses
      FROM transactions
      WHERE date >= $1 AND date <= $2
      ${duplicateFilter}
      GROUP BY ${dateGroupBy}
      ORDER BY date ASC`,
      [start, end]
    );

    // Get breakdown by category (EXPENSES ONLY - negative prices)
    // Return hierarchical structure: parent categories with their subcategories
    // Build the duplicate filter with 't' alias
    const categoryDuplicateFilter = duplicateFilter ? duplicateFilter.replace(/transactions\./g, 't.') : '';

    const categoryResult = await client.query(
      `WITH parent_totals AS (
        SELECT
          cd_parent.id as parent_id,
          cd_parent.name as parent_name,
          COUNT(t.identifier) as count,
          SUM(ABS(t.price)) as total
        FROM transactions t
        JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
        JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
        WHERE t.date >= $1 AND t.date <= $2
        AND t.price < 0
        AND cd_parent.category_type = 'expense'
        ${categoryDuplicateFilter}
        GROUP BY cd_parent.id, cd_parent.name
      ),
      subcategory_breakdown AS (
        SELECT
          cd_parent.id as parent_id,
          cd_parent.name as parent_name,
          cd_child.id as subcategory_id,
          cd_child.name as subcategory_name,
          COUNT(t.identifier) as count,
          SUM(ABS(t.price)) as total
        FROM transactions t
        JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
        JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
        WHERE t.date >= $1 AND t.date <= $2
        AND t.price < 0
        AND cd_parent.category_type = 'expense'
        ${categoryDuplicateFilter}
        GROUP BY cd_parent.id, cd_parent.name, cd_child.id, cd_child.name
      )
      SELECT
        pt.parent_id,
        pt.parent_name as category,
        pt.count,
        pt.total,
        json_agg(
          json_build_object(
            'id', sb.subcategory_id,
            'name', sb.subcategory_name,
            'count', sb.count,
            'total', sb.total
          ) ORDER BY sb.total DESC
        ) as subcategories
      FROM parent_totals pt
      LEFT JOIN subcategory_breakdown sb ON pt.parent_id = sb.parent_id
      GROUP BY pt.parent_id, pt.parent_name, pt.count, pt.total
      ORDER BY pt.total DESC`,
      [start, end]
    );

    // Get breakdown by vendor (EXPENSES ONLY)
    const vendorResult = await client.query(
      `SELECT
        vendor,
        COUNT(*) as count,
        SUM(ABS(price)) as total
      FROM transactions
      WHERE date >= $1 AND date <= $2
      AND price < 0
      ${duplicateFilter}
      GROUP BY vendor
      ORDER BY total DESC`,
      [start, end]
    );

    // Get breakdown by month
    const monthResult = await client.query(
      `SELECT
        TO_CHAR(date, 'YYYY-MM') as month,
        SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as income,
        SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as expenses
      FROM transactions
      WHERE date >= $1 AND date <= $2
      ${duplicateFilter}
      GROUP BY TO_CHAR(date, 'YYYY-MM')
      ORDER BY month ASC`,
      [start, end]
    );

    // Get summary stats
    const summaryResult = await client.query(
      `SELECT
        SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as total_income,
        SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as total_expenses,
        COUNT(DISTINCT vendor) as total_accounts
      FROM transactions
      WHERE date >= $1 AND date <= $2
      ${duplicateFilter}`,
      [start, end]
    );

    const summary = summaryResult.rows[0];
    const totalIncome = parseFloat(summary.total_income || 0);
    const totalExpenses = parseFloat(summary.total_expenses || 0);
    const netBalance = totalIncome - totalExpenses;

    console.log('Summary calculation:', {
      totalIncome,
      totalExpenses,
      netBalance,
      raw: summary
    });

    res.status(200).json({
      dateRange: { start, end },
      summary: {
        totalIncome,
        totalExpenses,
        netBalance,
        totalAccounts: parseInt(summary.total_accounts || 0)
      },
      history: historyResult.rows.map(row => ({
        date: row.date,
        income: parseFloat(row.income || 0),
        expenses: parseFloat(row.expenses || 0)
      })),
      breakdowns: {
        byCategory: categoryResult.rows.map(row => ({
          parentId: row.parent_id,
          category: row.category,
          count: parseInt(row.count),
          total: parseFloat(row.total),
          subcategories: row.subcategories || []
        })),
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
