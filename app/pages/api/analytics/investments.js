import { getDB } from '../db.js';
import { dialect } from '../../../lib/sql-dialect.js';

/**
 * Get investment analytics using category_type = 'investment'
 * GET /api/analytics/investments
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { startDate, endDate } = req.query;

    let dateFilter = '';
    const params = [];

    if (startDate && endDate) {
      const startStr = new Date(startDate).toISOString().split('T')[0];
      const endStr = new Date(endDate).toISOString().split('T')[0];
      dateFilter = 'AND t.date >= $1 AND t.date <= $2';
      params.push(startStr, endStr);
    }

    // Get all investment transactions (using new category system)
    const transactionsQuery = `
      SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.name,
        t.price,
        t.account_number,
        cd.id as category_definition_id,
        cd.name as category_name,
        cd.name_en as category_name_en,
        cd.parent_id,
        parent.name as parent_name,
        parent.name_en as parent_name_en
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      WHERE cd.category_type = 'investment'
      ${dateFilter}
      ORDER BY t.date DESC
    `;

    const transactionsResult = await client.query(transactionsQuery, params);
    const transactions = transactionsResult.rows;

    // Calculate summary statistics
    const summary = {
      totalMovement: 0,      // Total absolute value of all transactions
      investmentOutflow: 0,  // Money going out (deposits)
      investmentInflow: 0,   // Money coming in (withdrawals)
      netInvestments: 0,     // Net amount invested (outflow - inflow)
      totalCount: transactions.length,
    };

    // Breakdown by category
    const byCategory = {};

    transactions.forEach(txn => {
      const amount = parseFloat(txn.price);
      const absAmount = Math.abs(amount);
      const categoryName = txn.category_name || 'Unknown';
      const categoryNameEn = txn.category_name_en || 'Unknown';

      // Update summary
      summary.totalMovement += absAmount;
      if (amount < 0) {
        summary.investmentOutflow += absAmount;
      } else {
        summary.investmentInflow += absAmount;
      }

      // Breakdown by category
      if (!byCategory[categoryName]) {
        byCategory[categoryName] = {
          name: categoryName,
          name_en: categoryNameEn,
          total: 0,
          count: 0,
          outflow: 0,
          inflow: 0,
        };
      }
      byCategory[categoryName].total += absAmount;
      byCategory[categoryName].count++;
      if (amount < 0) {
        byCategory[categoryName].outflow += absAmount;
      } else {
        byCategory[categoryName].inflow += absAmount;
      }
    });

    summary.netInvestments = summary.investmentOutflow - summary.investmentInflow;

    // Timeline data (monthly aggregation)
    const monthExpr = dialect.dateTrunc('month', 't.date');
    const timelineQuery = `
      SELECT
        ${monthExpr} as month,
        SUM(CASE WHEN t.price < 0 THEN ABS(t.price) ELSE 0 END) as outflow,
        SUM(CASE WHEN t.price > 0 THEN t.price ELSE 0 END) as inflow,
        COUNT(*) as count
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      WHERE cd.category_type = 'investment'
      ${dateFilter}
      GROUP BY ${monthExpr}
      ORDER BY month DESC
    `;

    const timelineResult = await client.query(timelineQuery, [...params]);
    const timeline = timelineResult.rows.map(row => {
      const outflow = parseFloat(row.outflow || 0);
      const inflow = parseFloat(row.inflow || 0);
      return {
        month: row.month,
        outflow,
        inflow,
        net: outflow - inflow,
        count: parseInt(row.count),
      };
    });

    // Format category data for response
    const categoriesArray = Object.values(byCategory).sort((a, b) => b.total - a.total);

    res.status(200).json({
      summary,
      byCategory: categoriesArray,
      timeline,
      transactions: transactions.map(txn => ({
        ...txn,
        price: parseFloat(txn.price),
      })),
    });

  } catch (error) {
    console.error('Error fetching investment analytics:', error);
    res.status(500).json({
      error: 'Failed to fetch investment analytics',
      details: error.message
    });
  } finally {
    client.release();
  }
}
