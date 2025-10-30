import { getDB } from '../db.js';
import { subMonths } from 'date-fns';
import { dialect } from '../../../lib/sql-dialect.js';
import { BANK_CATEGORY_NAME } from '../../../lib/category-constants.js';

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
        COALESCE(parent.name, cd.name) AS parent_category,
        CASE WHEN parent.id IS NOT NULL THEN cd.name ELSE NULL END AS subcategory,
        COUNT(*) AS transaction_count,
        SUM(ABS(t.price)) AS total_amount,
        AVG(ABS(t.price)) AS avg_amount,
        MIN(ABS(t.price)) AS min_amount,
        MAX(ABS(t.price)) AS max_amount
      FROM transactions t
      JOIN category_definitions cd ON cd.id = t.category_definition_id
      LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
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
        AND cd.category_type = 'expense'
        AND cd.name != $3
        AND ap.id IS NULL
      GROUP BY parent.id, parent.name, cd.id, cd.name
      ORDER BY total_amount DESC`,
      [startStr, endStr, BANK_CATEGORY_NAME]
    );

    // 2. Get auto-categorization statistics
    const autoCategoryStats = await client.query(
      `SELECT
        SUM(CASE WHEN t.auto_categorized = true THEN 1 ELSE 0 END) AS auto_categorized_count,
        SUM(CASE WHEN t.auto_categorized = false OR t.auto_categorized IS NULL THEN 1 ELSE 0 END) AS manual_count,
        AVG(CASE WHEN t.auto_categorized = true THEN t.confidence_score ELSE NULL END) AS avg_confidence,
        COUNT(*) AS total_transactions
      FROM transactions t
      JOIN category_definitions cd ON cd.id = t.category_definition_id
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
        AND cd.category_type = 'expense'
        AND cd.name != $3
        AND ap.id IS NULL`,
      [startStr, endStr, BANK_CATEGORY_NAME]
    );

    // 3. Top merchants by spending
    const topMerchants = await client.query(
      `SELECT
        t.merchant_name,
        COALESCE(parent.name, cd.name) AS parent_category,
        CASE WHEN parent.id IS NOT NULL THEN cd.name ELSE NULL END AS subcategory,
        COUNT(*) AS transaction_count,
        SUM(ABS(t.price)) AS total_spent
      FROM transactions t
      JOIN category_definitions cd ON cd.id = t.category_definition_id
      LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
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
        AND t.merchant_name IS NOT NULL
        AND cd.category_type = 'expense'
        AND cd.name != $3
        AND ap.id IS NULL
      GROUP BY t.merchant_name, parent.id, parent.name, cd.id, cd.name
      ORDER BY total_spent DESC
      LIMIT 20`,
      [startStr, endStr, BANK_CATEGORY_NAME]
    );

    // 4. Monthly trends by category
    const monthExpr = dialect.toChar('t.date', 'YYYY-MM');
    const monthlyTrends = await client.query(
      `SELECT
        ${monthExpr} AS month,
        COALESCE(parent.name, cd.name) AS parent_category,
        SUM(ABS(t.price)) AS amount
      FROM transactions t
      JOIN category_definitions cd ON cd.id = t.category_definition_id
      LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
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
        AND cd.category_type = 'expense'
        AND cd.name != $3
        AND ap.id IS NULL
      GROUP BY ${monthExpr}, parent.id, parent.name, cd.id, cd.name
      ORDER BY month ASC, amount DESC`,
      [startStr, endStr, BANK_CATEGORY_NAME]
    );

    // 5. Uncategorized transactions that need attention
    const uncategorized = await client.query(
      `SELECT
        t.name,
        COUNT(*) AS occurrences,
        SUM(ABS(t.price)) AS total_amount
      FROM transactions t
      WHERE t.date >= $1 AND t.date <= $2
        AND t.price < 0
        AND t.category_definition_id IS NULL
      GROUP BY t.name
      ORDER BY total_amount DESC
      LIMIT 30`,
      [startStr, endStr]
    );

    // 6. Category distribution (for pie charts)
    const categoryDistribution = await client.query(
      `SELECT
        COALESCE(parent.name, cd.name) AS parent_category,
        SUM(ABS(t.price)) AS total_amount,
        COUNT(*) AS transaction_count
      FROM transactions t
      JOIN category_definitions cd ON cd.id = t.category_definition_id
      LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
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
        AND cd.category_type = 'expense'
        AND cd.name != $3
        AND ap.id IS NULL
      GROUP BY parent.id, parent.name, cd.id, cd.name
      ORDER BY total_amount DESC`,
      [startStr, endStr, BANK_CATEGORY_NAME]
    );

    // 7. Income vs Expenses summary
    const activeDaysExpr = `COUNT(DISTINCT ${dialect.dateTrunc('day', 'date')})`;
    const summary = await client.query(
      `SELECT
        SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as total_income,
        SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as total_expenses,
        COUNT(DISTINCT vendor) as total_accounts,
        ${activeDaysExpr} as active_days
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
      WHERE date >= $1 AND date <= $2
        AND ap.id IS NULL`,
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
