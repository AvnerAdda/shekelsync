/**
 * Quest System Service
 *
 * Generates gamified financial challenges based on:
 * - Forecast patterns and spending analysis
 * - Budget outlook and risk assessment
 * - Category variability types
 *
 * Supports quest lifecycle: generate → accept → track → verify
 */

const actualDatabase = require('../database.js');
const { resolveLocale, getLocalizedCategoryName, getQuestText, getLocalizedPeriodLabel, getLocalizedAverageLabel } = require('../../../lib/server/locale-utils.js');
const forecastService = require('../forecast.js');
const { getBehavioralPatterns } = require('./behavioral.js');

let database = actualDatabase;

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

// Merchants to exclude from quest generation (essential services)
const EXCLUDED_MERCHANT_PATTERNS = [
  /סופרמרקט/i,
  /supermarket/i,
  /pharmacy/i,
  /בית מרקחת/i,
  /gas station/i,
  /תחנת דלק/i,
];

const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;
const AVG_WEEKS_PER_MONTH = 4.33;
const MIN_BASELINE_WEEKLY = 150;
const MIN_BASELINE_MONTHLY = 400;
const MIN_FIXED_MONTHLY = 100;
const MIN_DAYS_FOR_BUDGET_QUEST = 5;
const STABILITY_LOOKBACK_WEEKS = 12;
const STABILITY_LOOKBACK_MONTHS = 6;
const STABLE_RELATIVE_SPREAD_THRESHOLD = 0.12;
const STABLE_CV_THRESHOLD = 0.15;
const STABLE_MIN_SPEND_SHARE = 0.6;

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;

  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
}

function coerceNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function computeWeeklyBaselineStats(weeklyTotals) {
  const totals = Array.isArray(weeklyTotals) ? weeklyTotals.map(coerceNumber) : [];
  const weeksWithSpend = totals.filter((amount) => amount > 0).length;

  const baselineWeeklyMedian = median(totals);

  const deviations = totals.map((amount) => Math.abs(amount - baselineWeeklyMedian));
  const medianAbsoluteDeviation = median(deviations);
  const medianRelativeSpread =
    baselineWeeklyMedian === 0 ? (medianAbsoluteDeviation === 0 ? 0 : 1) : medianAbsoluteDeviation / baselineWeeklyMedian;

  const spendShare = totals.length === 0 ? 0 : weeksWithSpend / totals.length;
  const isSporadic = baselineWeeklyMedian === 0 ? weeksWithSpend <= 2 : spendShare <= 0.25;
  const isStable = !isSporadic && baselineWeeklyMedian > 0 && medianRelativeSpread <= 0.1;

  return {
    baselineWeeklyMedian,
    medianRelativeSpread,
    weeksWithSpend,
    isSporadic,
    isStable,
  };
}

function resolveAvgOccurrencesPerWeek(pattern) {
  const perWeek = coerceNumber(pattern?.avgOccurrencesPerWeek);
  if (perWeek > 0) return perWeek;
  const perMonth = coerceNumber(pattern?.avgOccurrencesPerMonth);
  return perMonth > 0 ? perMonth / AVG_WEEKS_PER_MONTH : 0;
}

function resolveAvgOccurrencesPerMonth(pattern) {
  const perMonth = coerceNumber(pattern?.avgOccurrencesPerMonth);
  if (perMonth > 0) return perMonth;
  const perWeek = coerceNumber(pattern?.avgOccurrencesPerWeek);
  return perWeek > 0 ? perWeek * AVG_WEEKS_PER_MONTH : 0;
}

function resolveQuestDurationDays(pattern) {
  const patternType = pattern?.patternType;
  if (patternType === 'monthly' || patternType === 'bi-monthly') {
    return DAYS_PER_MONTH;
  }
  return DAYS_PER_WEEK;
}

function estimateMonthlySpend(pattern) {
  return resolveAvgOccurrencesPerMonth(pattern) * coerceNumber(pattern?.avgAmount);
}

function computeBaselineSpend(pattern, durationDays) {
  const avgAmount = coerceNumber(pattern?.avgAmount);
  const weeklySpend = resolveAvgOccurrencesPerWeek(pattern) * avgAmount;
  const monthlySpend = resolveAvgOccurrencesPerMonth(pattern) * avgAmount;
  return durationDays >= DAYS_PER_MONTH ? monthlySpend : weeklySpend;
}

function isBaselineMeaningful(baseline, durationDays) {
  const threshold = durationDays >= DAYS_PER_MONTH ? MIN_BASELINE_MONTHLY : MIN_BASELINE_WEEKLY;
  return baseline >= threshold;
}

function isPatternStale(pattern) {
  const daysSince = coerceNumber(pattern?.daysSinceLastOccurrence);
  if (!daysSince) return false;
  const patternType = pattern?.patternType;
  if (patternType === 'bi-monthly') return daysSince > 90;
  if (patternType === 'monthly') return daysSince > 60;
  return daysSince > 21;
}

function normalizeCategoryKey(value) {
  if (!value) return '';
  return String(value).trim().toLowerCase();
}

function resolveCategoryId(pattern, categoryIdByName) {
  const directId = Number(pattern?.categoryDefinitionId);
  if (Number.isFinite(directId) && directId > 0) {
    return directId;
  }

  const candidates = [
    pattern?.categoryName,
    pattern?.categoryNameEn,
    pattern?.categoryNameFr,
    pattern?.category,
  ];

  for (const candidate of candidates) {
    const key = normalizeCategoryKey(candidate);
    if (key && categoryIdByName.has(key)) {
      return categoryIdByName.get(key);
    }
  }

  return null;
}

function computeReductionPct(pattern) {
  const cv = coerceNumber(pattern?.coefficientOfVariation) || 0.35;
  const confidence = coerceNumber(pattern?.confidence) || 0.7;
  const monthsOfHistory = Math.max(1, coerceNumber(pattern?.monthsOfHistory));
  let reductionPct = cv > 0.6 ? 18 : cv > 0.4 ? 12 : 8;
  if (monthsOfHistory < 3) reductionPct -= 3;
  if (confidence < 0.6) reductionPct -= 2;
  if (pattern?.patternType === 'sporadic') reductionPct -= 2;
  return Math.max(5, Math.min(20, Math.round(reductionPct)));
}

function getDaysRemainingInMonth(now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const diffMs = endOfMonth - startOfToday;
  const daysRemaining = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, daysRemaining);
}

function computePeriodStability(periodTotals) {
  const totals = Array.isArray(periodTotals) ? periodTotals.map(coerceNumber) : [];
  if (totals.length === 0) {
    return {
      isStable: false,
      medianRelativeSpread: 0,
      coefficientOfVariation: 0,
      spendShare: 0,
      mean: 0,
      stdDev: 0,
    };
  }

  const mean = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  const variance = totals.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / totals.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = mean > 0 ? stdDev / mean : 0;

  const weeklyStats = computeWeeklyBaselineStats(totals);
  const spendShare = totals.length > 0 ? weeklyStats.weeksWithSpend / totals.length : 0;
  const isStable = mean > 0 &&
    spendShare >= STABLE_MIN_SPEND_SHARE &&
    weeklyStats.medianRelativeSpread <= STABLE_RELATIVE_SPREAD_THRESHOLD &&
    coefficientOfVariation <= STABLE_CV_THRESHOLD;

  return {
    isStable,
    medianRelativeSpread: weeklyStats.medianRelativeSpread,
    coefficientOfVariation,
    spendShare,
    mean,
    stdDev,
  };
}

function getWeekStart(dateInput) {
  const date = dateInput instanceof Date ? new Date(dateInput) : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getDay(); // 0=Sunday
  const diff = (day + 6) % 7; // days since Monday
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getWeekKey(dateInput) {
  const weekStart = getWeekStart(dateInput);
  if (!weekStart) return null;
  return weekStart.toISOString().slice(0, 10);
}

function getMonthKey(dateInput) {
  const date = dateInput instanceof Date ? new Date(dateInput) : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function buildWeekKeys(weeks) {
  const keys = [];
  let cursor = getWeekStart(new Date());
  if (!cursor) return keys;
  for (let i = 0; i < weeks; i += 1) {
    keys.push(getWeekKey(cursor));
    const next = new Date(cursor);
    next.setDate(next.getDate() - DAYS_PER_WEEK);
    cursor = next;
  }
  return keys.reverse();
}

function buildMonthKeys(months) {
  const keys = [];
  const now = new Date();
  let cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = 0; i < months; i += 1) {
    keys.push(getMonthKey(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
  }
  return keys.reverse();
}

function buildTotalsByCategory(rows, periodKeys, periodKeyFn, categoryIds) {
  const totalsByCategory = new Map();
  const keySet = new Set(periodKeys);

  for (const row of rows) {
    const categoryId = Number(row.category_definition_id);
    if (!Number.isFinite(categoryId)) continue;
    const key = periodKeyFn(row.date);
    if (!key || !keySet.has(key)) continue;
    const amount = Math.abs(coerceNumber(row.price));
    const categoryTotals = totalsByCategory.get(categoryId) || new Map();
    categoryTotals.set(key, (categoryTotals.get(key) || 0) + amount);
    totalsByCategory.set(categoryId, categoryTotals);
  }

  const result = new Map();
  for (const categoryId of categoryIds) {
    const categoryTotals = totalsByCategory.get(categoryId) || new Map();
    const totals = periodKeys.map((key) => categoryTotals.get(key) || 0);
    result.set(categoryId, totals);
  }

  return result;
}

function isExcludedCategoryName(name, nameEn) {
  const primary = String(name || '');
  const secondary = String(nameEn || '');
  const combinedLower = `${primary} ${secondary}`.toLowerCase();

  if (/פרעון/.test(primary) && /(כרטיס|אשראי)/.test(primary)) {
    return true;
  }

  if (/\b(rent|mortgage)\b/.test(combinedLower)) {
    return true;
  }

  if (/(credit\s*card\s*(payment|repayment)|card\s*repayment|cc\s*payment)/.test(combinedLower)) {
    return true;
  }

  if (/(loan|debt)\s*repayment/.test(combinedLower)) {
    return true;
  }

  return false;
}

/**
 * Check if a merchant name should be excluded from quest generation
 */
function isExcludedMerchant(merchantName) {
  if (!merchantName) return true;
  const name = String(merchantName).toLowerCase();
  return EXCLUDED_MERCHANT_PATTERNS.some(pattern => pattern.test(name));
}

/**
 * Generate merchant-specific quests based on high-frequency transactions
 * @param {Object} context - Quest generation context
 * @param {number} slotsAvailable - Available quest slots
 * @param {Object} client - Database client
 * @returns {Array} Generated merchant quests
 */
async function generateMerchantQuests(context, slotsAvailable, client) {
  if (slotsAvailable <= 0) return [];

  const { locale } = context;
  const quests = [];

  try {
    const behavioralData = await getBehavioralPatterns(locale);
    const { recurringPatterns } = behavioralData;

    if (!recurringPatterns || recurringPatterns.length === 0) {
      console.log('[Quests] No recurring patterns found for merchant quests');
      return [];
    }

    // Find high-frequency merchants (daily or weekly visits with meaningful spend)
    const targetMerchants = recurringPatterns
      .filter(p => p.frequency === 'daily' || p.frequency === 'weekly')
      .filter(p => (p.avgAmount || 0) * (p.occurrences || 0) > 200) // >200₪ monthly spend
      .filter(p => !isExcludedMerchant(p.name))
      .slice(0, 3);

    console.log('[Quests] Found', targetMerchants.length, 'potential merchant quest targets');

    for (const merchant of targetMerchants) {
      if (quests.length >= slotsAvailable) break;

      const rawOccurrences = coerceNumber(merchant.occurrences);
      const monthsObserved = Math.max(1, Math.round(coerceNumber(merchant.monthsObserved) || 3));
      const occurrencesPerMonth = coerceNumber(merchant.occurrencesPerMonth);
      const visitsPerMonth = occurrencesPerMonth > 0 ? occurrencesPerMonth : (rawOccurrences > 0 ? rawOccurrences / monthsObserved : 0);
      const baselineVisits = Math.max(1, Math.round(visitsPerMonth / AVG_WEEKS_PER_MONTH));
      if (baselineVisits < 2) {
        continue;
      }
      const targetVisits = Math.max(1, Math.ceil(baselineVisits * 0.6)); // Reduce by ~40%
      const reductionPct = Math.round((1 - targetVisits / baselineVisits) * 100);

      const difficulty = reductionPct >= 50 ? 'medium' : 'easy';
      const durationDays = 7; // Weekly challenge
      const points = calculateQuestPoints(durationDays, difficulty, reductionPct);

      const potentialSavings = Math.round((merchant.avgAmount || 0) * (baselineVisits - targetVisits));

      const questText = getQuestText('quest_merchant_limit', {
        merchantName: merchant.name,
        targetVisits,
        baselineVisits,
        potentialSavings,
      }, locale);

      quests.push({
        action_type: 'quest_merchant_limit',
        trigger_category_id: null,
        severity: 'low',
        title: questText.title,
        description: questText.description,
        metadata: JSON.stringify({
          quest_type: 'merchant_limit',
          merchant_name: merchant.name,
          merchant_frequency: merchant.frequency,
          baseline_visits: baselineVisits,
          target_visits: targetVisits,
          occurrences_per_month: occurrencesPerMonth,
          months_observed: monthsObserved,
          avg_transaction: merchant.avgAmount,
        }),
        completion_criteria: JSON.stringify({
          type: 'merchant_frequency_limit',
          merchant_pattern: merchant.name.toLowerCase(),
          max_transactions: targetVisits,
          baseline_transactions: baselineVisits,
        }),
        quest_difficulty: difficulty,
        quest_duration_days: durationDays,
        points_reward: points,
        potential_impact: potentialSavings,
        detection_confidence: 0.85,
      });
    }
  } catch (error) {
    console.error('[Quests] Error generating merchant quests:', error);
  }

  return quests;
}

/**
 * Generate weekend spending limit quests
 * @param {Object} context - Quest generation context
 * @param {number} slotsAvailable - Available quest slots
 * @param {Object} client - Database client
 * @returns {Array} Generated weekend quests
 */
async function generateWeekendQuests(context, slotsAvailable, client) {
  if (slotsAvailable <= 0) return [];

  const quests = [];

  try {
    // Get last 4 weeks of weekend spending (Friday evening + Saturday + Sunday)
    const weekendStats = await client.query(`
      SELECT
        AVG(weekly_total) as avg_weekend_spend,
        COUNT(*) as weeks_analyzed
      FROM (
        SELECT strftime('%Y-%W', date) as week, SUM(ABS(price)) as weekly_total
        FROM transactions
        WHERE date >= date('now', '-28 days')
          AND price < 0
          AND CAST(strftime('%w', date) AS INTEGER) IN (0, 5, 6)
        GROUP BY strftime('%Y-%W', date)
      )
    `);

    const avgWeekendSpend = parseFloat(weekendStats.rows[0]?.avg_weekend_spend || 0);
    const weeksAnalyzed = parseInt(weekendStats.rows[0]?.weeks_analyzed || 0, 10);

    console.log('[Quests] Weekend spending analysis:', { avgWeekendSpend, weeksAnalyzed });

    // Only generate if we have enough data and spending is significant
    if (weeksAnalyzed < 2 || avgWeekendSpend < 300) {
      console.log('[Quests] Not enough weekend data or spending too low for weekend quest');
      return [];
    }

    const reductionPct = 15;
    const targetAmount = Math.round(avgWeekendSpend * (1 - reductionPct / 100));

    const difficulty = avgWeekendSpend > 600 ? 'medium' : 'easy';
    const durationDays = 7;
    const points = calculateQuestPoints(durationDays, difficulty, reductionPct);

    const questText = getQuestText('quest_weekend_limit', {
      targetAmount,
      avgWeekendSpend: Math.round(avgWeekendSpend),
    }, context.locale);

    quests.push({
      action_type: 'quest_weekend_limit',
      trigger_category_id: null,
      severity: 'low',
      title: questText.title,
      description: questText.description,
      metadata: JSON.stringify({
        quest_type: 'weekend_limit',
        avg_weekend_spend: Math.round(avgWeekendSpend),
        target_weekend_spend: targetAmount,
        reduction_pct: reductionPct,
      }),
      completion_criteria: JSON.stringify({
        type: 'weekend_spending_limit',
        target_amount: targetAmount,
        baseline_amount: Math.round(avgWeekendSpend),
        days_of_week: [0, 5, 6], // Sunday, Friday, Saturday
      }),
      quest_difficulty: difficulty,
      quest_duration_days: durationDays,
      points_reward: points,
      potential_impact: Math.round(avgWeekendSpend - targetAmount),
      detection_confidence: 0.8,
    });
  } catch (error) {
    console.error('[Quests] Error generating weekend quests:', error);
  }

  return quests;
}

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
 * Get count of active/accepted quests
 */
async function getActiveQuestCount(client) {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM smart_action_items
    WHERE action_type LIKE 'quest_%'
      AND user_status = 'accepted'
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
    console.log('[Quests] Active quest count:', activeCount, 'MAX:', MAX_ACTIVE_QUESTS);
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
    console.log('[Quests] Forecast patterns count:', patterns.length, 'Budget outlook count:', budgetOutlook.length);

    // Get spending category mappings to check variability types
    const mappingsResult = await client.query(`
      SELECT scm.category_definition_id, scm.variability_type, cd.name, cd.name_en
      FROM spending_category_mappings scm
      JOIN category_definitions cd ON scm.category_definition_id = cd.id
      WHERE cd.is_active = 1
    `);
    const variabilityMap = new Map();
    const categoryIdByName = new Map();
    const addCategoryLookup = (name, categoryId) => {
      const key = normalizeCategoryKey(name);
      if (key && Number.isFinite(categoryId)) {
        categoryIdByName.set(key, categoryId);
      }
    };
    for (const row of mappingsResult.rows) {
      variabilityMap.set(row.category_definition_id, {
        variabilityType: row.variability_type,
        name: row.name,
        nameEn: row.name_en,
      });
      addCategoryLookup(row.name, row.category_definition_id);
      addCategoryLookup(row.name_en, row.category_definition_id);
    }

    const categoryIdsForStability = Array.from(new Set(
      patterns
        .map(pattern => resolveCategoryId(pattern, categoryIdByName))
        .filter((id) => Number.isFinite(id))
        .map((id) => Number(id))
    ));
    let weeklyStability = new Map();
    let monthlyStability = new Map();

    if (categoryIdsForStability.length > 0) {
      const stabilityStart = new Date();
      stabilityStart.setMonth(stabilityStart.getMonth() - STABILITY_LOOKBACK_MONTHS);
      const stabilityQueryParams = [stabilityStart.toISOString(), ...categoryIdsForStability];
      const placeholders = categoryIdsForStability.map((_, index) => `$${index + 2}`).join(', ');
      const stabilityResult = await client.query(`
        SELECT t.category_definition_id, t.date, t.price
        FROM transactions t
        LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
          ON t.identifier = tpe.transaction_identifier
          AND t.vendor = tpe.transaction_vendor
        WHERE t.status = 'completed'
          AND t.category_type = 'expense'
          AND t.price < 0
          AND t.date >= $1
          AND t.category_definition_id IN (${placeholders})
          AND tpe.transaction_identifier IS NULL
      `, stabilityQueryParams);

      const weeklyKeys = buildWeekKeys(STABILITY_LOOKBACK_WEEKS);
      const monthlyKeys = buildMonthKeys(STABILITY_LOOKBACK_MONTHS);
      const rows = stabilityResult.rows || [];
      const weeklyTotals = buildTotalsByCategory(rows, weeklyKeys, getWeekKey, categoryIdsForStability);
      const monthlyTotals = buildTotalsByCategory(rows, monthlyKeys, getMonthKey, categoryIdsForStability);

      for (const categoryId of categoryIdsForStability) {
        weeklyStability.set(categoryId, computePeriodStability(weeklyTotals.get(categoryId) || []));
        monthlyStability.set(categoryId, computePeriodStability(monthlyTotals.get(categoryId) || []));
      }
    }

    // Quest Type 1: Reduce variable/seasonal spending
    const variablePatterns = patterns
      .map(pattern => {
        const resolvedCategoryId = resolveCategoryId(pattern, categoryIdByName);
        return { pattern, resolvedCategoryId };
      })
      .filter(({ pattern, resolvedCategoryId }) => {
        if (!Number.isFinite(resolvedCategoryId)) {
          return false;
        }
        const mapping = variabilityMap.get(resolvedCategoryId);
        const isExpense = pattern.categoryType === 'expense' || Boolean(resolvedCategoryId);
        const isActionable = !pattern.isFixedRecurring && !pattern.isFixedAmount;
        const monthsOfHistory = coerceNumber(pattern.monthsOfHistory);
        const avgOccurrencesPerWeek = resolveAvgOccurrencesPerWeek(pattern);
        const hasEnoughHistory = monthsOfHistory >= 2 || (monthsOfHistory >= 1 && avgOccurrencesPerWeek >= 1);
        const hasRecentActivity = !isPatternStale(pattern);
        const categoryName = mapping?.name ?? pattern.categoryName;
        const categoryNameEn = mapping?.nameEn ?? pattern.categoryNameEn;
        const isExcluded = isExcludedCategoryName(categoryName, categoryNameEn);
        const isVariable = mapping?.variabilityType === 'variable' || mapping?.variabilityType === 'seasonal' || isActionable;
        const isMonthlyPattern = pattern.patternType === 'monthly' || pattern.patternType === 'bi-monthly';
        const stabilityStats = isMonthlyPattern
          ? monthlyStability.get(resolvedCategoryId)
          : weeklyStability.get(resolvedCategoryId);
        const isStable = stabilityStats?.isStable === true;
        return isExpense && !isExcluded && hasEnoughHistory && hasRecentActivity && isVariable && !isStable;
      });
    console.log('[Quests] Variable patterns after filtering:', variablePatterns.length);

    // Sort by potential impact (higher spending = more potential savings)
    variablePatterns.sort((a, b) => estimateMonthlySpend(b.pattern) - estimateMonthlySpend(a.pattern));

    for (const { pattern, resolvedCategoryId } of variablePatterns.slice(0, 3)) {
      if (quests.length >= slotsAvailable) break;

      const durationDays = resolveQuestDurationDays(pattern);
      const baselineSpend = computeBaselineSpend(pattern, durationDays);
      if (!isBaselineMeaningful(baselineSpend, durationDays)) {
        continue;
      }

      // Determine reduction target based on variance and history
      const reductionPct = computeReductionPct(pattern);
      const difficulty = determineQuestDifficulty(reductionPct, pattern.confidence || 0.7);
      const points = calculateQuestPoints(durationDays, difficulty, reductionPct);

      const localizedName = getLocalizedCategoryName({
        name: pattern.categoryName,
        name_en: pattern.categoryNameEn,
        name_fr: null,
      }, locale) || pattern.categoryName;

      const targetAmount = Math.max(0, Math.round(baselineSpend * (1 - reductionPct / 100)));
      const baselineRounded = Math.round(baselineSpend);
      const periodLabel = getLocalizedPeriodLabel(durationDays, locale);
      const averageLabel = getLocalizedAverageLabel(durationDays, locale);

      const questText = getQuestText('quest_reduce_spending', {
        categoryName: localizedName,
        reductionPct,
        averageLabel,
        baseline: baselineRounded,
        target: targetAmount,
        period: periodLabel,
      }, locale);

      quests.push({
        action_type: 'quest_reduce_spending',
        trigger_category_id: resolvedCategoryId,
        severity: 'low',
        title: questText.title,
        description: questText.description,
        metadata: JSON.stringify({
          quest_type: 'reduce_spending',
          target_amount: targetAmount,
          current_average: baselineRounded,
          baseline_amount: baselineRounded,
          baseline_period: periodLabel,
          avg_transaction: pattern.avgAmount,
          avg_occurrences_per_week: pattern.avgOccurrencesPerWeek,
          avg_occurrences_per_month: pattern.avgOccurrencesPerMonth,
          reduction_pct: reductionPct,
          pattern_confidence: pattern.confidence,
          variability_type: variabilityMap.get(resolvedCategoryId)?.variabilityType || 'variable',
        }),
        completion_criteria: JSON.stringify({
          type: 'spending_limit',
          category_definition_id: resolvedCategoryId,
          target_amount: targetAmount,
          comparison: 'less_than',
        }),
        quest_difficulty: difficulty,
        quest_duration_days: durationDays,
        points_reward: points,
        potential_impact: Math.round(baselineSpend * reductionPct / 100),
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
      const daysRemaining = getDaysRemainingInMonth();
      if (daysRemaining < MIN_DAYS_FOR_BUDGET_QUEST) {
        continue;
      }
      const durationDays = daysRemaining;
      const points = calculateQuestPoints(durationDays, difficulty, 15);

      const localizedName = getLocalizedCategoryName({
        name: item.categoryName,
        name_en: item.categoryNameEn,
        name_fr: null,
      }, locale) || item.categoryName;

      const remainingBudget = Math.max(0, item.limit - item.actualSpent);

      const questText = getQuestText('quest_budget_adherence', {
        categoryName: localizedName,
        limit: Math.round(item.limit),
        daysRemaining,
        remaining: Math.round(remainingBudget),
      }, locale);

      quests.push({
        action_type: 'quest_budget_adherence',
        trigger_category_id: item.categoryDefinitionId,
        severity: 'medium',
        title: questText.title,
        description: questText.description,
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
    const unbudgetedHighVariance = patterns
      .map(pattern => {
        const resolvedCategoryId = resolveCategoryId(pattern, categoryIdByName);
        return { pattern, resolvedCategoryId };
      })
      .filter(({ pattern, resolvedCategoryId }) => {
        if (!Number.isFinite(resolvedCategoryId)) {
          return false;
        }
        const isExpense = pattern.categoryType === 'expense' || Boolean(resolvedCategoryId);
        const categoryName = pattern.categoryName;
        const categoryNameEn = pattern.categoryNameEn;
        const isExcluded = isExcludedCategoryName(categoryName, categoryNameEn);
        const monthlySpend = estimateMonthlySpend(pattern);
        return isExpense &&
          !isExcluded &&
          !isPatternStale(pattern) &&
          pattern.monthsOfHistory >= 3 &&
          pattern.coefficientOfVariation > 0.4 &&
          monthlySpend >= MIN_BASELINE_MONTHLY &&
          !budgetOutlook.find(b => b.categoryDefinitionId === resolvedCategoryId && b.budgetId);
      });

    for (const { pattern, resolvedCategoryId } of unbudgetedHighVariance.slice(0, 2)) {
      if (quests.length >= slotsAvailable) break;
      if (quests.find(q => q.trigger_category_id === resolvedCategoryId)) continue;

      const difficulty = 'easy'; // Setting a budget is easy
      const durationDays = 7;
      const points = calculateQuestPoints(durationDays, difficulty, 5);

      const localizedName = getLocalizedCategoryName({
        name: pattern.categoryName,
        name_en: pattern.categoryNameEn,
        name_fr: null,
      }, locale) || pattern.categoryName;

      const avgMonthlySpend = estimateMonthlySpend(pattern);
      if (!isBaselineMeaningful(avgMonthlySpend, DAYS_PER_MONTH)) {
        continue;
      }
      const suggestedBudget = Math.round(avgMonthlySpend * 1.1);

      const questText = getQuestText('quest_set_budget', {
        categoryName: localizedName,
        avgMonthly: Math.round(avgMonthlySpend),
        minAmount: Math.round(pattern.minAmount || 0),
        maxAmount: Math.round(pattern.maxAmount || 0),
        suggestedBudget,
      }, locale);

      quests.push({
        action_type: 'quest_set_budget',
        trigger_category_id: resolvedCategoryId,
        severity: 'low',
        title: questText.title,
        description: questText.description,
        metadata: JSON.stringify({
          quest_type: 'set_budget',
          suggested_budget: suggestedBudget,
          avg_monthly: avgMonthlySpend,
          min_amount: pattern.minAmount,
          max_amount: pattern.maxAmount,
          coefficient_of_variation: pattern.coefficientOfVariation,
        }),
        completion_criteria: JSON.stringify({
          type: 'budget_exists',
          category_definition_id: resolvedCategoryId,
        }),
        quest_difficulty: difficulty,
        quest_duration_days: durationDays,
        points_reward: points,
        potential_impact: 0,
        detection_confidence: 0.9,
      });
    }

    // Quest Type 4: Reduce fixed costs (review subscriptions, insurance, etc.)
    const fixedPatterns = patterns
      .map(pattern => {
        const resolvedCategoryId = resolveCategoryId(pattern, categoryIdByName);
        return { pattern, resolvedCategoryId };
      })
      .filter(({ pattern, resolvedCategoryId }) => {
        if (!Number.isFinite(resolvedCategoryId)) {
          return false;
        }
        const mapping = variabilityMap.get(resolvedCategoryId);
        const isExpense = pattern.categoryType === 'expense' || Boolean(resolvedCategoryId);
        const isFixed = pattern.isFixedRecurring || pattern.isFixedAmount || mapping?.variabilityType === 'fixed';
        const monthlySpend = estimateMonthlySpend(pattern);
        const meaningful = monthlySpend >= MIN_FIXED_MONTHLY;
        const hasHistory = (pattern.monthsOfHistory || 0) >= 3;
        const hasRecentActivity = !isPatternStale(pattern);
        const categoryName = mapping?.name ?? pattern.categoryName;
        const categoryNameEn = mapping?.nameEn ?? pattern.categoryNameEn;
        const isExcluded = isExcludedCategoryName(categoryName, categoryNameEn);
        return isExpense && !isExcluded && isFixed && meaningful && hasHistory && hasRecentActivity;
      });

    // Sort by amount (higher = more savings potential)
    fixedPatterns.sort((a, b) => estimateMonthlySpend(b.pattern) - estimateMonthlySpend(a.pattern));

    for (const { pattern, resolvedCategoryId } of fixedPatterns.slice(0, 2)) {
      if (quests.length >= slotsAvailable) break;
      if (quests.find(q => q.trigger_category_id === resolvedCategoryId)) continue;

      const difficulty = 'medium'; // Requires negotiation/switching
      const durationDays = 30; // Give time to find alternatives
      const points = calculateQuestPoints(durationDays, difficulty, 10);

      const localizedName = getLocalizedCategoryName({
        name: pattern.categoryName,
        name_en: pattern.categoryNameEn,
        name_fr: null,
      }, locale) || pattern.categoryName;
      const avgMonthlySpend = estimateMonthlySpend(pattern);

      const questText = getQuestText('quest_reduce_fixed_cost', {
        categoryName: localizedName,
        avgAmount: Math.round(pattern.avgAmount || 0),
      }, locale);

      quests.push({
        action_type: 'quest_reduce_fixed_cost',
        trigger_category_id: resolvedCategoryId,
        severity: 'low',
        title: questText.title,
        description: questText.description,
        metadata: JSON.stringify({
          quest_type: 'reduce_fixed_cost',
          current_amount: pattern.avgAmount,
          is_fixed_recurring: pattern.isFixedRecurring,
          avg_monthly_spend: avgMonthlySpend,
        }),
        completion_criteria: JSON.stringify({
          type: 'fixed_cost_reduction',
          category_definition_id: resolvedCategoryId,
          baseline_amount: pattern.avgAmount,
          comparison: 'less_than',
        }),
        quest_difficulty: difficulty,
        quest_duration_days: durationDays,
        points_reward: points,
        potential_impact: Math.round(avgMonthlySpend * 0.1), // Assume 10% savings potential
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

        const questText = getQuestText('quest_savings_target', {
          savingsTarget,
        }, locale);

        quests.push({
          action_type: 'quest_savings_target',
          trigger_category_id: null,
          severity: 'low',
          title: questText.title,
          description: questText.description,
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

    // Quest Type 6: Merchant-specific quests (actionable)
    const merchantQuests = await generateMerchantQuests({ locale }, slotsAvailable - quests.length, client);
    quests.push(...merchantQuests);
    console.log('[Quests] Generated', merchantQuests.length, 'merchant quests');

    // Quest Type 7: Weekend spending limit quests (actionable)
    const weekendQuests = await generateWeekendQuests({ locale }, slotsAvailable - quests.length, client);
    quests.push(...weekendQuests);
    console.log('[Quests] Generated', weekendQuests.length, 'weekend quests');

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

        case 'merchant_frequency_limit': {
          // Count transactions matching merchant pattern during quest period
          const merchantCount = await client.query(`
            SELECT COUNT(*) as cnt
            FROM transactions
            WHERE date >= $1 AND date <= $2
              AND LOWER(name) LIKE '%' || $3 || '%'
              AND price < 0
          `, [
            quest.accepted_at.split('T')[0],
            (quest.deadline || new Date().toISOString()).split('T')[0],
            criteria.merchant_pattern,
          ]);

          actualValue = parseInt(merchantCount.rows[0]?.cnt || 0, 10);
          success = actualValue <= criteria.max_transactions;
          // Achievement: how much under the limit (inverted scale)
          achievementPct = criteria.max_transactions > 0
            ? Math.round((1 - (actualValue - criteria.max_transactions) / criteria.baseline_transactions) * 100)
            : (success ? 100 : 0);
          achievementPct = Math.max(0, Math.min(150, achievementPct)); // Clamp to 0-150%
          break;
        }

        case 'weekend_spending_limit': {
          // Sum weekend spending during quest period
          const weekendSpending = await client.query(`
            SELECT COALESCE(SUM(ABS(price)), 0) as total
            FROM transactions
            WHERE date >= $1 AND date <= $2
              AND price < 0
              AND CAST(strftime('%w', date) AS INTEGER) IN (0, 5, 6)
          `, [
            quest.accepted_at.split('T')[0],
            (quest.deadline || new Date().toISOString()).split('T')[0],
          ]);

          actualValue = parseFloat(weekendSpending.rows[0]?.total || 0);
          success = actualValue <= criteria.target_amount;
          achievementPct = criteria.target_amount > 0
            ? Math.round((1 - actualValue / criteria.target_amount) * 100 + 100)
            : 100;
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
 * Build quest text parameters from stored metadata for re-localization
 */
function buildQuestTextParams(actionType, metadata, localizedCategoryName, locale) {
  switch (actionType) {
    case 'quest_reduce_spending': {
      const durationDays = metadata.baseline_period === 'month' ? 30 : 7;
      return {
        categoryName: localizedCategoryName || metadata.category_name || '',
        reductionPct: metadata.reduction_pct || 0,
        averageLabel: getLocalizedAverageLabel(durationDays, locale),
        baseline: metadata.baseline_amount || metadata.current_average || 0,
        target: metadata.target_amount || 0,
        period: getLocalizedPeriodLabel(durationDays, locale),
      };
    }
    case 'quest_budget_adherence': {
      return {
        categoryName: localizedCategoryName || metadata.category_name || '',
        limit: Math.round(metadata.budget_limit || 0),
        daysRemaining: metadata.days_remaining || getDaysRemainingInMonth(),
        remaining: Math.round(metadata.remaining || 0),
      };
    }
    case 'quest_set_budget': {
      return {
        categoryName: localizedCategoryName || metadata.category_name || '',
        avgMonthly: Math.round(metadata.avg_monthly || 0),
        minAmount: Math.round(metadata.min_amount || 0),
        maxAmount: Math.round(metadata.max_amount || 0),
        suggestedBudget: Math.round(metadata.suggested_budget || 0),
      };
    }
    case 'quest_reduce_fixed_cost': {
      return {
        categoryName: localizedCategoryName || metadata.category_name || '',
        avgAmount: Math.round(metadata.current_amount || 0),
      };
    }
    case 'quest_savings_target': {
      return {
        savingsTarget: metadata.target_amount || 0,
      };
    }
    case 'quest_merchant_limit': {
      return {
        merchantName: metadata.merchant_name || '',
        targetVisits: metadata.target_visits || 0,
        baselineVisits: metadata.baseline_visits || 0,
        potentialSavings: Math.round((metadata.avg_transaction || 0) * ((metadata.baseline_visits || 0) - (metadata.target_visits || 0))),
      };
    }
    case 'quest_weekend_limit': {
      return {
        targetAmount: metadata.target_weekend_spend || 0,
        avgWeekendSpend: metadata.avg_weekend_spend || 0,
      };
    }
    default:
      return null;
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
        } else if (criteria.type === 'merchant_frequency_limit') {
          const startDate = row.accepted_at;
          const countResult = await client.query(`
            SELECT COUNT(*) as cnt
            FROM transactions
            WHERE date >= $1
              AND LOWER(name) LIKE '%' || $2 || '%'
              AND price < 0
          `, [startDate.split('T')[0], criteria.merchant_pattern]);

          const current = parseInt(countResult.rows[0]?.cnt || 0, 10);
          const target = criteria.max_transactions || 0;
          progress = {
            current,
            target,
            percentage: target > 0 ? Math.round((current / target) * 100) : 0,
            on_track: current <= target,
          };
        } else if (criteria.type === 'weekend_spending_limit') {
          const startDate = row.accepted_at;
          const spendingResult = await client.query(`
            SELECT COALESCE(SUM(ABS(price)), 0) as total_spent
            FROM transactions
            WHERE date >= $1
              AND price < 0
              AND CAST(strftime('%w', date) AS INTEGER) IN (0, 5, 6)
          `, [startDate.split('T')[0]]);

          const spent = parseFloat(spendingResult.rows[0]?.total_spent || 0);
          const target = criteria.target_amount || 0;
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

      // Re-localize title and description based on current locale
      const metadata = row.metadata ? JSON.parse(row.metadata) : {};
      let localizedTitle = row.title;
      let localizedDescription = row.description;

      // Rebuild localized text from stored metadata
      if (row.action_type && metadata) {
        const questTextParams = buildQuestTextParams(row.action_type, metadata, localizedName, locale);
        if (questTextParams) {
          const questText = getQuestText(row.action_type, questTextParams, locale);
          localizedTitle = questText.title;
          localizedDescription = questText.description;
        }
      }

      quests.push({
        ...row,
        title: localizedTitle,
        description: localizedDescription,
        category_name: localizedName || row.category_name,
        metadata,
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
  _internal: {
    computeWeeklyBaselineStats,
    isExcludedCategoryName,
  },
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
