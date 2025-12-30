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
 * Calculate average monthly spend over a longer window (default 6 months)
 */
async function getCategoryMonthlyAverage(client, categoryDefinitionId, endDate, monthsBack = 6) {
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - monthsBack);

  const result = await client.query(`
    SELECT
      SUM(ABS(t.price)) as total_amount
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
    WHERE t.category_definition_id IN (SELECT id FROM category_tree)
      AND t.date >= $2 AND t.date <= $3
      AND t.price < 0
      AND ap.id IS NULL
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
      WHERE t.category_definition_id IN (SELECT id FROM category_tree)
        AND t.date >= $2 AND t.date <= $3
        AND t.price < 0
        AND ap.id IS NULL
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
        WHERE t.category_definition_id IN (${placeholders})
          AND t.status = 'completed'
          AND t.category_type = 'expense'
          AND t.price < 0
          AND ap.id IS NULL
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
