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

    // Get breakdown by income type (categorized by transaction name patterns)
    // Common Israeli income patterns
    const incomeTypesResult = await client.query(
      `SELECT
        CASE
          WHEN LOWER(name) LIKE '%משכורת%' OR LOWER(name) LIKE '%שכר%' THEN 'Salary'
          WHEN LOWER(name) LIKE '%בונוס%' OR LOWER(name) LIKE '%פרמיה%' THEN 'Bonus'
          WHEN LOWER(name) LIKE '%זיכוי%' OR LOWER(name) LIKE '%החזר%' THEN 'Refund'
          WHEN LOWER(name) LIKE '%הפקדה%' THEN 'Deposit'
          WHEN LOWER(name) LIKE '%ריבית%' THEN 'Interest'
          WHEN LOWER(name) LIKE '%דיבידנד%' THEN 'Dividend'
          WHEN LOWER(name) LIKE '%מתנה%' THEN 'Gift'
          WHEN LOWER(name) LIKE '%העברה%' THEN 'Transfer'
          ELSE 'Other Income'
        END as income_type,
        COUNT(*) as count,
        SUM(price) as total,
        AVG(price) as average
      FROM transactions
      WHERE price > 0
      AND date >= $1 AND date <= $2
      ${duplicateFilter}
      GROUP BY income_type
      ORDER BY total DESC`,
      [start, end]
    );

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
        byType: incomeTypesResult.rows.map(row => ({
          type: row.income_type,
          count: parseInt(row.count),
          total: parseFloat(row.total),
          average: parseFloat(row.average)
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
