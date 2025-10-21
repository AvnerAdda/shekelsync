import { getDB } from '../db.js';
import { subMonths } from 'date-fns';
import { dialect } from '../../../lib/sql-dialect.js';

/**
 * Smart budget recommendations based on historical spending patterns
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { months_history = 6, buffer_percentage = 10 } = req.query;

    const recommendations = await generateBudgetRecommendations(
      client,
      parseInt(months_history),
      parseFloat(buffer_percentage)
    );

    return res.status(200).json(recommendations);

  } catch (error) {
    console.error('Error generating budget recommendations:', error);
    return res.status(500).json({
      error: 'Failed to generate budget recommendations',
      details: error.message
    });
  } finally {
    client.release();
  }
}

async function fetchCategoryMonthlyTotals(client, startDateStr) {
  if (!dialect.useSqlite) {
    return [];
  }

  const result = await client.query(
    `
      SELECT
        parent_category,
        subcategory,
        strftime('%Y-%m-01', date) AS month,
        SUM(ABS(price)) AS monthly_total
      FROM transactions
      WHERE date >= $1
        AND price < 0
        AND parent_category IS NOT NULL
        AND parent_category NOT IN ('Bank', 'Income')
      GROUP BY parent_category, subcategory, month
    `,
    [startDateStr]
  );

  return result.rows.map(row => ({
    parent_category: row.parent_category,
    subcategory: row.subcategory,
    month: row.month,
    monthly_total: parseFloat(row.monthly_total),
  }));
}

async function fetchCategoryAggregatesPostgres(client, startDateStr) {
  const result = await client.query(
    `WITH monthly_spending AS (
      SELECT
        parent_category,
        subcategory,
        DATE_TRUNC('month', date) AS month,
        SUM(ABS(price)) AS monthly_total
      FROM transactions
      WHERE date >= $1::date
        AND price < 0
        AND parent_category IS NOT NULL
        AND parent_category NOT IN ('Bank', 'Income')
      GROUP BY parent_category, subcategory, DATE_TRUNC('month', date)
    )
    SELECT
      parent_category,
      subcategory,
      COUNT(DISTINCT month) AS months_with_data,
      AVG(monthly_total) AS avg_monthly,
      STDDEV(monthly_total) AS std_dev,
      MIN(monthly_total) AS min_monthly,
      MAX(monthly_total) AS max_monthly,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY monthly_total) AS median_monthly,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY monthly_total) AS p75_monthly
    FROM monthly_spending
    GROUP BY parent_category, subcategory
    HAVING COUNT(DISTINCT month) >= 3
    ORDER BY avg_monthly DESC`,
    [startDateStr]
  );

  return result.rows.map(row => ({
    parent_category: row.parent_category,
    subcategory: row.subcategory,
    months_with_data: parseInt(row.months_with_data),
    avg_monthly: parseFloat(row.avg_monthly),
    std_dev: parseFloat(row.std_dev || 0),
    min_monthly: parseFloat(row.min_monthly),
    max_monthly: parseFloat(row.max_monthly),
    median_monthly: parseFloat(row.median_monthly),
    p75_monthly: parseFloat(row.p75_monthly),
  }));
}

function computeCategoryStats(rows) {
  const groups = new Map();

  rows.forEach(row => {
    const key = `${row.parent_category || ''}::${row.subcategory || ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        parent_category: row.parent_category,
        subcategory: row.subcategory,
        totalsByMonth: new Map(),
      });
    }
    const group = groups.get(key);
    group.totalsByMonth.set(row.month, row.monthly_total);
  });

  const results = [];

  for (const group of groups.values()) {
    const monthlyTotals = Array.from(group.totalsByMonth.values());
    if (monthlyTotals.length < 3) continue;

    const stats = calculateStats(monthlyTotals);
    results.push({
      parent_category: group.parent_category,
      subcategory: group.subcategory,
      months_with_data: monthlyTotals.length,
      avg_monthly: stats.average,
      std_dev: stats.stdDev,
      min_monthly: stats.min,
      max_monthly: stats.max,
      median_monthly: stats.percentile50,
      p75_monthly: stats.percentile75,
    });
  }

  return results.sort((a, b) => b.avg_monthly - a.avg_monthly);
}

function calculateStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const average = sum / count;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  const variance =
    count > 1
      ? sorted.reduce((acc, val) => acc + Math.pow(val - average, 2), 0) / (count - 1)
      : 0;
  const stdDev = Math.sqrt(variance);

  const percentile = (p) => {
    if (count === 0) return 0;
    const index = (count - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  };

  return {
    average,
    min,
    max,
    stdDev,
    percentile50: percentile(0.5),
    percentile75: percentile(0.75),
  };
}

async function generateBudgetRecommendations(client, monthsHistory, bufferPercentage) {
  try {
    const startDate = subMonths(new Date(), monthsHistory);
    const startDateStr = startDate.toISOString().split('T')[0];

    const categoryData = await fetchCategoryMonthlyTotals(client, startDateStr);
    const categoryAverages = dialect.useSqlite
      ? computeCategoryStats(categoryData)
      : await fetchCategoryAggregatesPostgres(client, startDateStr);

    // 2. Get existing budgets to compare
    const existingBudgets = await client.query(
      `SELECT category, period_type, budget_limit
       FROM category_budgets
       WHERE is_active = true AND period_type = 'monthly'`
    );

    const existingBudgetsMap = {};
    existingBudgets.rows.forEach(budget => {
      existingBudgetsMap[budget.category] = parseFloat(budget.budget_limit);
    });

    // 3. Generate recommendations
    const recommendations = [];

    for (const row of categoryAverages) {
      const category = row.subcategory || row.parent_category;
      const avgMonthly = parseFloat(row.avg_monthly);
      const stdDev = parseFloat(row.std_dev || 0);
      const median = parseFloat(row.median_monthly);
      const p75 = parseFloat(row.p75_monthly);

      // Use 75th percentile + buffer as recommended budget (more conservative than average + buffer)
      const recommendedBudget = Math.round(p75 * (1 + bufferPercentage / 100));

      // Alternative: Average + std dev + buffer (for high variability categories)
      const alternativeBudget = Math.round((avgMonthly + stdDev) * (1 + bufferPercentage / 100));

      // Determine confidence based on data consistency
      const coefficientOfVariation = stdDev / avgMonthly;
      let confidence = 'high';
      if (coefficientOfVariation > 0.5) confidence = 'medium';
      if (coefficientOfVariation > 0.8 || row.months_with_data < 4) confidence = 'low';

      const recommendation = {
        category,
        parent_category: row.parent_category,
        subcategory: row.subcategory,
        recommended_monthly_budget: recommendedBudget,
        alternative_budget: alternativeBudget,
        historical_data: {
          months_analyzed: parseInt(row.months_with_data),
          avg_monthly: Math.round(avgMonthly),
          median_monthly: Math.round(median),
          min_monthly: Math.round(parseFloat(row.min_monthly)),
          max_monthly: Math.round(parseFloat(row.max_monthly)),
          std_deviation: Math.round(stdDev),
          variability: coefficientOfVariation.toFixed(2)
        },
        confidence,
        existing_budget: existingBudgetsMap[category] || null,
        status: null,
        savings_opportunity: null
      };

      // Compare with existing budget
      if (existingBudgetsMap[category]) {
        const existing = existingBudgetsMap[category];
        const difference = existing - recommendedBudget;
        const percentDiff = ((difference / recommendedBudget) * 100).toFixed(1);

        if (difference > recommendedBudget * 0.2) {
          recommendation.status = 'too_high';
          recommendation.savings_opportunity = Math.round(Math.abs(difference));
          recommendation.message = `Your current budget is ${percentDiff}% higher than recommended. Consider reducing it by ₪${Math.round(difference)} to save more.`;
        } else if (difference < -recommendedBudget * 0.1) {
          recommendation.status = 'too_low';
          recommendation.message = `Your current budget is ${Math.abs(percentDiff)}% lower than your typical spending. Consider increasing it to avoid overspending alerts.`;
        } else {
          recommendation.status = 'optimal';
          recommendation.message = `Your current budget is well-aligned with your spending patterns.`;
        }
      } else {
        recommendation.status = 'no_budget';
        recommendation.message = `Consider setting a monthly budget of ₪${recommendedBudget} for this category.`;
      }

      recommendations.push(recommendation);
    }

    // 4. Calculate total recommended budget and savings potential
    const totalRecommendedBudget = recommendations.reduce(
      (sum, rec) => sum + rec.recommended_monthly_budget,
      0
    );

    const totalCurrentBudget = recommendations.reduce(
      (sum, rec) => sum + (rec.existing_budget || 0),
      0
    );

    const totalPotentialSavings = recommendations
      .filter(rec => rec.savings_opportunity)
      .reduce((sum, rec) => sum + rec.savings_opportunity, 0);

    // 5. Add overall insights
    const insights = [];

    if (totalPotentialSavings > 0) {
      insights.push({
        type: 'savings',
        title: 'Potential Savings Identified',
        message: `You could save up to ₪${totalPotentialSavings} per month by optimizing your budgets.`,
        priority: 'high'
      });
    }

    const lowConfidenceCategories = recommendations.filter(r => r.confidence === 'low');
    if (lowConfidenceCategories.length > 0) {
      insights.push({
        type: 'warning',
        title: 'Inconsistent Spending Patterns',
        message: `${lowConfidenceCategories.length} categories have high spending variability. Review these regularly.`,
        categories: lowConfidenceCategories.map(r => r.category),
        priority: 'medium'
      });
    }

    const noBudgetCategories = recommendations.filter(r => r.status === 'no_budget');
    if (noBudgetCategories.length > 0) {
      insights.push({
        type: 'info',
        title: 'Missing Budgets',
        message: `${noBudgetCategories.length} categories don't have budgets set. Consider adding them for better tracking.`,
        priority: 'low'
      });
    }

    return {
      summary: {
        categories_analyzed: recommendations.length,
        total_recommended_monthly_budget: totalRecommendedBudget,
        total_current_budget: totalCurrentBudget,
        potential_monthly_savings: totalPotentialSavings,
        analysis_period_months: monthsHistory,
        buffer_percentage: bufferPercentage
      },
      recommendations: recommendations.sort((a, b) =>
        b.recommended_monthly_budget - a.recommended_monthly_budget
      ),
      insights
    };

  } catch (error) {
    console.error('Error in generateBudgetRecommendations:', error);
    throw error;
  }
}
