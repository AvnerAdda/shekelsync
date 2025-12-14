/**
 * Budget Intelligence Service
 *
 * Auto-suggests budgets based on historical spending patterns:
 * - Analyzes 3-6 months of historical data
 * - Calculates confidence scores based on variability
 * - Provides budget trajectory forecasting
 * - Tracks budget health and generates alerts
 */

const actualDatabase = require('../database.js');
const { resolveDateRange } = require('../../../lib/server/query-utils.js');
const { resolveLocale, getLocalizedCategoryName } = require('../../../lib/server/locale-utils.js');

let database = actualDatabase;

async function fetchBudgetSuggestions(client, params = {}) {
  const {
    minConfidence = 0.5,
    periodType = 'monthly',
    includeActive = true,
    locale,
  } = params;
  const resolvedLocale = resolveLocale(locale);

  let query = `
      SELECT
        bs.*,
        cd.name as category_name,
        cd.name_en as category_name_en,
        cd.name_fr as category_name_fr,
        parent.name as parent_category_name,
        parent.name_en as parent_category_name_en,
        parent.name_fr as parent_category_name_fr,
        cb.id as active_budget_id,
        cb.budget_limit as active_budget_limit
      FROM budget_suggestions bs
      JOIN category_definitions cd ON bs.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      LEFT JOIN category_budgets cb ON (
        cd.id = cb.category_definition_id
        AND cb.is_active = 1
        AND cb.period_type = bs.period_type
      )
      WHERE bs.confidence_score >= $1
        AND bs.period_type = $2
    `;

  const values = [minConfidence, periodType];

  if (!includeActive) {
    query += ' AND cb.id IS NULL';
  }

  query += ' ORDER BY bs.confidence_score DESC, bs.suggested_limit DESC';

  const result = await client.query(query, values);

  return result.rows.map((row) => ({
    ...row,
    category_name: getLocalizedCategoryName({
      name: row.category_name,
      name_en: row.category_name_en,
      name_fr: row.category_name_fr,
    }, resolvedLocale) || row.category_name,
    category_name_he: row.category_name,
    category_name_en: row.category_name_en,
    category_name_fr: row.category_name_fr,
    parent_category_name: row.parent_category_name
      ? getLocalizedCategoryName({
          name: row.parent_category_name,
          name_en: row.parent_category_name_en,
          name_fr: row.parent_category_name_fr,
        }, resolvedLocale) || row.parent_category_name
      : null,
    parent_category_name_he: row.parent_category_name,
    parent_category_name_en: row.parent_category_name_en,
    parent_category_name_fr: row.parent_category_name_fr,
    historical_data: row.historical_data ? JSON.parse(row.historical_data) : null,
    calculation_metadata: row.calculation_metadata ? JSON.parse(row.calculation_metadata) : null,
    has_active_budget: row.active_budget_id !== null,
  }));
}

async function ensureBaselineBudgets(options = {}) {
  const {
    months = 6,
    minConfidence = 0.6,
    maxBudgets = 4,
    periodType = 'monthly',
  } = options;

  const client = await database.getClient();

  try {
    const result = await client.query(
      'SELECT COUNT(1) AS count FROM category_budgets WHERE is_active = 1 AND period_type = $1',
      [periodType],
    );
    const activeBudgets = parseInt(result.rows[0]?.count || '0', 10);
    if (activeBudgets > 0) {
      return { activated: 0 };
    }
  } finally {
    client.release();
  }

  // Generate suggestions so we have fresh data to auto-activate
  await generateBudgetSuggestions({ months, periodType });

  const suggestionsClient = await database.getClient();
  try {
    const fetchFn = module.exports.fetchBudgetSuggestions || fetchBudgetSuggestions;
    const suggestions = await fetchFn(suggestionsClient, {
      minConfidence,
      periodType,
      includeActive: true,
    });

    const candidates = suggestions
      .filter((suggestion) => !suggestion.has_active_budget)
      .slice(0, maxBudgets);

    let activated = 0;
    for (const suggestion of candidates) {
      const activateFn = module.exports.activateBudgetSuggestion || activateBudgetSuggestion;
      await activateFn(suggestion.id);
      activated += 1;
    }

    return { activated };
  } finally {
    suggestionsClient.release();
  }
}

/**
 * Calculate statistics for budget suggestion
 */
function calculateBudgetStats(monthlyAmounts) {
  if (!monthlyAmounts || monthlyAmounts.length === 0) {
    return null;
  }

  const n = monthlyAmounts.length;
  const mean = monthlyAmounts.reduce((sum, val) => sum + val, 0) / n;

  if (mean === 0) return null;

  const variance = monthlyAmounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = stdDev / mean;

  // Confidence score: lower variability = higher confidence
  // CV < 0.2 = very consistent (0.9-1.0)
  // CV 0.2-0.4 = moderate (0.7-0.9)
  // CV > 0.4 = variable (0.5-0.7)
  let confidence;
  if (coefficientOfVariation < 0.2) {
    confidence = 1.0 - (coefficientOfVariation / 0.2) * 0.1; // 0.9-1.0
  } else if (coefficientOfVariation < 0.4) {
    confidence = 0.9 - ((coefficientOfVariation - 0.2) / 0.2) * 0.2; // 0.7-0.9
  } else {
    confidence = Math.max(0.5, 0.7 - ((coefficientOfVariation - 0.4) / 0.6) * 0.2); // 0.5-0.7
  }

  const min = Math.min(...monthlyAmounts);
  const max = Math.max(...monthlyAmounts);
  const median = monthlyAmounts.sort((a, b) => a - b)[Math.floor(n / 2)];

  // Suggested budget: mean + 10% buffer for variability
  const suggestedLimit = mean * 1.1;

  return {
    mean,
    median,
    min,
    max,
    stdDev,
    coefficientOfVariation,
    confidence,
    suggestedLimit,
    basedOnMonths: n,
  };
}

/**
 * Generate budget suggestions for all expense categories
 */
async function generateBudgetSuggestions(params = {}) {
  const { months = 6, periodType = 'monthly' } = params;

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

    const suggestions = [];
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    for (const category of categoriesResult.rows) {
      // Get monthly spending for this category
      const monthlyResult = await client.query(`
        SELECT
          strftime('%Y-%m', t.date) as month,
          SUM(ABS(t.price)) as total
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
        // Not enough data to suggest budget
        continue;
      }

      const stats = calculateBudgetStats(monthlyAmounts);

      if (!stats || stats.suggestedLimit === 0) {
        continue;
      }

      // Check if suggestion already exists
      const existingResult = await client.query(`
        SELECT id FROM budget_suggestions
        WHERE category_definition_id = $1 AND period_type = $2
      `, [category.id, periodType]);

      const historicalData = JSON.stringify({
        monthly_amounts: monthlyAmounts,
        months: monthlyResult.rows.map(row => row.month),
      });

      const calculationMetadata = JSON.stringify({
        mean: stats.mean,
        median: stats.median,
        min: stats.min,
        max: stats.max,
        std_dev: stats.stdDev,
        coefficient_of_variation: stats.coefficientOfVariation,
      });

      if (existingResult.rows.length > 0) {
        // Update existing suggestion
        await client.query(`
          UPDATE budget_suggestions
          SET
            suggested_limit = $1,
            confidence_score = $2,
            variability_coefficient = $3,
            based_on_months = $4,
            historical_data = $5,
            calculation_metadata = $6,
            updated_at = datetime('now')
          WHERE category_definition_id = $7 AND period_type = $8
        `, [
          stats.suggestedLimit,
          stats.confidence,
          stats.coefficientOfVariation,
          stats.basedOnMonths,
          historicalData,
          calculationMetadata,
          category.id,
          periodType,
        ]);
      } else {
        // Create new suggestion
        await client.query(`
          INSERT INTO budget_suggestions (
            category_definition_id,
            period_type,
            suggested_limit,
            confidence_score,
            variability_coefficient,
            based_on_months,
            historical_data,
            calculation_metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          category.id,
          periodType,
          stats.suggestedLimit,
          stats.confidence,
          stats.coefficientOfVariation,
          stats.basedOnMonths,
          historicalData,
          calculationMetadata,
        ]);
      }

      suggestions.push({
        category_id: category.id,
        category_name: category.name,
        suggested_limit: stats.suggestedLimit,
        confidence: stats.confidence,
        based_on_months: stats.basedOnMonths,
      });
    }

    return {
      success: true,
      total_suggestions: suggestions.length,
      suggestions,
    };
  } finally {
    client.release();
  }
}

/**
 * Get budget suggestions
 */
async function getBudgetSuggestions(params = {}) {
  const { minConfidence = 0.5, periodType = 'monthly', includeActive = true, locale } = params;

  const client = await database.getClient();

  try {
    const suggestions = await fetchBudgetSuggestions(client, { minConfidence, periodType, includeActive, locale });
    return { suggestions };
  } finally {
    client.release();
  }
}

/**
 * Activate a budget suggestion
 */
async function activateBudgetSuggestion(suggestionId) {
  const client = await database.getClient();

  try {
    // Get suggestion details
    const suggestionResult = await client.query(`
      SELECT * FROM budget_suggestions WHERE id = $1
    `, [suggestionId]);

    if (suggestionResult.rows.length === 0) {
      throw new Error('Budget suggestion not found');
    }

    const suggestion = suggestionResult.rows[0];

    // Check if budget already exists for this category
    const existingResult = await client.query(`
      SELECT id FROM category_budgets
      WHERE category_definition_id = $1 AND period_type = $2 AND is_active = 1
    `, [suggestion.category_definition_id, suggestion.period_type]);

    if (existingResult.rows.length > 0) {
      // Update existing budget
      await client.query(`
        UPDATE category_budgets
        SET
          budget_limit = $1,
          is_auto_suggested = 1,
          suggestion_id = $2,
          updated_at = datetime('now')
        WHERE id = $3
      `, [suggestion.suggested_limit, suggestionId, existingResult.rows[0].id]);
    } else {
      // Create new budget
      await client.query(`
        INSERT INTO category_budgets (
          category_definition_id,
          period_type,
          budget_limit,
          is_auto_suggested,
          suggestion_id,
          is_active
        ) VALUES ($1, $2, $3, 1, $4, 1)
      `, [
        suggestion.category_definition_id,
        suggestion.period_type,
        suggestion.suggested_limit,
        suggestionId,
      ]);
    }

    // Mark suggestion as active
    await client.query(`
      UPDATE budget_suggestions
      SET is_active = 1, activated_at = datetime('now')
      WHERE id = $1
    `, [suggestionId]);

    return { success: true, suggestion_id: suggestionId };
  } finally {
    client.release();
  }
}

/**
 * Get budget trajectory (forecast for current period)
 */
async function getBudgetTrajectory(params = {}) {
  const { budgetId, categoryDefinitionId } = params;

  if (!budgetId && !categoryDefinitionId) {
    throw new Error('Either budgetId or categoryDefinitionId is required');
  }

  const client = await database.getClient();

  try {
    // Get budget details
    let budgetResult;
    if (budgetId) {
      budgetResult = await client.query(`
        SELECT * FROM category_budgets WHERE id = $1
      `, [budgetId]);
    } else {
      budgetResult = await client.query(`
        SELECT * FROM category_budgets
        WHERE category_definition_id = $1 AND is_active = 1 AND period_type = 'monthly'
      `, [categoryDefinitionId]);
    }

    if (budgetResult.rows.length === 0) {
      throw new Error('Budget not found');
    }

    const budget = budgetResult.rows[0];
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Get spending in current period
    const spendingResult = await client.query(`
      SELECT COALESCE(SUM(ABS(price)), 0) as spent_amount
      FROM transactions
      WHERE category_definition_id = $1
        AND date >= $2 AND date <= $3
        AND price < 0
    `, [budget.category_definition_id, periodStart.toISOString().split('T')[0], now.toISOString().split('T')[0]]);

    const spentAmount = parseFloat(spendingResult.rows[0]?.spent_amount || 0);
    const budgetLimit = parseFloat(budget.budget_limit);
    const remaining = budgetLimit - spentAmount;

    const daysInMonth = periodEnd.getDate();
    const daysPassed = now.getDate();
    const daysRemaining = daysInMonth - daysPassed;

    const dailyAvg = daysPassed > 0 ? spentAmount / daysPassed : 0;
    const projectedTotal = dailyAvg * daysInMonth;
    const isOnTrack = projectedTotal <= budgetLimit;
    const recommendedDailyLimit = daysRemaining > 0 ? remaining / daysRemaining : 0;

    // Determine overrun risk
    let overrunRisk = 'none';
    const percentUsed = (spentAmount / budgetLimit);
    if (spentAmount > budgetLimit) {
      overrunRisk = 'critical';
    } else if (projectedTotal > budgetLimit * 1.1) {
      overrunRisk = 'high';
    } else if (projectedTotal > budgetLimit) {
      overrunRisk = 'medium';
    } else if (percentUsed > 0.8) {
      overrunRisk = 'low';
    }

    const trajectory = {
      budget_id: budget.id,
      category_definition_id: budget.category_definition_id,
      period_start: periodStart.toISOString().split('T')[0],
      period_end: periodEnd.toISOString().split('T')[0],
      budget_limit: budgetLimit,
      spent_amount: spentAmount,
      remaining_amount: remaining,
      percent_used: Math.round(percentUsed * 100),
      days_total: daysInMonth,
      days_passed: daysPassed,
      days_remaining: daysRemaining,
      daily_avg: dailyAvg,
      daily_limit: recommendedDailyLimit,
      projected_total: projectedTotal,
      is_on_track: isOnTrack,
      overrun_risk: overrunRisk,
    };

    // Save snapshot to trajectory table
    await client.query(`
      INSERT INTO budget_trajectory (
        budget_id,
        period_start,
        period_end,
        budget_limit,
        spent_amount,
        remaining_amount,
        days_remaining,
        days_total,
        daily_limit,
        projected_total,
        is_on_track,
        overrun_risk,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      budget.id,
      trajectory.period_start,
      trajectory.period_end,
      budgetLimit,
      spentAmount,
      remaining,
      daysRemaining,
      daysInMonth,
      recommendedDailyLimit,
      projectedTotal,
      isOnTrack ? 1 : 0,
      overrunRisk,
      JSON.stringify({ daily_avg: dailyAvg }),
    ]);

    return { trajectory };
  } finally {
    client.release();
  }
}

/**
 * Get budget health summary for all active budgets
 */
async function getBudgetHealth(options = {}) {
  const locale = resolveLocale(options?.locale);
  const client = await database.getClient();

  try {
    try {
      await ensureBaselineBudgets();
    } catch (error) {
      console.warn('Auto budget provisioning failed:', error);
    }

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysInMonth = periodEnd.getDate();
    const daysPassed = now.getDate();
    const daysRemaining = Math.max(0, daysInMonth - daysPassed);

    const result = await client.query(`
      SELECT
        cb.id as budget_id,
        cb.category_definition_id,
        cb.budget_limit,
        cd.name as category_name,
        cd.name_en as category_name_en,
        cd.name_fr as category_name_fr,
        COALESCE(SUM(ABS(t.price)), 0) as spent_amount
      FROM category_budgets cb
      JOIN category_definitions cd ON cb.category_definition_id = cd.id
      LEFT JOIN transactions t ON (
        t.category_definition_id = cb.category_definition_id
        AND t.date >= $1
        AND t.price < 0
      )
      WHERE cb.is_active = 1 AND cb.period_type = 'monthly'
      GROUP BY cb.id, cb.category_definition_id, cb.budget_limit, cd.name, cd.name_en
    `, [periodStart.toISOString().split('T')[0]]);

    const budgets = result.rows.map(row => {
      const localizedCategoryName = getLocalizedCategoryName({
        name: row.category_name,
        name_en: row.category_name_en,
        name_fr: row.category_name_fr,
      }, locale) || row.category_name;
      const budgetLimit = parseFloat(row.budget_limit);
      const spentAmount = parseFloat(row.spent_amount);
      const remaining = Math.max(0, budgetLimit - spentAmount);
      const percentUsed = budgetLimit > 0 ? (spentAmount / budgetLimit) * 100 : 0;
      const dailyAvg = daysPassed > 0 ? spentAmount / daysPassed : 0;
      const projectedTotal = Math.round(dailyAvg * daysInMonth);
      const recommendedDailyLimit = daysRemaining > 0 ? remaining / daysRemaining : 0;

      let status = 'on_track';
      if (spentAmount >= budgetLimit) {
        status = 'exceeded';
      } else if (projectedTotal > budgetLimit || percentUsed >= 80) {
        status = 'warning';
      }

      return {
        budget_id: row.budget_id,
        category_id: row.category_definition_id,
        category_name: localizedCategoryName,
        category_name_he: row.category_name,
        category_name_en: row.category_name_en,
        category_name_fr: row.category_name_fr,
        budget_limit: budgetLimit,
        spent_amount: spentAmount,
        remaining_amount: remaining,
        percent_used: Math.round(percentUsed),
        status,
        days_remaining: daysRemaining,
        daily_limit: recommendedDailyLimit,
        projected_total: projectedTotal,
        days_passed: daysPassed,
        daily_avg: dailyAvg,
      };
    });

    const summary = {
      total_budgets: budgets.length,
      on_track: budgets.filter(b => b.status === 'on_track').length,
      warning: budgets.filter(b => b.status === 'warning').length,
      exceeded: budgets.filter(b => b.status === 'exceeded').length,
      total_budget: budgets.reduce((sum, b) => sum + b.budget_limit, 0),
      total_spent: budgets.reduce((sum, b) => sum + b.spent_amount, 0),
    };

    // Determine overall status
    let overall_status = 'good';
    if (summary.exceeded > 0) {
      overall_status = 'critical';
    } else if (summary.warning > 0) {
      overall_status = 'warning';
    }

    return {
      success: true,
      budgets: budgets.map(b => ({
        category_id: b.category_id,
        category_name: b.category_name,
        category_name_he: b.category_name_he,
        category_name_en: b.category_name_en,
        category_name_fr: b.category_name_fr,
        budget_limit: b.budget_limit,
        current_spent: b.spent_amount,
        percentage_used: b.percent_used,
        days_remaining: b.days_remaining,
        projected_total: b.projected_total,
        daily_limit: b.daily_limit,
        status: b.status,
        daily_avg: b.daily_avg,
      })),
      overall_status,
      summary
    };
  } finally {
    client.release();
  }
}

module.exports = {
  fetchBudgetSuggestions,
  generateBudgetSuggestions,
  getBudgetSuggestions,
  activateBudgetSuggestion,
  getBudgetTrajectory,
  getBudgetHealth,
  ensureBaselineBudgets,
  calculateBudgetStats, // Export for testing
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
