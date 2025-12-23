/**
 * Category Variability Service
 *
 * Analyzes spending patterns to determine category variability:
 * - Fixed: Low variance (rent, insurance, subscriptions)
 * - Variable: High variance (groceries, entertainment, fuel)
 * - Seasonal: Periodic patterns (holidays, travel)
 *
 * Uses coefficient of variation (CV = std_dev / mean) for classification:
 * - CV < 0.15: Fixed
 * - CV 0.15-0.4: Variable
 * - CV > 0.4: Highly variable or seasonal
 */

const actualDatabase = require('../database.js');
const { resolveDateRange } = require('../../../lib/server/query-utils.js');

let database = actualDatabase;

// Thresholds for variability classification
const FIXED_CV_THRESHOLD = 0.15;
const VARIABLE_CV_THRESHOLD = 0.4;

/**
 * Calculate coefficient of variation and classify variability type
 */
function classifyVariability(monthlyAmounts) {
  if (!monthlyAmounts || monthlyAmounts.length < 3) {
    return {
      variabilityType: 'variable',
      coefficientOfVariation: null,
      confidence: 0,
    };
  }

  const n = monthlyAmounts.length;
  const mean = monthlyAmounts.reduce((sum, val) => sum + val, 0) / n;

  if (mean === 0) {
    return {
      variabilityType: 'variable',
      coefficientOfVariation: null,
      confidence: 0,
    };
  }

  // Use sample variance (n-1) instead of population variance (n)
  const variance = n > 1
    ? monthlyAmounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (n - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = stdDev / mean;

  // Classify based on CV
  let variabilityType;
  if (coefficientOfVariation < FIXED_CV_THRESHOLD) {
    variabilityType = 'fixed';
  } else if (coefficientOfVariation < VARIABLE_CV_THRESHOLD) {
    variabilityType = 'variable';
  } else {
    // Check for seasonal patterns (high CV might indicate seasonal)
    const hasPeaks = detectSeasonalPeaks(monthlyAmounts);
    variabilityType = hasPeaks ? 'seasonal' : 'variable';
  }

  // Confidence based on data points
  const confidence = Math.min(1.0, n / 6); // Full confidence with 6+ months

  return {
    variabilityType,
    coefficientOfVariation,
    mean,
    stdDev,
    confidence,
  };
}

/**
 * Detect seasonal peaks in monthly data
 * Returns true if there are clear peaks (outliers) suggesting seasonality
 */
function detectSeasonalPeaks(monthlyAmounts) {
  if (monthlyAmounts.length < 4) return false;

  const mean = monthlyAmounts.reduce((sum, val) => sum + val, 0) / monthlyAmounts.length;
  const variance = monthlyAmounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / monthlyAmounts.length;
  const stdDev = Math.sqrt(variance);

  // Count values that are > 2σ above mean (potential seasonal peaks)
  const peaks = monthlyAmounts.filter(val => val > mean + (2 * stdDev)).length;

  // Require minimum 2 peaks and at least 25% of months to be classified as seasonal
  // This prevents single outliers from being classified as seasonal patterns
  return peaks >= Math.max(2, Math.ceil(monthlyAmounts.length * 0.25));
}

/**
 * Analyze variability for all expense categories
 */
async function analyzeCategoryVariability(params = {}) {
  const { months = 6 } = params;

  if (months < 3 || months > 12) {
    throw new Error('months must be between 3 and 12');
  }

  const client = await database.getClient();

  try {
    // Get all expense categories
    const categoriesResult = await client.query(`
      SELECT id, name, name_en, category_type
      FROM category_definitions
      WHERE category_type = 'expense' AND is_active = 1
    `);

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const analyses = [];

    for (const category of categoriesResult.rows) {
      // Get monthly spending for this category
      const monthlyResult = await client.query(`
        SELECT
          strftime('%Y-%m', t.date) as month,
          SUM(ABS(t.price)) as total,
          COUNT(*) as count
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
        WHERE t.category_definition_id = $1
          AND t.date >= $2
          AND t.price < 0
          AND ap.id IS NULL
        GROUP BY month
        ORDER BY month ASC
      `, [category.id, startDate.toISOString().split('T')[0]]);

      const monthlyAmounts = monthlyResult.rows.map(row => parseFloat(row.total || 0));

      if (monthlyAmounts.length < 2) {
        // Not enough data
        continue;
      }

      const variability = classifyVariability(monthlyAmounts);

      // Get month-over-month changes
      const momChanges = [];
      for (let i = 1; i < monthlyAmounts.length; i++) {
        const prev = monthlyAmounts[i - 1];
        const curr = monthlyAmounts[i];
        if (prev > 0) {
          const percentChange = ((curr - prev) / prev) * 100;
          momChanges.push({
            month: monthlyResult.rows[i].month,
            amount: curr,
            change: percentChange,
          });
        }
      }

      // Calculate latest month vs average
      const avgAmount = variability.mean || 0;
      const latestAmount = monthlyAmounts[monthlyAmounts.length - 1];
      const latestVsAvg = avgAmount > 0 ? ((latestAmount - avgAmount) / avgAmount) * 100 : 0;

      analyses.push({
        category_id: category.id,
        category_name: category.name,
        category_name_en: category.name_en,
        variability_type: variability.variabilityType,
        coefficient_of_variation: variability.coefficientOfVariation,
        avg_monthly: variability.mean || 0,
        std_dev: variability.stdDev || 0,
        min_monthly: Math.min(...monthlyAmounts),
        max_monthly: Math.max(...monthlyAmounts),
        latest_month: latestAmount,
        latest_vs_avg_percent: Math.round(latestVsAvg),
        confidence: variability.confidence,
        months_analyzed: monthlyAmounts.length,
        monthly_breakdown: monthlyResult.rows.map(row => ({
          month: row.month,
          amount: parseFloat(row.total || 0),
          transaction_count: parseInt(row.count || 0, 10),
        })),
        mom_changes: momChanges,
      });
    }

    // Sort by variability type and then by average spending
    analyses.sort((a, b) => {
      const typeOrder = { fixed: 0, variable: 1, seasonal: 2 };
      if (typeOrder[a.variability_type] !== typeOrder[b.variability_type]) {
        return typeOrder[a.variability_type] - typeOrder[b.variability_type];
      }
      return b.avg_monthly - a.avg_monthly;
    });

    const summary = {
      total_categories: analyses.length,
      by_type: {
        fixed: analyses.filter(a => a.variability_type === 'fixed').length,
        variable: analyses.filter(a => a.variability_type === 'variable').length,
        seasonal: analyses.filter(a => a.variability_type === 'seasonal').length,
      },
      analyzed_months: months,
    };

    return { analyses, summary };
  } finally {
    client.release();
  }
}

/**
 * Update category variability type in spending_category_mappings
 * Can be used to override auto-detection
 */
async function updateCategoryVariability(categoryDefinitionId, variabilityType) {
  if (!['fixed', 'variable', 'seasonal'].includes(variabilityType)) {
    throw new Error('Invalid variability type. Must be: fixed, variable, or seasonal');
  }

  const client = await database.getClient();

  try {
    // Check if mapping exists
    const existingResult = await client.query(`
      SELECT id FROM spending_category_mappings WHERE category_definition_id = $1
    `, [categoryDefinitionId]);

    if (existingResult.rows.length === 0) {
      throw new Error('Spending category mapping not found. Please initialize spending categories first.');
    }

    // Update variability type
    const result = await client.query(`
      UPDATE spending_category_mappings
      SET
        variability_type = $1,
        user_overridden = 1,
        updated_at = datetime('now')
      WHERE category_definition_id = $2
      RETURNING *
    `, [variabilityType, categoryDefinitionId]);

    return { mapping: result.rows[0] };
  } finally {
    client.release();
  }
}

/**
 * Get category variability insights
 * Highlights categories with significant changes or anomalies
 */
async function getCategoryVariabilityInsights(params = {}) {
  const { months = 6 } = params;

  const { analyses } = await analyzeCategoryVariability({ months });

  const insights = [];

  for (const analysis of analyses) {
    // Fixed category with high variation
    if (analysis.variability_type === 'fixed' && analysis.coefficient_of_variation > 0.1) {
      insights.push({
        type: 'fixed_with_variation',
        severity: 'medium',
        category_id: analysis.category_id,
        category_name: analysis.category_name,
        message: `${analysis.category_name} is classified as fixed but shows ${Math.round(analysis.coefficient_of_variation * 100)}% variation.`,
        data: {
          cv: analysis.coefficient_of_variation,
          avg: analysis.avg_monthly,
        },
      });
    }

    // Large month-over-month change
    const latestChange = analysis.mom_changes[analysis.mom_changes.length - 1];
    if (latestChange && Math.abs(latestChange.change) > 30) {
      insights.push({
        type: 'large_mom_change',
        severity: Math.abs(latestChange.change) > 50 ? 'high' : 'medium',
        category_id: analysis.category_id,
        category_name: analysis.category_name,
        message: `${analysis.category_name} changed by ${Math.round(latestChange.change)}% from last month.`,
        data: {
          change_percent: latestChange.change,
          current_amount: latestChange.amount,
          month: latestChange.month,
        },
      });
    }

    // Seasonal pattern detected
    if (analysis.variability_type === 'seasonal') {
      insights.push({
        type: 'seasonal_pattern',
        severity: 'low',
        category_id: analysis.category_id,
        category_name: analysis.category_name,
        message: `${analysis.category_name} shows seasonal spending patterns.`,
        data: {
          cv: analysis.coefficient_of_variation,
          avg: analysis.avg_monthly,
          max: analysis.max_monthly,
        },
      });
    }
  }

  // Sort by severity
  const severityOrder = { high: 0, medium: 1, low: 2 };
  insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return { insights };
}

module.exports = {
  analyzeCategoryVariability,
  updateCategoryVariability,
  getCategoryVariabilityInsights,
  classifyVariability, // Export for testing
  detectSeasonalPeaks, // Export for testing
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
