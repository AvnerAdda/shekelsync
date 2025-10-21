import { getDB } from '../db.js';
import { subMonths } from 'date-fns';
import { dialect } from '../../../lib/sql-dialect.js';

/**
 * Enhanced analytics dashboard with subcategory support and intelligent insights
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { startDate, endDate, months = 3 } = req.query;

    // Calculate date range
    let start, end;
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      end = new Date();
      start = subMonths(end, parseInt(months));
    }

    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    // 1. Get hierarchical category breakdown (parent + subcategory)
    const hierarchicalBreakdown = await client.query(
      `SELECT
        parent_category,
        subcategory,
        COUNT(*) as transaction_count,
        SUM(ABS(price)) as total_amount,
        AVG(ABS(price)) as avg_amount,
        MIN(ABS(price)) as min_amount,
        MAX(ABS(price)) as max_amount
      FROM transactions
      WHERE date >= $1 AND date <= $2
      AND price < 0
      AND parent_category IS NOT NULL
      AND parent_category NOT IN ('Bank', 'Income')
      GROUP BY parent_category, subcategory
      ORDER BY total_amount DESC`,
      [startStr, endStr]
    );

    // 2. Get auto-categorization statistics
    const autoCategoryStats = await client.query(
      `SELECT
        SUM(CASE WHEN auto_categorized = true THEN 1 ELSE 0 END) as auto_categorized_count,
        SUM(CASE WHEN auto_categorized = false OR auto_categorized IS NULL THEN 1 ELSE 0 END) as manual_count,
        AVG(CASE WHEN auto_categorized = true THEN confidence_score ELSE NULL END) as avg_confidence,
        COUNT(*) as total_transactions
      FROM transactions
      WHERE date >= $1 AND date <= $2
      AND price < 0
      AND parent_category NOT IN ('Bank', 'Income')`,
      [startStr, endStr]
    );

    // 3. Top merchants by spending
    const topMerchants = await client.query(
      `SELECT
        merchant_name,
        parent_category,
        subcategory,
        COUNT(*) as transaction_count,
        SUM(ABS(price)) as total_spent
      FROM transactions
      WHERE date >= $1 AND date <= $2
      AND price < 0
      AND merchant_name IS NOT NULL
      AND parent_category NOT IN ('Bank', 'Income')
      GROUP BY merchant_name, parent_category, subcategory
      ORDER BY total_spent DESC
      LIMIT 20`,
      [startStr, endStr]
    );

    // 4. Monthly trends by category
    const monthExpr = dialect.toChar('date', 'YYYY-MM');
    const monthlyTrends = await client.query(
      `SELECT
        ${monthExpr} as month,
        parent_category,
        SUM(ABS(price)) as amount
      FROM transactions
      WHERE date >= $1 AND date <= $2
      AND price < 0
      AND parent_category IS NOT NULL
      AND parent_category NOT IN ('Bank', 'Income')
      GROUP BY ${monthExpr}, parent_category
      ORDER BY month ASC, amount DESC`,
      [startStr, endStr]
    );

    // 5. Uncategorized transactions that need attention
    const uncategorized = await client.query(
      `SELECT
        name,
        COUNT(*) as occurrences,
        SUM(ABS(price)) as total_amount
      FROM transactions
      WHERE date >= $1 AND date <= $2
      AND price < 0
      AND (parent_category IS NULL OR category = 'N/A')
      GROUP BY name
      ORDER BY total_amount DESC
      LIMIT 30`,
      [startStr, endStr]
    );

    // 6. Category distribution (for pie charts)
    const categoryDistribution = await client.query(
      `SELECT
        parent_category,
        SUM(ABS(price)) as total_amount,
        COUNT(*) as transaction_count
      FROM transactions
      WHERE date >= $1 AND date <= $2
      AND price < 0
      AND parent_category IS NOT NULL
      AND parent_category NOT IN ('Bank', 'Income')
      GROUP BY parent_category
      ORDER BY total_amount DESC`,
      [startStr, endStr]
    );

    // 7. Income vs Expenses summary
    const activeDaysExpr = `COUNT(DISTINCT ${dialect.dateTrunc('day', 'date')})`;
    const summary = await client.query(
      `SELECT
        SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as total_income,
        SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as total_expenses,
        COUNT(DISTINCT vendor) as total_accounts,
        ${activeDaysExpr} as active_days
      FROM transactions
      WHERE date >= $1 AND date <= $2`,
      [startStr, endStr]
    );

    const summaryData = summary.rows[0];
    const totalIncome = parseFloat(summaryData.total_income || 0);
    const totalExpenses = parseFloat(summaryData.total_expenses || 0);
    const netBalance = totalIncome - totalExpenses;

    // 8. Calculate insights
    const insights = [];

    // Check categorization health
    const autoStats = autoCategoryStats.rows[0];
    const totalTransactions = parseInt(autoStats.total_transactions || 0, 10);
    const autoCategorizedCount = parseInt(autoStats.auto_categorized_count || 0, 10);
    const manualCount = parseInt(autoStats.manual_count || 0, 10);
    const avgConfidence = parseFloat(autoStats.avg_confidence || 0);
    const autoCategoryPercentage = totalTransactions > 0
      ? (autoCategorizedCount / totalTransactions) * 100
      : 0;

    if (totalTransactions > 0 && autoCategoryPercentage < 70) {
      insights.push({
        type: 'warning',
        title: 'Low Auto-Categorization',
        message: `Only ${autoCategoryPercentage.toFixed(1)}% of transactions are auto-categorized. Consider adding more merchant patterns.`,
        action: 'review_uncategorized'
      });
    }

    // Check uncategorized transactions
    const uncategorizedCount = uncategorized.rows.length;
    if (uncategorizedCount > 10) {
      insights.push({
        type: 'info',
        title: 'Uncategorized Transactions',
        message: `${uncategorizedCount} unique transaction names need categorization.`,
        action: 'categorize_transactions'
      });
    }

    // Find top spending category
    if (categoryDistribution.rows.length > 0) {
      const topCategory = categoryDistribution.rows[0];
      const categoryPercentage = (topCategory.total_amount / totalExpenses) * 100;
      insights.push({
        type: 'info',
        title: 'Top Spending Category',
        message: `${topCategory.parent_category} accounts for ${categoryPercentage.toFixed(1)}% of your expenses (₪${Math.round(topCategory.total_amount).toLocaleString()})`,
        action: 'view_category_details'
      });
    }

    // Savings rate
    if (totalIncome > 0) {
      const savingsRate = ((netBalance / totalIncome) * 100).toFixed(1);
      insights.push({
        type: savingsRate > 20 ? 'success' : 'warning',
        title: 'Savings Rate',
        message: `You're saving ${savingsRate}% of your income. ${savingsRate < 20 ? 'Consider reducing expenses to save more.' : 'Great job!'}`,
        action: null
      });
    }

    // Response
    res.status(200).json({
      dateRange: { start, end },
      summary: {
        totalIncome,
        totalExpenses,
        netBalance,
        savingsRate: totalIncome > 0 ? ((netBalance / totalIncome) * 100).toFixed(1) : 0,
        totalAccounts: parseInt(summaryData.total_accounts || 0),
        activeDays: parseInt(summaryData.active_days || 0),
        autoCategoryStats: {
          autoCategorized: autoCategorizedCount,
          manual: manualCount,
          percentage: autoCategoryPercentage.toFixed(1),
          avgConfidence: avgConfidence.toFixed(2)
        }
      },
      breakdowns: {
        hierarchical: hierarchicalBreakdown.rows.map(row => ({
          parentCategory: row.parent_category,
          subcategory: row.subcategory,
          transactionCount: parseInt(row.transaction_count),
          totalAmount: parseFloat(row.total_amount),
          avgAmount: parseFloat(row.avg_amount),
          minAmount: parseFloat(row.min_amount),
          maxAmount: parseFloat(row.max_amount)
        })),
        byCategory: categoryDistribution.rows.map(row => ({
          category: row.parent_category,
          total: parseFloat(row.total_amount),
          count: parseInt(row.transaction_count),
          percentage: ((parseFloat(row.total_amount) / totalExpenses) * 100).toFixed(1)
        })),
        byMerchant: topMerchants.rows.map(row => ({
          merchant: row.merchant_name,
          category: row.parent_category,
          subcategory: row.subcategory,
          count: parseInt(row.transaction_count),
          total: parseFloat(row.total_spent)
        })),
        monthlyTrends: monthlyTrends.rows.map(row => ({
          month: row.month,
          category: row.parent_category,
          amount: parseFloat(row.amount)
        }))
      },
      uncategorized: uncategorized.rows.map(row => ({
        name: row.name,
        occurrences: parseInt(row.occurrences),
        totalAmount: parseFloat(row.total_amount)
      })),
      insights
    });

  } catch (error) {
    console.error('Error fetching enhanced dashboard analytics:', error);
    res.status(500).json({
      error: 'Failed to fetch enhanced dashboard analytics',
      details: error.message
    });
  } finally {
    client.release();
  }
}
