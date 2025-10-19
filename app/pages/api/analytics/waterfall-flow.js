import { getDB } from '../db.js';
import { buildDuplicateFilter, resolveDateRange } from './utils.js';

/**
 * Waterfall Flow API
 * GET /api/analytics/waterfall-flow - Get waterfall chart data showing income → expenses → investments → net
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { startDate, endDate, months = 3, excludeDuplicates = 'true' } = req.query;

    const { start, end } = resolveDateRange({ startDate, endDate, months });

    // Build duplicate exclusion clause
    const shouldExcludeDuplicates = excludeDuplicates === 'true';
    const duplicateFilter = shouldExcludeDuplicates
      ? await buildDuplicateFilter(client, 'transactions')
      : '';

    // Get income sources by vendor/category
    const incomeResult = await client.query(
      `SELECT
        cd.name as category_name,
        cd.name_en as category_name_en,
        t.vendor,
        SUM(t.price) as total,
        COUNT(*) as count
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      WHERE t.date >= $1 AND t.date <= $2
      AND cd.category_type = 'income'
      AND t.price > 0
      ${duplicateFilter.replace(/transactions\./g, 't.')}
      GROUP BY cd.name, cd.name_en, t.vendor
      ORDER BY total DESC`,
      [start, end]
    );

    // Get expense categories breakdown
    const expensesResult = await client.query(
      `SELECT
        cd_parent.name as parent_category,
        cd_parent.name_en as parent_category_en,
        SUM(ABS(t.price)) as total,
        COUNT(*) as count
      FROM transactions t
      JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
      JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
      WHERE t.date >= $1 AND t.date <= $2
      AND t.price < 0
      AND cd_parent.category_type = 'expense'
      ${duplicateFilter.replace(/transactions\./g, 't.')}
      GROUP BY cd_parent.name, cd_parent.name_en
      ORDER BY total DESC`,
      [start, end]
    );

    // Get investment flows (both inflow and outflow)
    const investmentResult = await client.query(
      `SELECT
        cd.name as category_name,
        cd.name_en as category_name_en,
        SUM(CASE WHEN t.price < 0 THEN ABS(t.price) ELSE 0 END) as outflow,
        SUM(CASE WHEN t.price > 0 THEN t.price ELSE 0 END) as inflow,
        COUNT(*) as count
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      WHERE t.date >= $1 AND t.date <= $2
      AND cd.category_type = 'investment'
      ${duplicateFilter.replace(/transactions\./g, 't.')}
      GROUP BY cd.name, cd.name_en
      ORDER BY outflow DESC`,
      [start, end]
    );

    // Calculate totals for waterfall structure
    const totalIncome = incomeResult.rows.reduce((sum, row) => sum + parseFloat(row.total), 0);
    const totalExpenses = expensesResult.rows.reduce((sum, row) => sum + parseFloat(row.total), 0);
    const totalInvestmentOutflow = investmentResult.rows.reduce((sum, row) => sum + parseFloat(row.outflow), 0);
    const totalInvestmentInflow = investmentResult.rows.reduce((sum, row) => sum + parseFloat(row.inflow), 0);
    const netInvestments = totalInvestmentOutflow - totalInvestmentInflow;
    const netBalance = totalIncome - totalExpenses - netInvestments;

    // Build waterfall data structure
    const waterfallData = [];
    let runningTotal = 0;

    // 1. Income sources (individual line items)
    incomeResult.rows.forEach(row => {
      const value = parseFloat(row.total);
      waterfallData.push({
        name: row.vendor || row.category_name_en || row.category_name,
        value: value,
        type: 'income',
        cumulative: runningTotal + value,
        startValue: runningTotal,
        color: '#10b981', // Green for income
        count: parseInt(row.count)
      });
      runningTotal += value;
    });

    // 2. Expense categories (negative impact)
    expensesResult.rows.forEach(row => {
      const value = parseFloat(row.total);
      waterfallData.push({
        name: row.parent_category_en || row.parent_category,
        value: -value, // Negative for expenses
        type: 'expense',
        cumulative: runningTotal - value,
        startValue: runningTotal,
        color: '#ef4444', // Red for expenses
        count: parseInt(row.count)
      });
      runningTotal -= value;
    });

    // 3. Individual investment outflows
    investmentResult.rows.forEach(row => {
      const netInvestment = parseFloat(row.outflow) - parseFloat(row.inflow);
      if (netInvestment > 0) {
        waterfallData.push({
          name: row.category_name_en || row.category_name,
          value: -netInvestment,
          type: 'investment',
          cumulative: runningTotal - netInvestment,
          startValue: runningTotal,
          color: '#3b82f6', // Blue for investments
          count: parseInt(row.count)
        });
        runningTotal -= netInvestment;
      }
    });

    // 4. Final net balance
    waterfallData.push({
      name: 'Net Balance',
      value: netBalance,
      type: 'net',
      cumulative: runningTotal,
      startValue: 0,
      color: netBalance >= 0 ? '#10b981' : '#ef4444',
      count: 0
    });

    res.status(200).json({
      dateRange: { start, end },
      summary: {
        totalIncome,
        totalExpenses,
        netInvestments,
        netBalance,
        totalTransactions: [
          ...incomeResult.rows,
          ...expensesResult.rows,
          ...investmentResult.rows
        ].reduce((sum, row) => sum + parseInt(row.count), 0)
      },
      waterfallData,
      breakdown: {
        income: incomeResult.rows.map(row => ({
          name: row.vendor || row.category_name_en || row.category_name,
          category: row.category_name_en || row.category_name,
          vendor: row.vendor,
          total: parseFloat(row.total),
          count: parseInt(row.count)
        })),
        expenses: expensesResult.rows.map(row => ({
          category: row.parent_category_en || row.parent_category,
          total: parseFloat(row.total),
          count: parseInt(row.count)
        })),
        investments: investmentResult.rows.map(row => ({
          category: row.category_name_en || row.category_name,
          outflow: parseFloat(row.outflow),
          inflow: parseFloat(row.inflow),
          net: parseFloat(row.outflow) - parseFloat(row.inflow),
          count: parseInt(row.count)
        }))
      }
    });

  } catch (error) {
    console.error('Error fetching waterfall flow data:', error);
    res.status(500).json({
      error: 'Failed to fetch waterfall flow data',
      details: error.message
    });
  } finally {
    client.release();
  }
}