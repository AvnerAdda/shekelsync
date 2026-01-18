/**
 * Smart Actions Service
 *
 * Auto-generates actionable insights based on:
 * - Category spending anomalies (forecast vs actual variance)
 * - Fixed recurring payment changes (insurance, subscriptions)
 * - Unusual large purchases (>2σ from mean)
 * - Budget overrun projections (using ML forecasts)
 * - Optimization opportunities (under-budget, high variance)
 */

const actualDatabase = require('../database.js');
const { resolveDateRange } = require('../../../lib/server/query-utils.js');
const { CATEGORY_TYPES } = require('../../../lib/category-constants.js');
const { resolveLocale, getLocalizedCategoryName } = require('../../../lib/server/locale-utils.js');
const forecastService = require('../forecast.js');

let database = actualDatabase;

// Thresholds for anomaly detection
const ANOMALY_THRESHOLD = 0.20; // 20% increase from average
const FIXED_VARIATION_THRESHOLD = 0.10; // 10% variation for fixed costs
const UNUSUAL_PURCHASE_SIGMA = 2.0; // 2 standard deviations
const BUDGET_WARNING_THRESHOLD = 0.80; // 80% of budget used

// Quest System Configuration
const MAX_ACTIVE_QUESTS = 5;
const MIN_QUESTS_BEFORE_GENERATION = 3;
const STREAK_RESET_DAYS = 30;

// Level tiers: points required to reach each level
const LEVEL_TIERS = [
  { level: 1, points: 0 },
  { level: 2, points: 100 },
  { level: 3, points: 300 },
  { level: 4, points: 600 },
  { level: 5, points: 1000 },
  { level: 6, points: 1500 },
  { level: 7, points: 2200 },
  { level: 8, points: 3000 },
  { level: 9, points: 4000 },
  { level: 10, points: 5000 },
];

// Base points by quest duration (days)
const QUEST_DURATION_POINTS = {
  7: { min: 50, max: 100 },
  30: { min: 150, max: 300 },
  90: { min: 400, max: 600 },
  180: { min: 800, max: 1000 },
};

// Difficulty multipliers
const DIFFICULTY_MULTIPLIERS = {
  easy: 1.0,
  medium: 1.5,
  hard: 2.0,
};

// Quest action types
const QUEST_ACTION_TYPES = [
  'quest_reduce_spending',
  'quest_savings_target',
  'quest_budget_adherence',
  'quest_set_budget',
  'quest_reduce_fixed_cost',
  'quest_income_goal',
  // Actionable quest types
  'quest_merchant_limit',
  'quest_weekend_limit',
];

/**
 * Calculate level from total points
 */
function calculateLevel(totalPoints) {
  for (let i = LEVEL_TIERS.length - 1; i >= 0; i--) {
    if (totalPoints >= LEVEL_TIERS[i].points) {
      return LEVEL_TIERS[i].level;
    }
  }
  return 1;
}

/**
 * Calculate points for a quest based on duration and difficulty
 */
function calculateQuestPoints(durationDays, difficulty, targetReductionPct = 0) {
  // Find closest duration tier
  const durations = Object.keys(QUEST_DURATION_POINTS).map(Number).sort((a, b) => a - b);
  let tier = durations[0];
  for (const d of durations) {
    if (durationDays >= d) tier = d;
  }
  
  const baseRange = QUEST_DURATION_POINTS[tier];
  // Scale within range based on target difficulty (higher reduction = more points)
  const scaleFactor = Math.min(1, targetReductionPct / 25); // 25% reduction = max base points
  const basePoints = baseRange.min + (baseRange.max - baseRange.min) * scaleFactor;
  
  const multiplier = DIFFICULTY_MULTIPLIERS[difficulty] || 1;
  return Math.round(basePoints * multiplier);
}

/**
 * Determine quest difficulty based on reduction target and pattern confidence
 */
function determineQuestDifficulty(reductionPct, confidence = 0.7) {
  // Higher reduction + lower confidence = harder
  const difficultyScore = (reductionPct / 100) * 2 + (1 - confidence);
  
  if (difficultyScore >= 0.6) return 'hard';
  if (difficultyScore >= 0.35) return 'medium';
  return 'easy';
}

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
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE t.category_definition_id = $1
      AND t.date >= $2 AND t.date <= $3
      AND t.price < 0
      AND tpe.transaction_identifier IS NULL
  `, [categoryDefinitionId, threeMonthsAgo.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]);

  return result.rows[0];
}

/**
 * Calculate average monthly spend over a longer window (default 6 months)
 */
async function getCategoryMonthlyAverage(client, categoryDefinitionId, endDate, monthsBack = 6) {
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - monthsBack);

  const result = await client.query(`
    SELECT
      SUM(ABS(t.price)) as total_amount
    FROM transactions t
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE t.category_definition_id = $1
      AND t.date >= $2 AND t.date <= $3
      AND t.price < 0
      AND tpe.transaction_identifier IS NULL
  `, [categoryDefinitionId, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]);

  const total = parseFloat(result.rows[0]?.total_amount || 0);
  return monthsBack > 0 ? total / monthsBack : total;
}

/**
 * Calculate average monthly spend including category descendants (6 months)
 */
async function getCategoryTreeMonthlyAverage(client, categoryDefinitionId, endDate, monthsBack = 6) {
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - monthsBack);

  const result = await client.query(`
    WITH RECURSIVE category_tree(id) AS (
      SELECT id FROM category_definitions WHERE id = $1
      UNION ALL
      SELECT cd.id
      FROM category_definitions cd
      JOIN category_tree ct ON cd.parent_id = ct.id
    )
    SELECT SUM(ABS(t.price)) as total_amount
    FROM transactions t
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE t.category_definition_id IN (SELECT id FROM category_tree)
      AND t.date >= $2 AND t.date <= $3
      AND t.price < 0
      AND tpe.transaction_identifier IS NULL
  `, [categoryDefinitionId, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]);

  const total = parseFloat(result.rows[0]?.total_amount || 0);
  return monthsBack > 0 ? total / monthsBack : total;
}

/**
 * Get trailing monthly stats (avg/max) for a category tree over N months
 */
async function getCategoryTreeMonthlyStats(client, categoryDefinitionId, endDate, monthsBack = 6) {
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - monthsBack);

  const result = await client.query(`
    WITH RECURSIVE category_tree(id) AS (
      SELECT id FROM category_definitions WHERE id = $1
      UNION ALL
      SELECT cd.id
      FROM category_definitions cd
      JOIN category_tree ct ON cd.parent_id = ct.id
    ),
    monthly_totals AS (
      SELECT
        strftime('%Y-%m', t.date) AS month,
        SUM(ABS(t.price)) AS total_amount
      FROM transactions t
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.category_definition_id IN (SELECT id FROM category_tree)
        AND t.date >= $2 AND t.date <= $3
        AND t.price < 0
        AND tpe.transaction_identifier IS NULL
      GROUP BY strftime('%Y-%m', t.date)
    )
    SELECT AVG(total_amount) AS avg_amount, MAX(total_amount) AS max_amount
    FROM monthly_totals
  `, [categoryDefinitionId, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]);

  const avg = parseFloat(result.rows[0]?.avg_amount || 0);
  const max = parseFloat(result.rows[0]?.max_amount || 0);
  return { avg, max };
}

/**
 * Detect category spending anomalies using forecast predictions
 */
async function detectCategoryAnomalies(params = {}) {
  const { months = 1, locale, forecastData: injectedForecast } = params;
  const { start, end } = resolveDateRange({ months });
  const anomalies = [];

  try {
    // Get forecast data with pattern predictions
    const forecastData = injectedForecast || await forecastService.getForecast({ months: 6 });
    const patterns = forecastData?.patterns || [];
    const forecastByCategory = forecastData?.forecastByCategory || new Map();
    const outlookMap = new Map();
    (forecastData?.budgetOutlook || []).forEach(item => {
      if (item.categoryDefinitionId) {
        outlookMap.set(item.categoryDefinitionId, item);
      }
    });

    const client = await database.getClient();
    const rollingCache = new Map();
    const longAvgCache = new Map();
    const treeAvgCache = new Map();
    const treeStatsCache = new Map();

    // Get current month spending
    const currentResult = await client.query(`
      SELECT
        t.category_definition_id,
        cd.name as category_name,
        cd.name_en as category_name_en,
        SUM(ABS(t.price)) as current_total
      FROM transactions t
      JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND t.price < 0
        AND cd.category_type = 'expense'
        AND tpe.transaction_identifier IS NULL
      GROUP BY t.category_definition_id, cd.name, cd.name_en
    `, [start, end]);

    for (const row of currentResult.rows) {
      const currentTotal = parseFloat(row.current_total || 0);
      const pattern = patterns.find(p => p.categoryDefinitionId === row.category_definition_id);

      if (!pattern) continue;

      // Rolling 3-month fallback to avoid tiny baselines
      if (!rollingCache.has(row.category_definition_id)) {
        const stats = await getCategoryRollingAverage(client, row.category_definition_id, end);
        rollingCache.set(row.category_definition_id, stats || {});
      }
      const rollingStats = rollingCache.get(row.category_definition_id) || {};
      const rollingMonthly = rollingStats.total_amount ? parseFloat(rollingStats.total_amount || 0) / 3 : 0;

      // Longer window average (6 months) to stabilize expectation
      if (!longAvgCache.has(row.category_definition_id)) {
        const avg = await getCategoryMonthlyAverage(client, row.category_definition_id, end, 6);
        longAvgCache.set(row.category_definition_id, avg || 0);
      }
      const longMonthlyAvg = longAvgCache.get(row.category_definition_id) || 0;

      // Include descendants (if category has children)
      if (!treeAvgCache.has(row.category_definition_id)) {
        const avg = await getCategoryTreeMonthlyAverage(client, row.category_definition_id, end, 6);
        treeAvgCache.set(row.category_definition_id, avg || 0);
      }
      const treeMonthlyAvg = treeAvgCache.get(row.category_definition_id) || 0;

      // Trailing max month to avoid tiny baselines from sparse patterns
      if (!treeStatsCache.has(row.category_definition_id)) {
        const stats = await getCategoryTreeMonthlyStats(client, row.category_definition_id, end, 6);
        treeStatsCache.set(row.category_definition_id, stats || { avg: 0, max: 0 });
      }
      const treeStats = treeStatsCache.get(row.category_definition_id) || { avg: 0, max: 0 };

      const confidence = Number.isFinite(pattern.confidence) ? pattern.confidence : 0.6;
      if (confidence < 0.3) continue;

      // Use monthly expectation (avg amount * avg occurrences) to avoid tiny baselines
      const avgOccurrences = Number.isFinite(pattern.avgOccurrencesPerMonth) ? pattern.avgOccurrencesPerMonth : 1;
      const patternExpected = (pattern.avgAmount || 0) * avgOccurrences;
      const outlookExpected = outlookMap.get(row.category_definition_id)?.projectedTotal || 0;
      const expectedMonthly = Math.max(
        patternExpected,
        rollingMonthly,
        longMonthlyAvg,
        treeMonthlyAvg,
        treeStats.max || 0,
        outlookExpected
      );
      if (expectedMonthly <= 0) continue;

      const percentDeviation = ((currentTotal - expectedMonthly) / expectedMonthly);

      // Avoid noisy alerts when expected baseline is very small
      if (expectedMonthly < 100 && currentTotal < 300) continue;

      if (Math.abs(percentDeviation) >= ANOMALY_THRESHOLD && currentTotal > expectedMonthly) {
        const severity = percentDeviation >= 0.5 ? 'high' : percentDeviation >= 0.3 ? 'medium' : 'low';

        const monthsOfHistory = Number.isFinite(pattern.monthsOfHistory) ? pattern.monthsOfHistory : rollingStats?.transaction_count ? Math.max(1, Math.round(rollingStats.transaction_count / 3)) : 1;
        const displayConfidence = Math.round((confidence || 0) * 100);

        const localizedName = getLocalizedCategoryName({
          name: row.category_name,
          name_en: row.category_name_en,
          name_fr: null,
        }, locale) || row.category_name;

        anomalies.push({
          action_type: 'anomaly',
          trigger_category_id: row.category_definition_id,
          severity,
          title: `Unexpected spending spike: ${localizedName}`,
          description: `Your ${localizedName} spending is ${Math.round(percentDeviation * 100)}% above predicted levels. Current: ₪${Math.round(currentTotal)}, Expected: ₪${Math.round(expectedMonthly)} (based on ${monthsOfHistory} month${monthsOfHistory === 1 ? '' : 's'} of data, ${displayConfidence}% confidence).`,
          metadata: JSON.stringify({
            current_total: currentTotal,
            expected_monthly: expectedMonthly,
            percent_deviation: Math.round(percentDeviation * 100),
            pattern_confidence: confidence,
            pattern_type: pattern.patternType,
            months_of_history: monthsOfHistory,
            is_fixed_recurring: pattern.isFixedRecurring || false,
            rolling_monthly: rollingMonthly,
          }),
          potential_impact: -(currentTotal - expectedMonthly),
          detection_confidence: confidence,
        });
      }
    }

    client.release();
    return anomalies;
  } catch (error) {
    console.error('Failed to detect category anomalies:', error);
    return [];
  }
}

/**
 * Detect fixed category variations (utilities, rent showing >10% change)
 */
async function detectFixedCategoryVariations(params = {}) {
  const { months = 1, locale } = params;
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
        MAX(ABS(t.price)) as current_max,
        -- Calculate standard deviation manually (SQLite doesn't have STDDEV)
        SQRT(AVG(ABS(t.price) * ABS(t.price)) - AVG(ABS(t.price)) * AVG(ABS(t.price))) as current_stddev_pop
      FROM transactions t
      JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      JOIN spending_category_mappings scm ON cd.id = scm.category_definition_id
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND t.price < 0
        AND cd.category_type = 'expense'
        AND scm.variability_type = 'fixed'
        AND tpe.transaction_identifier IS NULL
      GROUP BY t.category_definition_id, cd.name, cd.name_en, parent.name, scm.variability_type
    `, [start, end]);

    for (const row of result.rows) {
      const currentAvg = parseFloat(row.current_avg || 0);
      const currentCount = parseInt(row.current_count || 0);
      const stdDevPop = parseFloat(row.current_stddev_pop || 0);

      // Skip if no average or only one transaction
      if (currentAvg === 0 || currentCount < 2) continue;

      // Convert population stddev to sample stddev
      const stdDev = stdDevPop * Math.sqrt(currentCount / (currentCount - 1));

      // Calculate proper coefficient of variation (CV = stdDev / mean)
      const variationCoefficient = stdDev / currentAvg;

      if (variationCoefficient >= FIXED_VARIATION_THRESHOLD) {
        const severity = variationCoefficient >= 0.25 ? 'high' : 'medium';

        const localizedName = getLocalizedCategoryName({
          name: row.category_name,
          name_en: row.category_name_en,
          name_fr: null,
        }, locale) || row.category_name;

        variations.push({
          action_type: 'fixed_variation',
          trigger_category_id: row.category_definition_id,
          severity,
          title: `Unexpected variation in fixed cost: ${localizedName}`,
          description: `${localizedName} is classified as a fixed cost, but shows ${Math.round(variationCoefficient * 100)}% variation this month (₪${Math.round(currentMin)} - ₪${Math.round(currentMax)}). This might indicate a billing issue or service change.`,
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
  const { months = 1, locale } = params;
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
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND t.price < 0
        AND cd.category_type = 'expense'
        AND tpe.transaction_identifier IS NULL
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
        const localizedName = getLocalizedCategoryName({
          name: txn.category_name,
          name_en: txn.category_name_en,
          name_fr: null,
        }, locale) || txn.category_name;

        const severity = zScore >= 3 ? 'high' : 'medium';

        unusualPurchases.push({
          action_type: 'unusual_purchase',
          trigger_category_id: txn.category_definition_id,
          severity,
          title: `Unusually large purchase in ${localizedName}`,
          description: `A purchase of ₪${Math.round(parseFloat(txn.amount))} in ${localizedName} is ${Math.round(zScore)}σ above your average (₪${Math.round(mean)}). Transaction: "${txn.name}" on ${txn.date}.`,
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
 * Detect fixed recurring payment anomalies
 * - Amount changes (insurance increase, subscription price change)
 * - Missing expected payments
 * - Unexpected occurrences
 */
async function detectFixedRecurringAnomalies(params = {}) {
  const { locale, forecastData: injectedForecast } = params;
  const anomalies = [];

  let client;
  try {
    // Get forecast data with pattern information
    const forecastData = injectedForecast || await forecastService.getForecast({ months: 6 });
    const patterns = (forecastData?.patterns || []).filter(p => p.categoryDefinitionId);
    
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfMonthStr = startOfMonth.toISOString().split('T')[0];
    const todayStr = now.toISOString().split('T')[0];
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthProgress = now.getDate() / daysInMonth;
    client = await database.getClient();

    // Only keep recurring-like patterns (monthly/weekly) with enough history
    const recurringCandidates = patterns.filter(p => {
      const hasHistory = (p.monthsOfHistory || 0) >= 2;
      const recurringFrequency = (p.avgOccurrencesPerMonth || 0) >= 0.8;
      const likelyFixed = p.isFixedRecurring || (p.isFixedAmount && (p.patternType === 'monthly' || p.patternType === 'bi-monthly'));
      return hasHistory && (recurringFrequency || likelyFixed);
    });

    const categoryIds = [...new Set(recurringCandidates.map(p => p.categoryDefinitionId))];
    const occurrencesByCategory = new Map();

    if (categoryIds.length > 0) {
      const placeholders = categoryIds.map((_, idx) => `$${idx + 1}`).join(', ');
      const paramsList = [...categoryIds, startOfMonthStr, todayStr];

      const occurrencesResult = await client.query(`
        SELECT
          t.category_definition_id,
          t.date,
          ABS(t.price) as amount,
          t.name
        FROM transactions t
        LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
          ON t.identifier = tpe.transaction_identifier
          AND t.vendor = tpe.transaction_vendor
        WHERE t.category_definition_id IN (${placeholders})
          AND t.status = 'completed'
          AND t.category_type = 'expense'
          AND t.price < 0
          AND tpe.transaction_identifier IS NULL
          AND t.date >= $${categoryIds.length + 1}
          AND t.date <= $${categoryIds.length + 2}
        ORDER BY t.date DESC
      `, paramsList);

      for (const row of occurrencesResult.rows || []) {
        const cid = row.category_definition_id;
        if (!occurrencesByCategory.has(cid)) {
          occurrencesByCategory.set(cid, []);
        }
        occurrencesByCategory.get(cid).push({
          date: row.date,
          amount: parseFloat(row.amount),
          name: row.name,
          day: new Date(row.date).getDate(),
        });
      }
    }

    for (const pattern of recurringCandidates) {
      const occurrences = occurrencesByCategory.get(pattern.categoryDefinitionId) || [];
      const localizedName = getLocalizedCategoryName({
        name: pattern.categoryName,
        name_en: pattern.categoryNameEn,
        name_fr: null,
      }, locale) || pattern.categoryName;

      const expectedAmount = pattern.fixedAmount || pattern.avgAmount || 0;
      const tolerancePct = 0.05; // 5% tolerance for "fixed" amounts
      const expectedDay = pattern.fixedDayOfMonth || (pattern.mostLikelyDaysOfMonth?.[0]?.day ?? null);
      // Anomaly 1: Amount changed significantly (fixed recurring only)
      if (pattern.isFixedRecurring && pattern.fixedAmount) {
        for (const txn of occurrences) {
          const amount = parseFloat(txn.amount);
          const deviation = Math.abs(amount - expectedAmount) / expectedAmount;

          if (deviation > tolerancePct) {
            const changeType = amount > expectedAmount ? 'increase' : 'decrease';
            const severity = deviation > 0.2 ? 'high' : 'medium';

            anomalies.push({
              action_type: 'fixed_recurring_change',
              trigger_category_id: pattern.categoryDefinitionId,
              severity,
              title: `Fixed payment ${changeType}: ${localizedName}`,
              description: `Your ${localizedName} payment changed from ₪${Math.round(expectedAmount)} to ₪${Math.round(amount)} (${Math.round(deviation * 100)}% ${changeType}). This may indicate a price change, billing adjustment, or service modification.`,
              metadata: JSON.stringify({
                expected_amount: expectedAmount,
                actual_amount: amount,
                deviation_pct: Math.round(deviation * 100),
                transaction_name: txn.name,
                transaction_date: txn.date,
                change_type: changeType,
                coefficient_of_variation: pattern.coefficientOfVariation,
              }),
              potential_impact: amount > expectedAmount ? -(amount - expectedAmount) : 0,
              detection_confidence: 0.9,
            });
          }
        }
      }

      // Expected/late detection: nothing has occurred yet but should have by now
      const actualOccurrences = occurrences.length;
      const expectedByNow = Math.max(1, Math.round((pattern.avgOccurrencesPerMonth || 1) * monthProgress));
      const likelyAmount = Math.round(expectedAmount);

      const isLateMonthly = actualOccurrences === 0 && expectedDay && now.getDate() > (expectedDay + 3);
      const isBehindSchedule = actualOccurrences === 0 && !expectedDay && monthProgress > 0.6 && expectedByNow >= 1;
      const isWeeklyLag = actualOccurrences < 1 && pattern.avgOccurrencesPerMonth >= 3 && monthProgress > 0.35;
      const shouldAlertMissing = isLateMonthly || isBehindSchedule || isWeeklyLag;

      if (shouldAlertMissing) {
        anomalies.push({
          action_type: 'fixed_recurring_missing',
          trigger_category_id: pattern.categoryDefinitionId,
          severity: pattern.isFixedRecurring ? 'medium' : 'low',
          title: `Expected payment missing: ${localizedName}`,
          description: `A recurring ${localizedName} charge (usually around ₪${likelyAmount}${expectedDay ? ` near day ${expectedDay}` : ''}) has not appeared yet this month. Consider checking if the bill was paused or paid from another account.`,
          metadata: JSON.stringify({
            expected_amount: expectedAmount,
            expected_day: expectedDay,
            current_day: now.getDate(),
            pattern_confidence: pattern.confidence,
            months_of_history: pattern.monthsOfHistory,
            avg_occurrences_per_month: pattern.avgOccurrencesPerMonth,
            most_likely_days: pattern.mostLikelyDaysOfMonth || [],
            actual_occurrences: actualOccurrences,
            expected_by_now: expectedByNow,
          }),
          potential_impact: 0,
          detection_confidence: Math.max(0.6, pattern.confidence || 0.6),
        });
      }

      // Anomaly 3: Upcoming reminder (within 3 days of expected date, nothing yet)
      const upcomingWindow = expectedDay ? expectedDay - now.getDate() : null;
      if (!shouldAlertMissing && actualOccurrences === 0 && upcomingWindow !== null && upcomingWindow <= 3 && upcomingWindow >= -1) {
        anomalies.push({
          action_type: 'fixed_recurring_missing',
          trigger_category_id: pattern.categoryDefinitionId,
          severity: 'low',
          title: `Upcoming recurring charge: ${localizedName}`,
          description: `${localizedName} typically bills around day ${expectedDay}. No charge has posted yet this month. Keep an eye out so it isn't missed.`,
          metadata: JSON.stringify({
            expected_day: expectedDay,
            current_day: now.getDate(),
            pattern_confidence: pattern.confidence,
            months_of_history: pattern.monthsOfHistory,
            avg_occurrences_per_month: pattern.avgOccurrencesPerMonth,
            most_likely_days: pattern.mostLikelyDaysOfMonth || [],
            actual_occurrences: actualOccurrences,
            expected_by_now: expectedByNow,
          }),
          potential_impact: 0,
          detection_confidence: Math.max(0.55, pattern.confidence || 0.55),
        });
      }

      // Anomaly 4: Unexpected multiple occurrences (should be once per month)
      if (occurrences.length > 1 && pattern.avgOccurrencesPerMonth < 1.2) {
        anomalies.push({
          action_type: 'fixed_recurring_duplicate',
          trigger_category_id: pattern.categoryDefinitionId,
          severity: 'medium',
          title: `Duplicate fixed payment: ${localizedName}`,
          description: `Found ${occurrences.length} ${localizedName} charges this month (expected 1). Total: ₪${Math.round(occurrences.reduce((sum, t) => sum + parseFloat(t.amount), 0))}. This may indicate duplicate billing.`,
          metadata: JSON.stringify({
            expected_count: 1,
            actual_count: occurrences.length,
            total_amount: occurrences.reduce((sum, t) => sum + parseFloat(t.amount), 0),
            transactions: occurrences.map(t => ({ date: t.date, amount: parseFloat(t.amount), name: t.name })),
          }),
          potential_impact: -(occurrences.reduce((sum, t) => sum + parseFloat(t.amount), 0) - expectedAmount),
          detection_confidence: 0.85,
        });
      }
    }

    return anomalies;
  } catch (error) {
    console.error('Failed to detect fixed recurring anomalies:', error);
    return [];
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Generate forecast-based optimization opportunities
 */
async function detectOptimizationOpportunities(params = {}) {
  const { locale, forecastData: injectedForecast } = params;
  const opportunities = [];

  try {
    const forecastData = injectedForecast || await forecastService.getForecast({ months: 6 });
    const budgetOutlook = forecastData?.budgetOutlook || [];
    const patterns = forecastData?.patterns || [];

    // Opportunity 1: Under-budget categories (reallocate to savings)
    const underBudget = budgetOutlook.filter(item => 
      item.budgetId && 
      item.status === 'on_track' && 
      item.limit > 0 &&
      item.projectedTotal < item.limit * 0.7 // Using less than 70% of budget
    );

    for (const item of underBudget) {
      const surplus = item.limit - item.projectedTotal;
      const localizedName = getLocalizedCategoryName({
        name: item.categoryName,
        name_en: item.categoryNameEn,
        name_fr: null,
      }, locale) || item.categoryName;

      opportunities.push({
        action_type: 'optimization_reallocate',
        trigger_category_id: item.categoryDefinitionId,
        severity: 'low',
        title: `Savings opportunity: ${localizedName}`,
        description: `You're projected to spend ₪${Math.round(item.projectedTotal)} in ${localizedName}, well under your ₪${Math.round(item.limit)} budget. Consider reallocating ₪${Math.round(surplus)} to savings or other goals.`,
        metadata: JSON.stringify({
          budget_limit: item.limit,
          projected_total: item.projectedTotal,
          surplus: surplus,
          utilization_pct: Math.round((item.projectedTotal / item.limit) * 100),
        }),
        potential_impact: surplus,
        detection_confidence: 0.8,
      });
    }

    // Opportunity 2: High variance categories (suggest budgets)
    const highVariance = patterns.filter(p => 
      p.monthsOfHistory >= 3 && 
      p.coefficientOfVariation > 0.4 && 
      p.avgAmount > 50 && // Meaningful amounts only
      !budgetOutlook.find(b => b.categoryDefinitionId === p.categoryDefinitionId && b.budgetId)
    );

    for (const pattern of highVariance.slice(0, 3)) {
      const localizedName = getLocalizedCategoryName({
        name: pattern.categoryName,
        name_en: pattern.categoryNameEn,
        name_fr: null,
      }, locale) || pattern.categoryName;

      opportunities.push({
        action_type: 'optimization_add_budget',
        trigger_category_id: pattern.categoryDefinitionId,
        severity: 'low',
        title: `Consider budgeting: ${localizedName}`,
        description: `${localizedName} shows high spending variability (₪${Math.round(pattern.minAmount)}-₪${Math.round(pattern.maxAmount)}). Setting a budget of ₪${Math.round(pattern.avgAmount * 1.2)} could help control costs.`,
        metadata: JSON.stringify({
          avg_monthly: pattern.avgAmount,
          min_amount: pattern.minAmount,
          max_amount: pattern.maxAmount,
          coefficient_of_variation: pattern.coefficientOfVariation,
          suggested_budget: Math.round(pattern.avgAmount * 1.2),
        }),
        potential_impact: 0,
        detection_confidence: 0.7,
      });
    }

    // Opportunity 3: Forecast confidence warnings
    const lowConfidence = budgetOutlook.filter(item => 
      item.forecasted > 0 && 
      patterns.find(p => p.categoryDefinitionId === item.categoryDefinitionId && p.confidence < 0.5)
    );

    for (const item of lowConfidence) {
      const pattern = patterns.find(p => p.categoryDefinitionId === item.categoryDefinitionId);
      const localizedName = getLocalizedCategoryName({
        name: item.categoryName,
        name_en: item.categoryNameEn,
        name_fr: null,
      }, locale) || item.categoryName;

      opportunities.push({
        action_type: 'optimization_low_confidence',
        trigger_category_id: item.categoryDefinitionId,
        severity: 'low',
        title: `Unpredictable spending: ${localizedName}`,
        description: `${localizedName} spending is highly irregular (confidence: ${Math.round(pattern.confidence * 100)}%). Forecasts may be unreliable. Consider reviewing your spending patterns.`,
        metadata: JSON.stringify({
          confidence: pattern.confidence,
          pattern_type: pattern.patternType,
          months_of_history: pattern.monthsOfHistory,
          coefficient_of_variation: pattern.coefficientOfVariation,
        }),
        potential_impact: 0,
        detection_confidence: 0.6,
      });
    }

    return opportunities;
  } catch (error) {
    console.error('Failed to detect optimization opportunities:', error);
    return [];
  }
}


/**
 * Detect budget overruns using ML forecast projections
 */
async function detectBudgetOverruns(params = {}) {
  const { locale, forecastData: injectedForecast } = params;
  const budgetAlerts = [];

  try {
    // Get forecast data which includes budget outlook
    const forecastData = injectedForecast || await forecastService.getForecast({ months: 6 });
    const budgetOutlook = forecastData?.budgetOutlook || [];

    for (const item of budgetOutlook) {
      // Skip categories without budgets
      if (!item.budgetId || item.limit <= 0) continue;

      const localizedName = getLocalizedCategoryName({
        name: item.categoryName,
        name_en: item.categoryNameEn,
        name_fr: null,
      }, locale) || item.categoryName;

      const percentUsed = item.utilization * 100;
      const projectedTotal = item.projectedTotal || (item.actualSpent + item.forecasted);
      const overage = projectedTotal - item.limit;

      // Budget already exceeded
      if (item.status === 'exceeded') {
        budgetAlerts.push({
          action_type: 'budget_overrun',
          trigger_category_id: item.categoryDefinitionId,
          severity: 'critical',
          title: `Budget exceeded: ${localizedName}`,
          description: `Your ${localizedName} budget is ${Math.round(percentUsed)}% used (₪${Math.round(item.actualSpent)}/₪${Math.round(item.limit)}). Projected month-end: ₪${Math.round(projectedTotal)} - exceeding by ₪${Math.round(overage)}.${item.nextLikelyHitDate ? ` Next expense expected: ${item.nextLikelyHitDate.split('T')[0]}.` : ''}`,
          metadata: JSON.stringify({
            budget_id: item.budgetId,
            budget_limit: item.limit,
            spent_amount: item.actualSpent,
            forecasted: item.forecasted,
            projected_total: projectedTotal,
            overage: Math.max(0, overage),
            percent_used: Math.round(percentUsed),
            status: item.status,
            risk: item.risk,
            next_hit_date: item.nextLikelyHitDate,
            actions: item.actions || [],
          }),
          potential_impact: -Math.max(0, overage),
          detection_confidence: 1.0,
        });
      }
      // At risk of exceeding (based on forecast)
      else if (item.status === 'at_risk' || overage > 0) {
        budgetAlerts.push({
          action_type: 'budget_overrun',
          trigger_category_id: item.categoryDefinitionId,
          severity: item.risk >= 0.7 ? 'high' : 'medium',
          title: `Budget warning: ${localizedName}`,
          description: `Your ${localizedName} spending is at ${Math.round(percentUsed)}% (₪${Math.round(item.actualSpent)}/₪${Math.round(item.limit)}). Based on spending patterns, you're projected to reach ₪${Math.round(projectedTotal)} by month-end${overage > 0 ? `, exceeding budget by ₪${Math.round(overage)}` : ''}.${item.nextLikelyHitDate ? ` Next charge expected: ${item.nextLikelyHitDate.split('T')[0]}.` : ''}`,
          metadata: JSON.stringify({
            budget_id: item.budgetId,
            budget_limit: item.limit,
            spent_amount: item.actualSpent,
            forecasted: item.forecasted,
            projected_total: projectedTotal,
            projected_overage: Math.max(0, overage),
            percent_used: Math.round(percentUsed),
            status: item.status,
            risk: item.risk,
            alert_threshold: item.alertThreshold,
            next_hit_date: item.nextLikelyHitDate,
            actions: item.actions || [],
          }),
          potential_impact: -Math.max(0, overage),
          detection_confidence: 0.85,
        });
      }
    }

    return budgetAlerts;
  } catch (error) {
    console.error('Failed to detect budget overruns:', error);
    return [];
  }
}

/**
 * Generate all smart action items
 */
async function generateSmartActions(params = {}) {
  const { months = 1, force = false, locale } = params;

  const allActions = [];

  // Heavy forecast call (patterns + budget outlook) – fetch once and share
  let sharedForecastData = null;
  try {
    sharedForecastData = await forecastService.getForecast({ months: 6 });
  } catch (err) {
    console.error('Smart Actions: failed to load shared forecast data, continuing with on-demand calls', err);
  }

  // Run all detection algorithms in parallel (mix of legacy and forecast-based)
  // Use allSettled to prevent one failure from breaking all detections
  const results = await Promise.allSettled([
    detectCategoryAnomalies({ months, locale, forecastData: sharedForecastData }),
    detectFixedCategoryVariations({ months, locale }),
    detectUnusualPurchases({ months, locale }),
    detectBudgetOverruns({ locale, forecastData: sharedForecastData }), // Now uses forecast data
    detectFixedRecurringAnomalies({ locale, forecastData: sharedForecastData }), // New: forecast-based
    detectOptimizationOpportunities({ locale, forecastData: sharedForecastData }), // New: forecast-based
  ]);

  // Extract fulfilled results, use empty array for rejected
  const [
    anomalies,
    fixedVariations,
    unusualPurchases,
    budgetOverruns,
    fixedRecurringAnomalies,
    optimizationOpportunities
  ] = results.map(r => r.status === 'fulfilled' ? r.value : []);

  allActions.push(
    ...anomalies, 
    ...fixedVariations, 
    ...unusualPurchases, 
    ...budgetOverruns,
    ...fixedRecurringAnomalies,
    ...optimizationOpportunities
  );

  // Save to database (avoid duplicates using recurrence_key)
  const client = await database.getClient();
  let created = 0;
  let skipped = 0;

  try {
    // If force is true, clear stale active items for this month before inserting new ones
    if (force) {
      const now = new Date();
      const recurrencePrefix = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
      await client.query(
        `DELETE FROM smart_action_items
         WHERE user_status NOT IN ('resolved', 'dismissed')
           AND recurrence_key LIKE '%' || $1` ,
        [recurrencePrefix]
      );
    }

    for (const action of allActions) {
      // Generate recurrence key with year and month to prevent year-over-year conflicts
      const currentDate = new Date();
      const recurrenceKey = `${action.action_type}_${action.trigger_category_id}_${currentDate.getFullYear()}_${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

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
        fixed_recurring_anomalies: fixedRecurringAnomalies.length,
        optimization_opportunities: optimizationOpportunities.length,
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
  const { status = 'active', severity, actionType, locale: localeInput } = params;
  const locale = resolveLocale(localeInput);

  const client = await database.getClient();

  try {
    let query = `
      SELECT
        sai.*,
        cd.name as category_name,
        cd.name_en as category_name_en,
        cd.name_fr as category_name_fr,
        parent.name as parent_category_name,
        parent.name_en as parent_category_name_en,
        parent.name_fr as parent_category_name_fr
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

    const actions = result.rows.map(row => {
      const localizedCategoryName = getLocalizedCategoryName({
        name: row.category_name,
        name_en: row.category_name_en,
        name_fr: row.category_name_fr,
      }, locale) || row.category_name;

      const localizedParentName = getLocalizedCategoryName({
        name: row.parent_category_name,
        name_en: row.parent_category_name_en,
        name_fr: row.parent_category_name_fr,
      }, locale) || row.parent_category_name;

      let title = row.title;
      let description = row.description;
      if (title && row.category_name && localizedCategoryName && localizedCategoryName !== row.category_name) {
        title = title.replace(row.category_name, localizedCategoryName);
      }
      if (description && row.category_name && localizedCategoryName && localizedCategoryName !== row.category_name) {
        description = description.replace(row.category_name, localizedCategoryName);
      }

      return {
        ...row,
        title,
        description,
        category_name: localizedCategoryName,
        parent_category_name: localizedParentName,
        category_name_he: row.category_name,
        category_name_fr: row.category_name_fr,
        parent_category_name_he: row.parent_category_name,
        parent_category_name_fr: row.parent_category_name_fr,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      };
    });

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

// ============================================================================
// QUEST SYSTEM FUNCTIONS
// ============================================================================

/**
 * Get count of active/accepted quests
 */
async function getActiveQuestCount(client) {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM smart_action_items
    WHERE action_type LIKE 'quest_%'
      AND user_status IN ('active', 'accepted')
  `);
  return parseInt(result.rows[0]?.count || 0, 10);
}

/**
 * Generate quests based on forecast patterns and spending analysis
 * Respects MAX_ACTIVE_QUESTS limit and triggers on-demand when below MIN_QUESTS_BEFORE_GENERATION
 */
async function generateQuests(params = {}) {
  const { locale, force = false, forecastData: injectedForecast } = params;
  const quests = [];

  let client;
  try {
    client = await database.getClient();

    // Check current active quest count
    const activeCount = await getActiveQuestCount(client);
    if (activeCount >= MAX_ACTIVE_QUESTS && !force) {
      return {
        success: true,
        message: `Maximum active quests reached (${MAX_ACTIVE_QUESTS})`,
        created: 0,
        active_count: activeCount,
      };
    }

    const slotsAvailable = MAX_ACTIVE_QUESTS - activeCount;

    // Get forecast data
    const forecastData = injectedForecast || await forecastService.getForecast({ months: 6 });
    const patterns = forecastData?.patterns || [];
    const budgetOutlook = forecastData?.budgetOutlook || [];

    // Get spending category mappings to check variability types
    const mappingsResult = await client.query(`
      SELECT scm.category_definition_id, scm.variability_type, cd.name, cd.name_en
      FROM spending_category_mappings scm
      JOIN category_definitions cd ON scm.category_definition_id = cd.id
      WHERE cd.is_active = 1
    `);
    const variabilityMap = new Map();
    for (const row of mappingsResult.rows) {
      variabilityMap.set(row.category_definition_id, {
        variabilityType: row.variability_type,
        name: row.name,
        nameEn: row.name_en,
      });
    }

    // Quest Type 1: Reduce variable/seasonal spending
    const variablePatterns = patterns.filter(p => {
      const mapping = variabilityMap.get(p.categoryDefinitionId);
      const isActionable = !p.isFixedRecurring && !p.isFixedAmount;
      const hasEnoughHistory = (p.monthsOfHistory || 0) >= 2;
      const meaningfulSpending = (p.avgAmount || 0) >= 100;
      const isVariable = mapping?.variabilityType === 'variable' || mapping?.variabilityType === 'seasonal' || isActionable;
      return isVariable && hasEnoughHistory && meaningfulSpending;
    });

    // Sort by potential impact (higher spending = more potential savings)
    variablePatterns.sort((a, b) => (b.avgAmount || 0) - (a.avgAmount || 0));

    for (const pattern of variablePatterns.slice(0, 3)) {
      if (quests.length >= slotsAvailable) break;

      // Determine reduction target based on variance
      const cv = pattern.coefficientOfVariation || 0.3;
      const reductionPct = cv > 0.5 ? 20 : cv > 0.3 ? 15 : 10;
      const difficulty = determineQuestDifficulty(reductionPct, pattern.confidence || 0.7);
      const durationDays = reductionPct >= 20 ? 30 : 7; // Harder reductions get more time
      const points = calculateQuestPoints(durationDays, difficulty, reductionPct);

      const localizedName = getLocalizedCategoryName({
        name: pattern.categoryName,
        name_en: pattern.categoryNameEn,
        name_fr: null,
      }, locale) || pattern.categoryName;

      const targetAmount = Math.round((pattern.avgAmount || 0) * (1 - reductionPct / 100));

      quests.push({
        action_type: 'quest_reduce_spending',
        trigger_category_id: pattern.categoryDefinitionId,
        severity: 'low',
        title: `Reduce ${localizedName} spending by ${reductionPct}%`,
        description: `Challenge: Keep your ${localizedName} spending under ₪${targetAmount} this ${durationDays === 7 ? 'week' : 'month'}. Your average is ₪${Math.round(pattern.avgAmount || 0)}.`,
        metadata: JSON.stringify({
          quest_type: 'reduce_spending',
          target_amount: targetAmount,
          current_average: pattern.avgAmount,
          reduction_pct: reductionPct,
          pattern_confidence: pattern.confidence,
          variability_type: variabilityMap.get(pattern.categoryDefinitionId)?.variabilityType || 'variable',
        }),
        completion_criteria: JSON.stringify({
          type: 'spending_limit',
          category_definition_id: pattern.categoryDefinitionId,
          target_amount: targetAmount,
          comparison: 'less_than',
        }),
        quest_difficulty: difficulty,
        quest_duration_days: durationDays,
        points_reward: points,
        potential_impact: Math.round((pattern.avgAmount || 0) * reductionPct / 100),
        detection_confidence: pattern.confidence || 0.7,
      });
    }

    // Quest Type 2: Budget adherence for at-risk categories
    const atRiskBudgets = budgetOutlook.filter(item =>
      item.budgetId &&
      (item.status === 'at_risk' || item.risk >= 0.5) &&
      item.limit > 0
    );

    for (const item of atRiskBudgets.slice(0, 2)) {
      if (quests.length >= slotsAvailable) break;

      // Already have a quest for this category?
      if (quests.find(q => q.trigger_category_id === item.categoryDefinitionId)) continue;

      const difficulty = item.risk >= 0.8 ? 'hard' : item.risk >= 0.6 ? 'medium' : 'easy';
      const durationDays = 7; // Weekly adherence check
      const points = calculateQuestPoints(durationDays, difficulty, 15);

      const localizedName = getLocalizedCategoryName({
        name: item.categoryName,
        name_en: item.categoryNameEn,
        name_fr: null,
      }, locale) || item.categoryName;

      const remainingBudget = Math.max(0, item.limit - item.actualSpent);

      quests.push({
        action_type: 'quest_budget_adherence',
        trigger_category_id: item.categoryDefinitionId,
        severity: 'medium',
        title: `Stay on budget: ${localizedName}`,
        description: `Challenge: Keep ${localizedName} within your ₪${Math.round(item.limit)} budget this week. You have ₪${Math.round(remainingBudget)} remaining.`,
        metadata: JSON.stringify({
          quest_type: 'budget_adherence',
          budget_id: item.budgetId,
          budget_limit: item.limit,
          current_spent: item.actualSpent,
          remaining: remainingBudget,
          risk_score: item.risk,
        }),
        completion_criteria: JSON.stringify({
          type: 'budget_adherence',
          category_definition_id: item.categoryDefinitionId,
          budget_id: item.budgetId,
          target_limit: item.limit,
          comparison: 'less_than_or_equal',
        }),
        quest_difficulty: difficulty,
        quest_duration_days: durationDays,
        points_reward: points,
        potential_impact: Math.max(0, item.projectedTotal - item.limit),
        detection_confidence: 0.8,
      });
    }

    // Quest Type 3: Set budget for high-variance unbudgeted categories
    const unbudgetedHighVariance = patterns.filter(p =>
      p.monthsOfHistory >= 3 &&
      p.coefficientOfVariation > 0.4 &&
      (p.avgAmount || 0) > 100 &&
      !budgetOutlook.find(b => b.categoryDefinitionId === p.categoryDefinitionId && b.budgetId)
    );

    for (const pattern of unbudgetedHighVariance.slice(0, 2)) {
      if (quests.length >= slotsAvailable) break;
      if (quests.find(q => q.trigger_category_id === pattern.categoryDefinitionId)) continue;

      const difficulty = 'easy'; // Setting a budget is easy
      const durationDays = 7;
      const points = calculateQuestPoints(durationDays, difficulty, 5);

      const localizedName = getLocalizedCategoryName({
        name: pattern.categoryName,
        name_en: pattern.categoryNameEn,
        name_fr: null,
      }, locale) || pattern.categoryName;

      const suggestedBudget = Math.round((pattern.avgAmount || 0) * 1.1);

      quests.push({
        action_type: 'quest_set_budget',
        trigger_category_id: pattern.categoryDefinitionId,
        severity: 'low',
        title: `Set a budget for ${localizedName}`,
        description: `Your ${localizedName} spending varies a lot (₪${Math.round(pattern.minAmount || 0)}-₪${Math.round(pattern.maxAmount || 0)}). Set a budget around ₪${suggestedBudget} to gain control.`,
        metadata: JSON.stringify({
          quest_type: 'set_budget',
          suggested_budget: suggestedBudget,
          avg_monthly: pattern.avgAmount,
          min_amount: pattern.minAmount,
          max_amount: pattern.maxAmount,
          coefficient_of_variation: pattern.coefficientOfVariation,
        }),
        completion_criteria: JSON.stringify({
          type: 'budget_exists',
          category_definition_id: pattern.categoryDefinitionId,
        }),
        quest_difficulty: difficulty,
        quest_duration_days: durationDays,
        points_reward: points,
        potential_impact: 0,
        detection_confidence: 0.9,
      });
    }

    // Quest Type 4: Reduce fixed costs (review subscriptions, insurance, etc.)
    const fixedPatterns = patterns.filter(p => {
      const mapping = variabilityMap.get(p.categoryDefinitionId);
      const isFixed = p.isFixedRecurring || p.isFixedAmount || mapping?.variabilityType === 'fixed';
      const meaningful = (p.avgAmount || 0) >= 50;
      const hasHistory = (p.monthsOfHistory || 0) >= 3;
      return isFixed && meaningful && hasHistory;
    });

    // Sort by amount (higher = more savings potential)
    fixedPatterns.sort((a, b) => (b.avgAmount || 0) - (a.avgAmount || 0));

    for (const pattern of fixedPatterns.slice(0, 2)) {
      if (quests.length >= slotsAvailable) break;
      if (quests.find(q => q.trigger_category_id === pattern.categoryDefinitionId)) continue;

      const difficulty = 'medium'; // Requires negotiation/switching
      const durationDays = 30; // Give time to find alternatives
      const points = calculateQuestPoints(durationDays, difficulty, 10);

      const localizedName = getLocalizedCategoryName({
        name: pattern.categoryName,
        name_en: pattern.categoryNameEn,
        name_fr: null,
      }, locale) || pattern.categoryName;

      quests.push({
        action_type: 'quest_reduce_fixed_cost',
        trigger_category_id: pattern.categoryDefinitionId,
        severity: 'low',
        title: `Review & reduce: ${localizedName}`,
        description: `You pay ₪${Math.round(pattern.avgAmount || 0)}/month for ${localizedName}. Review if you can find a better deal or negotiate a lower rate.`,
        metadata: JSON.stringify({
          quest_type: 'reduce_fixed_cost',
          current_amount: pattern.avgAmount,
          is_fixed_recurring: pattern.isFixedRecurring,
        }),
        completion_criteria: JSON.stringify({
          type: 'fixed_cost_reduction',
          category_definition_id: pattern.categoryDefinitionId,
          baseline_amount: pattern.avgAmount,
          comparison: 'less_than',
        }),
        quest_difficulty: difficulty,
        quest_duration_days: durationDays,
        points_reward: points,
        potential_impact: Math.round((pattern.avgAmount || 0) * 0.1), // Assume 10% savings potential
        detection_confidence: 0.7,
      });
    }

    // Quest Type 5: Savings target from under-budget surplus
    const underBudget = budgetOutlook.filter(item =>
      item.budgetId &&
      item.status === 'on_track' &&
      item.limit > 0 &&
      item.projectedTotal < item.limit * 0.7
    );

    if (underBudget.length > 0 && quests.length < slotsAvailable) {
      const totalSurplus = underBudget.reduce((sum, item) => sum + (item.limit - item.projectedTotal), 0);
      if (totalSurplus >= 100) {
        const savingsTarget = Math.round(totalSurplus * 0.5); // Target 50% of projected surplus
        const difficulty = savingsTarget >= 500 ? 'hard' : savingsTarget >= 200 ? 'medium' : 'easy';
        const durationDays = 30;
        const points = calculateQuestPoints(durationDays, difficulty, 20);

        quests.push({
          action_type: 'quest_savings_target',
          trigger_category_id: null,
          severity: 'low',
          title: `Save ₪${savingsTarget} this month`,
          description: `Based on your under-budget categories, you could save an extra ₪${savingsTarget}. Transfer this to savings before month-end.`,
          metadata: JSON.stringify({
            quest_type: 'savings_target',
            target_amount: savingsTarget,
            total_surplus: totalSurplus,
            contributing_categories: underBudget.map(item => ({
              id: item.categoryDefinitionId,
              name: item.categoryName,
              surplus: item.limit - item.projectedTotal,
            })),
          }),
          completion_criteria: JSON.stringify({
            type: 'savings_transfer',
            target_amount: savingsTarget,
            comparison: 'greater_than_or_equal',
          }),
          quest_difficulty: difficulty,
          quest_duration_days: durationDays,
          points_reward: points,
          potential_impact: savingsTarget,
          detection_confidence: 0.75,
        });
      }
    }

    // Save quests to database
    let created = 0;
    const now = new Date();
    const recurrencePrefix = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;

    for (const quest of quests) {
      const recurrenceKey = `${quest.action_type}_${quest.trigger_category_id || 'global'}_${recurrencePrefix}`;

      // Check for existing quest
      const existingResult = await client.query(`
        SELECT id FROM smart_action_items
        WHERE recurrence_key = $1 AND user_status NOT IN ('resolved', 'dismissed', 'failed')
      `, [recurrenceKey]);

      if (existingResult.rows.length > 0 && !force) continue;

      await client.query(`
        INSERT INTO smart_action_items (
          action_type, trigger_category_id, severity, title, description,
          metadata, completion_criteria, quest_difficulty, quest_duration_days,
          points_reward, potential_impact, detection_confidence, recurrence_key, is_recurring
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0)
      `, [
        quest.action_type,
        quest.trigger_category_id,
        quest.severity,
        quest.title,
        quest.description,
        quest.metadata,
        quest.completion_criteria,
        quest.quest_difficulty,
        quest.quest_duration_days,
        quest.points_reward,
        quest.potential_impact,
        quest.detection_confidence,
        recurrenceKey,
      ]);

      created++;
    }

    return {
      success: true,
      total_generated: quests.length,
      created,
      active_count: activeCount + created,
      slots_remaining: slotsAvailable - created,
    };
  } catch (error) {
    console.error('Failed to generate quests:', error);
    return { success: false, error: error.message };
  } finally {
    if (client) client.release();
  }
}

/**
 * Accept a quest - sets deadline and marks as accepted
 */
async function acceptQuest(questId) {
  const client = await database.getClient();

  try {
    // Get the quest
    const questResult = await client.query(`
      SELECT * FROM smart_action_items WHERE id = $1
    `, [questId]);

    if (questResult.rows.length === 0) {
      throw new Error('Quest not found');
    }

    const quest = questResult.rows[0];

    if (!quest.action_type.startsWith('quest_')) {
      throw new Error('This action item is not a quest');
    }

    if (quest.user_status !== 'active') {
      throw new Error(`Quest cannot be accepted (current status: ${quest.user_status})`);
    }

    // Check active quest limit
    const activeCount = await getActiveQuestCount(client);
    if (activeCount >= MAX_ACTIVE_QUESTS) {
      throw new Error(`Maximum active quests reached (${MAX_ACTIVE_QUESTS})`);
    }

    // Calculate deadline
    const now = new Date();
    const deadline = new Date(now);
    deadline.setDate(deadline.getDate() + (quest.quest_duration_days || 7));

    await client.query(`
      UPDATE smart_action_items
      SET user_status = 'accepted',
          accepted_at = datetime('now'),
          deadline = $2
      WHERE id = $1
    `, [questId, deadline.toISOString()]);

    // Add to history
    await client.query(`
      INSERT INTO action_item_history (smart_action_item_id, action, previous_status, new_status)
      VALUES ($1, 'accepted', 'active', 'accepted')
    `, [questId]);

    return {
      success: true,
      quest_id: questId,
      deadline: deadline.toISOString(),
      points_reward: quest.points_reward,
    };
  } finally {
    client.release();
  }
}

/**
 * Decline a quest
 */
async function declineQuest(questId) {
  const client = await database.getClient();

  try {
    const questResult = await client.query(`
      SELECT * FROM smart_action_items WHERE id = $1
    `, [questId]);

    if (questResult.rows.length === 0) {
      throw new Error('Quest not found');
    }

    const quest = questResult.rows[0];

    if (!quest.action_type.startsWith('quest_')) {
      throw new Error('This action item is not a quest');
    }

    await client.query(`
      UPDATE smart_action_items
      SET user_status = 'dismissed',
          dismissed_at = datetime('now')
      WHERE id = $1
    `, [questId]);

    // Update user stats
    await client.query(`
      UPDATE user_quest_stats
      SET quests_declined = quests_declined + 1
      WHERE id = 1
    `);

    // Add to history
    await client.query(`
      INSERT INTO action_item_history (smart_action_item_id, action, previous_status, new_status)
      VALUES ($1, 'dismissed', $2, 'dismissed')
    `, [questId, quest.user_status]);

    return { success: true, quest_id: questId };
  } finally {
    client.release();
  }
}

/**
 * Verify quest completion and award points
 */
async function verifyQuestCompletion(questId, manualResult = null) {
  const client = await database.getClient();

  try {
    const questResult = await client.query(`
      SELECT * FROM smart_action_items WHERE id = $1
    `, [questId]);

    if (questResult.rows.length === 0) {
      throw new Error('Quest not found');
    }

    const quest = questResult.rows[0];

    if (!quest.action_type.startsWith('quest_')) {
      throw new Error('This action item is not a quest');
    }

    if (quest.user_status !== 'accepted') {
      throw new Error(`Quest cannot be verified (current status: ${quest.user_status})`);
    }

    const criteria = quest.completion_criteria ? JSON.parse(quest.completion_criteria) : null;
    let actualValue = null;
    let success = false;
    let achievementPct = 0;

    // Auto-verify based on criteria type
    if (criteria) {
      switch (criteria.type) {
        case 'spending_limit': {
          // Get actual spending for the quest period
          const startDate = quest.accepted_at;
          const endDate = quest.deadline || new Date().toISOString();

          const spendingResult = await client.query(`
            SELECT COALESCE(SUM(ABS(price)), 0) as total_spent
            FROM transactions
            WHERE category_definition_id = $1
              AND date >= $2 AND date <= $3
              AND price < 0
          `, [criteria.category_definition_id, startDate.split('T')[0], endDate.split('T')[0]]);

          actualValue = parseFloat(spendingResult.rows[0]?.total_spent || 0);
          success = actualValue <= criteria.target_amount;
          achievementPct = criteria.target_amount > 0 ? Math.round((1 - actualValue / criteria.target_amount) * 100 + 100) : 100;
          break;
        }

        case 'budget_adherence': {
          const spendingResult = await client.query(`
            SELECT COALESCE(SUM(ABS(price)), 0) as total_spent
            FROM transactions
            WHERE category_definition_id = $1
              AND date >= $2 AND date <= $3
              AND price < 0
          `, [criteria.category_definition_id, quest.accepted_at.split('T')[0], (quest.deadline || new Date().toISOString()).split('T')[0]]);

          actualValue = parseFloat(spendingResult.rows[0]?.total_spent || 0);
          success = actualValue <= criteria.target_limit;
          achievementPct = criteria.target_limit > 0 ? Math.round((1 - actualValue / criteria.target_limit) * 100 + 100) : 100;
          break;
        }

        case 'budget_exists': {
          const budgetResult = await client.query(`
            SELECT id FROM category_budgets
            WHERE category_definition_id = $1 AND is_active = 1
          `, [criteria.category_definition_id]);

          actualValue = budgetResult.rows.length > 0 ? 1 : 0;
          success = budgetResult.rows.length > 0;
          achievementPct = success ? 100 : 0;
          break;
        }

        case 'fixed_cost_reduction': {
          // Compare recent spending to baseline
          const recentResult = await client.query(`
            SELECT AVG(ABS(price)) as avg_recent
            FROM transactions
            WHERE category_definition_id = $1
              AND date >= $2
              AND price < 0
          `, [criteria.category_definition_id, quest.accepted_at.split('T')[0]]);

          actualValue = parseFloat(recentResult.rows[0]?.avg_recent || criteria.baseline_amount);
          success = actualValue < criteria.baseline_amount;
          achievementPct = success ? Math.round((1 - actualValue / criteria.baseline_amount) * 100 + 100) : 0;
          break;
        }

        case 'savings_transfer': {
          // Manual verification required for savings
          if (manualResult !== null) {
            actualValue = manualResult.amount || 0;
            success = actualValue >= criteria.target_amount;
            achievementPct = criteria.target_amount > 0 ? Math.round((actualValue / criteria.target_amount) * 100) : 100;
          }
          break;
        }
      }
    }

    // If manual result provided, use it
    if (manualResult !== null && typeof manualResult === 'object') {
      if ('success' in manualResult) success = manualResult.success;
      if ('actualValue' in manualResult) actualValue = manualResult.actualValue;
      if ('achievementPct' in manualResult) achievementPct = manualResult.achievementPct;
    }

    // Calculate points earned (partial credit)
    let pointsEarned = 0;
    if (success) {
      if (achievementPct >= 120) {
        pointsEarned = Math.round(quest.points_reward * 1.25); // Bonus
      } else {
        pointsEarned = quest.points_reward;
      }
    } else if (achievementPct >= 80) {
      pointsEarned = Math.round(quest.points_reward * 0.5); // Partial credit
    }

    const newStatus = success || achievementPct >= 80 ? 'resolved' : 'failed';
    const completionResult = JSON.stringify({
      success,
      actual_value: actualValue,
      achievement_pct: achievementPct,
      points_earned: pointsEarned,
      verified_at: new Date().toISOString(),
    });

    // Update quest
    await client.query(`
      UPDATE smart_action_items
      SET user_status = $2,
          resolved_at = datetime('now'),
          points_earned = $3,
          completion_result = $4
      WHERE id = $1
    `, [questId, newStatus, pointsEarned, completionResult]);

    // Update user stats
    if (pointsEarned > 0) {
      await client.query(`
        UPDATE user_quest_stats
        SET total_points = total_points + $1,
            quests_completed = quests_completed + 1,
            current_streak = current_streak + 1,
            best_streak = MAX(best_streak, current_streak + 1),
            last_completed_at = datetime('now'),
            level = $2
        WHERE id = 1
      `, [pointsEarned, 'PLACEHOLDER']); // Level calculated below

      // Recalculate level
      const statsResult = await client.query(`SELECT total_points FROM user_quest_stats WHERE id = 1`);
      const totalPoints = parseInt(statsResult.rows[0]?.total_points || 0, 10);
      const newLevel = calculateLevel(totalPoints);

      await client.query(`UPDATE user_quest_stats SET level = $1 WHERE id = 1`, [newLevel]);
    } else {
      await client.query(`
        UPDATE user_quest_stats
        SET quests_failed = quests_failed + 1,
            current_streak = 0
        WHERE id = 1
      `);
    }

    // Add to history
    await client.query(`
      INSERT INTO action_item_history (smart_action_item_id, action, previous_status, new_status, metadata)
      VALUES ($1, $2, 'accepted', $3, $4)
    `, [questId, newStatus === 'resolved' ? 'resolved' : 'failed', newStatus, completionResult]);

    return {
      success,
      quest_id: questId,
      points_earned: pointsEarned,
      achievement_pct: achievementPct,
      actual_value: actualValue,
      new_status: newStatus,
    };
  } finally {
    client.release();
  }
}

/**
 * Get active quests with progress calculation
 */
async function getActiveQuests(params = {}) {
  const { locale: localeInput } = params;
  const locale = resolveLocale(localeInput);
  const client = await database.getClient();

  try {
    const result = await client.query(`
      SELECT
        sai.*,
        cd.name as category_name,
        cd.name_en as category_name_en
      FROM smart_action_items sai
      LEFT JOIN category_definitions cd ON sai.trigger_category_id = cd.id
      WHERE sai.action_type LIKE 'quest_%'
        AND sai.user_status IN ('active', 'accepted')
      ORDER BY
        CASE sai.user_status WHEN 'accepted' THEN 1 ELSE 2 END,
        sai.deadline ASC NULLS LAST,
        sai.detected_at DESC
    `);

    const quests = [];
    const now = new Date();

    for (const row of result.rows) {
      const localizedName = row.category_name ? getLocalizedCategoryName({
        name: row.category_name,
        name_en: row.category_name_en,
        name_fr: null,
      }, locale) : null;

      // Calculate progress for accepted quests
      let progress = null;
      if (row.user_status === 'accepted' && row.completion_criteria) {
        const criteria = JSON.parse(row.completion_criteria);

        if (criteria.type === 'spending_limit' || criteria.type === 'budget_adherence') {
          const startDate = row.accepted_at;
          const spendingResult = await client.query(`
            SELECT COALESCE(SUM(ABS(price)), 0) as total_spent
            FROM transactions
            WHERE category_definition_id = $1
              AND date >= $2
              AND price < 0
          `, [criteria.category_definition_id, startDate.split('T')[0]]);

          const spent = parseFloat(spendingResult.rows[0]?.total_spent || 0);
          const target = criteria.target_amount || criteria.target_limit || 0;
          progress = {
            current: spent,
            target,
            percentage: target > 0 ? Math.round((spent / target) * 100) : 0,
            on_track: spent <= target,
          };
        }
      }

      // Calculate time remaining
      let timeRemaining = null;
      if (row.deadline) {
        const deadline = new Date(row.deadline);
        const diffMs = deadline - now;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        timeRemaining = {
          days: Math.max(0, diffDays),
          expired: diffDays < 0,
        };
      }

      quests.push({
        ...row,
        category_name: localizedName || row.category_name,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
        completion_criteria: row.completion_criteria ? JSON.parse(row.completion_criteria) : null,
        progress,
        time_remaining: timeRemaining,
      });
    }

    return { quests, count: quests.length };
  } finally {
    client.release();
  }
}

/**
 * Get user quest stats with streak reset check
 */
async function getUserQuestStats() {
  const client = await database.getClient();

  try {
    // Ensure stats row exists
    await client.query(`
      INSERT OR IGNORE INTO user_quest_stats (id, total_points, current_streak, best_streak, quests_completed, quests_failed, quests_declined, level)
      VALUES (1, 0, 0, 0, 0, 0, 0, 1)
    `);

    const result = await client.query(`SELECT * FROM user_quest_stats WHERE id = 1`);
    const stats = result.rows[0];

    // Check streak reset (30 days inactivity)
    if (stats.last_completed_at) {
      const lastCompleted = new Date(stats.last_completed_at);
      const now = new Date();
      const daysSinceCompletion = Math.floor((now - lastCompleted) / (1000 * 60 * 60 * 24));

      if (daysSinceCompletion > STREAK_RESET_DAYS && stats.current_streak > 0) {
        await client.query(`UPDATE user_quest_stats SET current_streak = 0 WHERE id = 1`);
        stats.current_streak = 0;
        stats.streak_reset = true;
      }
    }

    // Calculate next level info
    const currentLevel = stats.level;
    const nextLevelTier = LEVEL_TIERS.find(t => t.level === currentLevel + 1);
    const currentLevelTier = LEVEL_TIERS.find(t => t.level === currentLevel);

    return {
      ...stats,
      level_progress: nextLevelTier ? {
        current_level: currentLevel,
        next_level: currentLevel + 1,
        points_for_next: nextLevelTier.points,
        points_needed: nextLevelTier.points - stats.total_points,
        progress_pct: Math.round(((stats.total_points - (currentLevelTier?.points || 0)) / (nextLevelTier.points - (currentLevelTier?.points || 0))) * 100),
      } : {
        current_level: currentLevel,
        max_level_reached: true,
      },
    };
  } finally {
    client.release();
  }
}

/**
 * Check quest deadlines and auto-verify expired quests
 */
async function checkQuestDeadlines() {
  const client = await database.getClient();
  const results = { verified: 0, failed: 0, errors: [] };

  try {
    // Find accepted quests past deadline
    const expiredResult = await client.query(`
      SELECT id FROM smart_action_items
      WHERE action_type LIKE 'quest_%'
        AND user_status = 'accepted'
        AND deadline < datetime('now')
    `);

    for (const row of expiredResult.rows) {
      try {
        const result = await verifyQuestCompletion(row.id);
        if (result.success || result.points_earned > 0) {
          results.verified++;
        } else {
          results.failed++;
        }
      } catch (err) {
        results.errors.push({ quest_id: row.id, error: err.message });
      }
    }

    // Trigger on-demand quest generation if below threshold
    const activeCount = await getActiveQuestCount(client);
    let generated = 0;
    if (activeCount < MIN_QUESTS_BEFORE_GENERATION) {
      const genResult = await generateQuests({});
      generated = genResult.created || 0;
    }

    return {
      ...results,
      checked: expiredResult.rows.length,
      active_quests: activeCount,
      new_quests_generated: generated,
    };
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
  // Quest system exports
  generateQuests,
  acceptQuest,
  declineQuest,
  verifyQuestCompletion,
  getActiveQuests,
  getUserQuestStats,
  checkQuestDeadlines,
  // Constants for external use
  QUEST_ACTION_TYPES,
  LEVEL_TIERS,
  MAX_ACTIVE_QUESTS,
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
