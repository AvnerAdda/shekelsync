/**
 * Smart Actions Service
 *
 * Auto-generates actionable insights based on:
 * - Category spending anomalies (>20% from rolling average)
 * - Fixed category variations (rent, utilities changes)
 * - Unusual large purchases (>2σ from mean)
 * - Budget overrun projections
 * - Optimization opportunities
 */

const actualDatabase = require('../database.js');
const { resolveDateRange } = require('../../../lib/server/query-utils.js');
const { CATEGORY_TYPES } = require('../../../lib/category-constants.js');

let database = actualDatabase;

// Thresholds for anomaly detection
const ANOMALY_THRESHOLD = 0.20; // 20% increase from average
const FIXED_VARIATION_THRESHOLD = 0.10; // 10% variation for fixed costs
const UNUSUAL_PURCHASE_SIGMA = 2.0; // 2 standard deviations
const BUDGET_WARNING_THRESHOLD = 0.80; // 80% of budget used

/**
 * Calculate rolling 3-month average for a category
 */
async function getCategoryRollingAverage(client, categoryDefinitionId, endDate) {
  const threeMonthsAgo = new Date(endDate);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const result = await client.query(`
    SELECT
      AVG(ABS(price)) as avg_amount,
      COUNT(*) as transaction_count,
      SUM(ABS(price)) as total_amount
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
      AND t.date >= $2 AND t.date <= $3
      AND t.price < 0
      AND ap.id IS NULL
  `, [categoryDefinitionId, threeMonthsAgo.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]);

  return result.rows[0];
}

/**
 * Detect category spending anomalies (>20% from rolling average)
 */
async function detectCategoryAnomalies(params = {}) {
  const { months = 1 } = params;
  const { start, end } = resolveDateRange({ months });

  const client = await database.getClient();
  const anomalies = [];

  try {
    // Get all expense categories with spending in current period
    const currentResult = await client.query(`
      SELECT
        t.category_definition_id,
        cd.name as category_name,
        cd.name_en as category_name_en,
        parent.name as parent_category_name,
        COUNT(t.identifier) as current_count,
        SUM(ABS(t.price)) as current_total
      FROM transactions t
      JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
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
        AND ap.id IS NULL
      GROUP BY t.category_definition_id, cd.name, cd.name_en, parent.name
    `, [start, end]);

    for (const row of currentResult.rows) {
      const currentTotal = parseFloat(row.current_total || 0);
      const avgData = await getCategoryRollingAverage(client, row.category_definition_id, end);
      const avgMonthly = parseFloat(avgData.total_amount || 0) / 3; // 3-month average

      if (avgMonthly === 0) continue; // Skip categories with no historical data

      const percentIncrease = ((currentTotal - avgMonthly) / avgMonthly);

      if (percentIncrease >= ANOMALY_THRESHOLD) {
        const severity = percentIncrease >= 0.5 ? 'high' : percentIncrease >= 0.3 ? 'medium' : 'low';

        anomalies.push({
          action_type: 'anomaly',
          trigger_category_id: row.category_definition_id,
          severity,
          title: `Spending increase detected in ${row.category_name}`,
          description: `Your spending in ${row.category_name} increased by ${Math.round(percentIncrease * 100)}% compared to your 3-month average (₪${Math.round(avgMonthly)} → ₪${Math.round(currentTotal)}).`,
          metadata: JSON.stringify({
            current_total: currentTotal,
            average_monthly: avgMonthly,
            percent_increase: Math.round(percentIncrease * 100),
            historical_period_months: 3,
          }),
          potential_impact: -(currentTotal - avgMonthly), // Negative = cost increase
          detection_confidence: 0.85,
        });
      }
    }

    return anomalies;
  } finally {
    client.release();
  }
}

/**
 * Detect fixed category variations (utilities, rent showing >10% change)
 */
async function detectFixedCategoryVariations(params = {}) {
  const { months = 1 } = params;
  const { start, end } = resolveDateRange({ months });

  const client = await database.getClient();
  const variations = [];

  try {
    // Get fixed categories (from spending_category_mappings)
    const result = await client.query(`
      SELECT
        t.category_definition_id,
        cd.name as category_name,
        cd.name_en as category_name_en,
        parent.name as parent_category_name,
        scm.variability_type,
        COUNT(t.identifier) as current_count,
        SUM(ABS(t.price)) as current_total,
        AVG(ABS(t.price)) as current_avg,
        MIN(ABS(t.price)) as current_min,
        MAX(ABS(t.price)) as current_max
      FROM transactions t
      JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      JOIN spending_category_mappings scm ON cd.id = scm.category_definition_id
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
        AND scm.variability_type = 'fixed'
        AND ap.id IS NULL
      GROUP BY t.category_definition_id, cd.name, cd.name_en, parent.name, scm.variability_type
    `, [start, end]);

    for (const row of result.rows) {
      const currentAvg = parseFloat(row.current_avg || 0);
      const currentMin = parseFloat(row.current_min || 0);
      const currentMax = parseFloat(row.current_max || 0);

      // Check if there's variation (difference between min and max)
      if (currentAvg === 0) continue;

      const variationCoefficient = (currentMax - currentMin) / currentAvg;

      if (variationCoefficient >= FIXED_VARIATION_THRESHOLD) {
        const severity = variationCoefficient >= 0.25 ? 'high' : 'medium';

        variations.push({
          action_type: 'fixed_variation',
          trigger_category_id: row.category_definition_id,
          severity,
          title: `Unexpected variation in fixed cost: ${row.category_name}`,
          description: `${row.category_name} is classified as a fixed cost, but shows ${Math.round(variationCoefficient * 100)}% variation this month (₪${Math.round(currentMin)} - ₪${Math.round(currentMax)}). This might indicate a billing issue or service change.`,
          metadata: JSON.stringify({
            avg_amount: currentAvg,
            min_amount: currentMin,
            max_amount: currentMax,
            variation_coefficient: Math.round(variationCoefficient * 100),
          }),
          potential_impact: 0,
          detection_confidence: 0.75,
        });
      }
    }

    return variations;
  } finally {
    client.release();
  }
}

/**
 * Detect unusual large purchases (>2σ from category mean)
 */
async function detectUnusualPurchases(params = {}) {
  const { months = 1 } = params;
  const { start, end } = resolveDateRange({ months });

  const client = await database.getClient();
  const unusualPurchases = [];

  try {
    // Get all transactions in period
    const transactionsResult = await client.query(`
      SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.name,
        ABS(t.price) as amount,
        t.category_definition_id,
        cd.name as category_name,
        cd.name_en as category_name_en
      FROM transactions t
      JOIN category_definitions cd ON t.category_definition_id = cd.id
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
        AND ap.id IS NULL
      ORDER BY amount DESC
      LIMIT 100
    `, [start, end]);

    // Get category statistics
    for (const txn of transactionsResult.rows) {
      const avgData = await getCategoryRollingAverage(client, txn.category_definition_id, end);
      const mean = parseFloat(avgData.avg_amount || 0);

      if (mean === 0) continue;

      // Get standard deviation for this category
      const stdDevResult = await client.query(`
        SELECT
          (
            SQRT(AVG((ABS(price) - $2) * (ABS(price) - $2)))
          ) as std_dev
        FROM transactions
        WHERE category_definition_id = $1
          AND price < 0
          AND date >= DATE($3, '-3 months')
          AND date <= $3
      `, [txn.category_definition_id, mean, end.toISOString().split('T')[0]]);

      const stdDev = parseFloat(stdDevResult.rows[0]?.std_dev || 0);

      if (stdDev === 0) continue;

      const zScore = (parseFloat(txn.amount) - mean) / stdDev;

      if (zScore >= UNUSUAL_PURCHASE_SIGMA) {
        const severity = zScore >= 3 ? 'high' : 'medium';

        unusualPurchases.push({
          action_type: 'unusual_purchase',
          trigger_category_id: txn.category_definition_id,
          severity,
          title: `Unusually large purchase in ${txn.category_name}`,
          description: `A purchase of ₪${Math.round(parseFloat(txn.amount))} in ${txn.category_name} is ${Math.round(zScore)}σ above your average (₪${Math.round(mean)}). Transaction: "${txn.name}" on ${txn.date}.`,
          metadata: JSON.stringify({
            transaction_id: txn.identifier,
            transaction_name: txn.name,
            transaction_date: txn.date,
            amount: parseFloat(txn.amount),
            category_mean: mean,
            category_std_dev: stdDev,
            z_score: zScore,
          }),
          potential_impact: 0, // Informational
          detection_confidence: 0.9,
        });
      }
    }

    return unusualPurchases;
  } finally {
    client.release();
  }
}

/**
 * Detect budget overruns and projections
 */
async function detectBudgetOverruns(params = {}) {
  const { months = 1 } = params;
  const { start, end } = resolveDateRange({ months });

  const client = await database.getClient();
  const budgetAlerts = [];

  try {
    // Get active budgets with spending
    const result = await client.query(`
      SELECT
        cb.id as budget_id,
        cb.category_definition_id,
        cb.budget_limit,
        cd.name as category_name,
        cd.name_en as category_name_en,
        COALESCE(SUM(ABS(t.price)), 0) as spent_amount
      FROM category_budgets cb
      JOIN category_definitions cd ON cb.category_definition_id = cd.id
      LEFT JOIN transactions t ON (
        t.category_definition_id = cb.category_definition_id
        AND t.date >= $1 AND t.date <= $2
        AND t.price < 0
      )
      WHERE cb.is_active = 1
        AND cb.period_type = 'monthly'
      GROUP BY cb.id, cb.category_definition_id, cb.budget_limit, cd.name, cd.name_en
    `, [start, end]);

    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysRemaining = daysInMonth - now.getDate();

    for (const row of result.rows) {
      const budgetLimit = parseFloat(row.budget_limit);
      const spentAmount = parseFloat(row.spent_amount);
      const percentUsed = (spentAmount / budgetLimit);

      // Budget exceeded
      if (spentAmount > budgetLimit) {
        budgetAlerts.push({
          action_type: 'budget_overrun',
          trigger_category_id: row.category_definition_id,
          severity: 'critical',
          title: `Budget exceeded: ${row.category_name}`,
          description: `You've exceeded your ${row.category_name} budget by ₪${Math.round(spentAmount - budgetLimit)} (${Math.round(percentUsed * 100)}% used). Budget: ₪${Math.round(budgetLimit)}, Spent: ₪${Math.round(spentAmount)}.`,
          metadata: JSON.stringify({
            budget_id: row.budget_id,
            budget_limit: budgetLimit,
            spent_amount: spentAmount,
            overage: spentAmount - budgetLimit,
            percent_used: Math.round(percentUsed * 100),
          }),
          potential_impact: -(spentAmount - budgetLimit),
          detection_confidence: 1.0,
        });
      }
      // Approaching limit (80%)
      else if (percentUsed >= BUDGET_WARNING_THRESHOLD) {
        const dailyAvg = spentAmount / (daysInMonth - daysRemaining);
        const projected = dailyAvg * daysInMonth;
        const willExceed = projected > budgetLimit;

        budgetAlerts.push({
          action_type: 'budget_overrun',
          trigger_category_id: row.category_definition_id,
          severity: willExceed ? 'high' : 'medium',
          title: `Budget warning: ${row.category_name}`,
          description: `You've used ${Math.round(percentUsed * 100)}% of your ${row.category_name} budget (₪${Math.round(spentAmount)}/₪${Math.round(budgetLimit)}). ${daysRemaining} days remaining. ${willExceed ? `At current pace, you'll exceed by ₪${Math.round(projected - budgetLimit)}.` : `Stay under ₪${Math.round((budgetLimit - spentAmount) / daysRemaining)}/day to stay on track.`}`,
          metadata: JSON.stringify({
            budget_id: row.budget_id,
            budget_limit: budgetLimit,
            spent_amount: spentAmount,
            remaining: budgetLimit - spentAmount,
            percent_used: Math.round(percentUsed * 100),
            days_remaining: daysRemaining,
            daily_avg: dailyAvg,
            projected_total: projected,
            will_exceed: willExceed,
            recommended_daily_limit: (budgetLimit - spentAmount) / daysRemaining,
          }),
          potential_impact: willExceed ? -(projected - budgetLimit) : 0,
          detection_confidence: 0.8,
        });
      }
    }

    return budgetAlerts;
  } finally {
    client.release();
  }
}

/**
 * Generate all smart action items
 */
async function generateSmartActions(params = {}) {
  const { months = 1, force = false } = params;

  const allActions = [];

  // Run all detection algorithms in parallel
  const [anomalies, fixedVariations, unusualPurchases, budgetOverruns] = await Promise.all([
    detectCategoryAnomalies({ months }),
    detectFixedCategoryVariations({ months }),
    detectUnusualPurchases({ months }),
    detectBudgetOverruns({ months }),
  ]);

  allActions.push(...anomalies, ...fixedVariations, ...unusualPurchases, ...budgetOverruns);

  // Save to database (avoid duplicates using recurrence_key)
  const client = await database.getClient();
  let created = 0;
  let skipped = 0;

  try {
    for (const action of allActions) {
      // Generate recurrence key
      const recurrenceKey = `${action.action_type}_${action.trigger_category_id}_${new Date().toISOString().substring(0, 7)}`; // YYYY-MM

      // Check if action already exists this month
      const existingResult = await client.query(`
        SELECT id FROM smart_action_items
        WHERE recurrence_key = $1 AND user_status NOT IN ('resolved', 'dismissed')
      `, [recurrenceKey]);

      if (existingResult.rows.length > 0 && !force) {
        skipped++;
        continue;
      }

      // Create action item
      await client.query(`
        INSERT INTO smart_action_items (
          action_type,
          trigger_category_id,
          severity,
          title,
          description,
          metadata,
          potential_impact,
          detection_confidence,
          recurrence_key,
          is_recurring
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
      `, [
        action.action_type,
        action.trigger_category_id,
        action.severity,
        action.title,
        action.description,
        action.metadata,
        action.potential_impact,
        action.detection_confidence,
        recurrenceKey,
      ]);

      created++;
    }

    return {
      success: true,
      total_detected: allActions.length,
      created,
      skipped,
      breakdown: {
        anomalies: anomalies.length,
        fixed_variations: fixedVariations.length,
        unusual_purchases: unusualPurchases.length,
        budget_overruns: budgetOverruns.length,
      },
    };
  } finally {
    client.release();
  }
}

/**
 * Get smart action items
 */
async function getSmartActions(params = {}) {
  const { status = 'active', severity, actionType } = params;

  const client = await database.getClient();

  try {
    let query = `
      SELECT
        sai.*,
        cd.name as category_name,
        cd.name_en as category_name_en,
        parent.name as parent_category_name
      FROM smart_action_items sai
      LEFT JOIN category_definitions cd ON sai.trigger_category_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      WHERE 1=1
    `;

    const values = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      query += ` AND sai.user_status = $${paramCount}`;
      values.push(status);
    }

    if (severity) {
      paramCount++;
      query += ` AND sai.severity = $${paramCount}`;
      values.push(severity);
    }

    if (actionType) {
      paramCount++;
      query += ` AND sai.action_type = $${paramCount}`;
      values.push(actionType);
    }

    query += ` ORDER BY
      CASE sai.severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      sai.detected_at DESC
    `;

    const result = await client.query(query, values);

    const actions = result.rows.map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    }));

    const summary = {
      total: actions.length,
      by_severity: {
        critical: actions.filter(a => a.severity === 'critical').length,
        high: actions.filter(a => a.severity === 'high').length,
        medium: actions.filter(a => a.severity === 'medium').length,
        low: actions.filter(a => a.severity === 'low').length,
      },
      by_type: {
        anomaly: actions.filter(a => a.action_type === 'anomaly').length,
        budget_overrun: actions.filter(a => a.action_type === 'budget_overrun').length,
        fixed_variation: actions.filter(a => a.action_type === 'fixed_variation').length,
        unusual_purchase: actions.filter(a => a.action_type === 'unusual_purchase').length,
      },
      total_potential_impact: actions.reduce((sum, a) => sum + (parseFloat(a.potential_impact) || 0), 0),
    };

    return { actions, summary };
  } finally {
    client.release();
  }
}

/**
 * Update smart action status
 */
async function updateSmartActionStatus(actionId, status, userNote) {
  const client = await database.getClient();

  try {
    const updateFields = ['user_status = $2'];
    const values = [actionId, status];
    let paramCount = 2;

    if (status === 'resolved') {
      updateFields.push('resolved_at = datetime(\'now\')');
    } else if (status === 'dismissed') {
      updateFields.push('dismissed_at = datetime(\'now\')');
    } else if (status === 'snoozed') {
      paramCount++;
      updateFields.push(`snoozed_until = datetime('now', '+7 days')`);
    }

    const result = await client.query(`
      UPDATE smart_action_items
      SET ${updateFields.join(', ')}
      WHERE id = $1
      RETURNING *
    `, values);

    if (result.rows.length === 0) {
      throw new Error('Smart action item not found');
    }

    // Add to history
    if (userNote) {
      await client.query(`
        INSERT INTO action_item_history (smart_action_item_id, action, new_status, user_note)
        VALUES ($1, $2, $3, $4)
      `, [actionId, status, status, userNote]);
    }

    return { action: result.rows[0] };
  } finally {
    client.release();
  }
}

module.exports = {
  generateSmartActions,
  getSmartActions,
  updateSmartActionStatus,
  detectCategoryAnomalies,
  detectFixedCategoryVariations,
  detectUnusualPurchases,
  detectBudgetOverruns,
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
