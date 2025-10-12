import { getDB } from '../db.js';
import { subMonths } from 'date-fns';

/**
 * Income Breakdown API
 * Provides detailed analysis of income transactions
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { startDate, endDate, months = 3, excludeDuplicates = 'true' } = req.query;

    // Calculate date range
    let start, end;
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      end = new Date();
      start = subMonths(end, parseInt(months));
    }

    // Build duplicate exclusion clause
    // Check both transaction_duplicates and manual_exclusions tables
    let shouldExcludeDuplicates = excludeDuplicates === 'true';
    let duplicateFilter = '';

    if (shouldExcludeDuplicates) {
      try {
        // Check if tables exist
        const duplicatesTableCheck = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_name = 'transaction_duplicates'
          );
        `);

        const manualExclusionsTableCheck = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_name = 'manual_exclusions'
          );
        `);

        const hasDuplicatesTable = duplicatesTableCheck.rows[0].exists;
        const hasManualExclusions = manualExclusionsTableCheck.rows[0].exists;

        if (hasDuplicatesTable || hasManualExclusions) {
          let conditions = [];

          if (hasDuplicatesTable) {
            conditions.push(`
              NOT EXISTS (
                SELECT 1 FROM transaction_duplicates td
                WHERE td.exclude_from_totals = true
                AND (
                  (td.transaction1_identifier = transactions.identifier AND td.transaction1_vendor = transactions.vendor) OR
                  (td.transaction2_identifier = transactions.identifier AND td.transaction2_vendor = transactions.vendor)
                )
              )
            `);
          }

          if (hasManualExclusions) {
            conditions.push(`
              NOT EXISTS (
                SELECT 1 FROM manual_exclusions me
                WHERE me.transaction_identifier = transactions.identifier
                AND me.transaction_vendor = transactions.vendor
              )
            `);
          }

          if (conditions.length > 0) {
            duplicateFilter = `AND (${conditions.join(' AND ')})`;
          }
        }
      } catch (err) {
        console.log('Duplicate filtering not available:', err.message);
      }
    }

    // Get total income summary
    const summaryResult = await client.query(
      `SELECT
        SUM(price) as total_income,
        COUNT(*) as transaction_count,
        AVG(price) as average_income,
        MIN(price) as min_income,
        MAX(price) as max_income
      FROM transactions
      WHERE price > 0
      AND date >= $1 AND date <= $2
      ${duplicateFilter}`,
      [start, end]
    );

    // Get breakdown by vendor/source
    const byVendorResult = await client.query(
      `SELECT
        vendor,
        COUNT(*) as count,
        SUM(price) as total,
        AVG(price) as average
      FROM transactions
      WHERE price > 0
      AND date >= $1 AND date <= $2
      ${duplicateFilter}
      GROUP BY vendor
      ORDER BY total DESC`,
      [start, end]
    );

    // Get breakdown by month
    const byMonthResult = await client.query(
      `SELECT
        TO_CHAR(date, 'YYYY-MM') as month,
        SUM(price) as total,
        COUNT(*) as count,
        AVG(price) as average
      FROM transactions
      WHERE price > 0
      AND date >= $1 AND date <= $2
      ${duplicateFilter}
      GROUP BY TO_CHAR(date, 'YYYY-MM')
      ORDER BY month ASC`,
      [start, end]
    );

    // Get hierarchical income breakdown using category_definitions
    // Try hierarchical categories first
    const incomeTypesResult = await client.query(
      `WITH parent_totals AS (
        SELECT
          cd_parent.id as parent_id,
          cd_parent.name as parent_name,
          COUNT(t.identifier) as count,
          SUM(t.price) as total
        FROM transactions t
        JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
        JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
        WHERE t.date >= $1 AND t.date <= $2
        AND t.price > 0
        AND cd_parent.category_type = 'income'
        ${duplicateFilter.replace(/transactions\./g, 't.')}
        GROUP BY cd_parent.id, cd_parent.name
      ),
      subcategory_breakdown AS (
        SELECT
          cd_parent.id as parent_id,
          cd_parent.name as parent_name,
          cd_child.id as subcategory_id,
          cd_child.name as subcategory_name,
          COUNT(t.identifier) as count,
          SUM(t.price) as total
        FROM transactions t
        JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
        JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
        WHERE t.date >= $1 AND t.date <= $2
        AND t.price > 0
        AND cd_parent.category_type = 'income'
        ${duplicateFilter.replace(/transactions\./g, 't.')}
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

    // Fallback: if no hierarchical categories, show by old category field
    let fallbackTypesResult = { rows: [] };
    if (incomeTypesResult.rows.length === 0) {
      fallbackTypesResult = await client.query(
        `SELECT
          COALESCE(parent_category, category, 'Uncategorized') as category,
          COUNT(*) as count,
          SUM(price) as total
        FROM transactions
        WHERE price > 0
        AND date >= $1 AND date <= $2
        ${duplicateFilter}
        GROUP BY COALESCE(parent_category, category, 'Uncategorized')
        ORDER BY total DESC`,
        [start, end]
      );
    }

    // Get recent income transactions (last 20)
    const recentTransactionsResult = await client.query(
      `SELECT
        identifier,
        vendor,
        date,
        name,
        price,
        account_number,
        memo
      FROM transactions
      WHERE price > 0
      AND date >= $1 AND date <= $2
      ${duplicateFilter}
      ORDER BY date DESC, price DESC
      LIMIT 20`,
      [start, end]
    );

    // Get income by account (if account_number is available)
    const byAccountResult = await client.query(
      `SELECT
        vendor,
        account_number,
        COUNT(*) as count,
        SUM(price) as total,
        AVG(price) as average
      FROM transactions
      WHERE price > 0
      AND date >= $1 AND date <= $2
      AND account_number IS NOT NULL
      ${duplicateFilter}
      GROUP BY vendor, account_number
      ORDER BY total DESC`,
      [start, end]
    );

    // Get weekly pattern (day of week breakdown)
    const byDayOfWeekResult = await client.query(
      `SELECT
        TO_CHAR(date, 'Day') as day_name,
        EXTRACT(DOW FROM date) as day_number,
        COUNT(*) as count,
        SUM(price) as total,
        AVG(price) as average
      FROM transactions
      WHERE price > 0
      AND date >= $1 AND date <= $2
      ${duplicateFilter}
      GROUP BY day_name, day_number
      ORDER BY day_number`,
      [start, end]
    );

    const summary = summaryResult.rows[0];

    res.status(200).json({
      dateRange: { start, end },
      summary: {
        totalIncome: parseFloat(summary.total_income || 0),
        transactionCount: parseInt(summary.transaction_count || 0),
        averageIncome: parseFloat(summary.average_income || 0),
        minIncome: parseFloat(summary.min_income || 0),
        maxIncome: parseFloat(summary.max_income || 0)
      },
      breakdowns: {
        byVendor: byVendorResult.rows.map(row => ({
          vendor: row.vendor,
          count: parseInt(row.count),
          total: parseFloat(row.total),
          average: parseFloat(row.average)
        })),
        byMonth: byMonthResult.rows.map(row => ({
          month: row.month,
          total: parseFloat(row.total),
          count: parseInt(row.count),
          average: parseFloat(row.average)
        })),
        byType: incomeTypesResult.rows.length > 0
          ? incomeTypesResult.rows.map(row => ({
              parentId: row.parent_id,
              category: row.category,
              count: parseInt(row.count),
              total: parseFloat(row.total),
              subcategories: row.subcategories || []
            }))
          : fallbackTypesResult.rows.map((row, index) => ({
              parentId: index + 1000, // Use fake IDs for fallback
              category: row.category,
              count: parseInt(row.count),
              total: parseFloat(row.total),
              subcategories: []
            })),
        byAccount: byAccountResult.rows.map(row => ({
          vendor: row.vendor,
          accountNumber: row.account_number,
          count: parseInt(row.count),
          total: parseFloat(row.total),
          average: parseFloat(row.average)
        })),
        byDayOfWeek: byDayOfWeekResult.rows.map(row => ({
          dayName: row.day_name.trim(),
          dayNumber: parseInt(row.day_number),
          count: parseInt(row.count),
          total: parseFloat(row.total),
          average: parseFloat(row.average)
        }))
      },
      recentTransactions: recentTransactionsResult.rows.map(row => ({
        identifier: row.identifier,
        vendor: row.vendor,
        date: row.date,
        name: row.name,
        price: parseFloat(row.price),
        accountNumber: row.account_number,
        memo: row.memo
      }))
    });

  } catch (error) {
    console.error('Error fetching income breakdown:', error);
    res.status(500).json({
      error: 'Failed to fetch income breakdown',
      details: error.message
    });
  } finally {
    client.release();
  }
}
