const actualDatabase = require('../database.js');
const { getLocalizedCategoryName } = require('../../../lib/server/locale-utils.js');
const { getCreditCardRepaymentCategoryCondition } = require('../accounts/repayment-category.js');
const actualFinancialTruth = require('../financial-truth.js');
const { activeSubscriptionAlertPredicate } = require('../subscription-alert-policy.js');

let database = actualDatabase;
let financialTruth = actualFinancialTruth;

function loadTruthSnapshot() {
  if (process.env.NODE_ENV === 'test' && financialTruth === actualFinancialTruth) {
    return { truthRevision: 0, patterns: [] };
  }
  try {
    return financialTruth.getProjectionSnapshot();
  } catch (error) {
    console.warn('Subscription truth snapshot unavailable:', error?.message || error);
    return { truthRevision: 0, patterns: [] };
  }
}

function syncTruthFromSubscription(id, updates) {
  if (process.env.NODE_ENV === 'test' && financialTruth === actualFinancialTruth) return null;
  try {
    return financialTruth.applySubscriptionUpdate(id, updates);
  } catch (error) {
    console.warn('Subscription truth update unavailable:', error?.message || error);
    return null;
  }
}

function getRecurringAnalyzer() {
  return require('./recurring-analyzer.js');
}

const defaultRecurringAnalyzer = {
  analyzeRecurringPatterns: (...args) => getRecurringAnalyzer().analyzeRecurringPatterns(...args),
  normalizePatternKey: (...args) => getRecurringAnalyzer().normalizePatternKey(...args),
  selectDominantCluster: (...args) => getRecurringAnalyzer().selectDominantCluster(...args),
};
let recurringAnalyzerRef = { ...defaultRecurringAnalyzer };

// Frequency types with expected intervals in days
const FREQUENCY_INTERVALS = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  bimonthly: 60,
  quarterly: 91,
  yearly: 365,
  variable: null
};

const PRICE_CHANGE_FRESHNESS_DAYS = 35;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateOnlyParts(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  return Number.isFinite(timestamp) ? { year, month, day, timestamp } : null;
}

function localCalendarDayNumber(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function calendarDaysSince(dateValue, now = new Date()) {
  const parsed = parseDateOnlyParts(dateValue);
  if (!parsed) return null;
  return Math.floor((localCalendarDayNumber(now) - parsed.timestamp) / DAY_MS);
}

function missedChargeFreshnessDays(subscription) {
  const frequency = subscription.user_frequency || subscription.detected_frequency;
  const intervalDays = FREQUENCY_INTERVALS[frequency] || 30;
  return Math.min(120, Math.max(30, Math.ceil(intervalDays * 2)));
}

function addCalendarDays(dateValue, days) {
  const parsed = parseDateOnlyParts(dateValue);
  if (!parsed) return null;
  const date = new Date(parsed.timestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseStoredAlert(row) {
  if (!row) return row;
  let correctionCapabilities = Array.isArray(row.correction_capabilities)
    ? row.correction_capabilities
    : [];
  let timeScope = row.time_scope && typeof row.time_scope === 'object'
    ? row.time_scope
    : null;
  if (row.correction_capabilities_json != null) {
    try { correctionCapabilities = JSON.parse(row.correction_capabilities_json || '[]'); } catch { /* malformed legacy row */ }
  }
  if (row.time_scope_json != null) {
    try { timeScope = JSON.parse(row.time_scope_json || 'null'); } catch { /* malformed legacy row */ }
  }
  return {
    ...row,
    correction_capabilities: Array.isArray(correctionCapabilities) ? correctionCapabilities : [],
    time_scope: timeScope && typeof timeScope === 'object' ? timeScope : null,
  };
}

async function persistDetectedAlerts(alerts) {
  const persisted = [];
  for (const alert of alerts) {
    // A newly detected pattern may not have a subscription row yet. Keep that
    // alert visible for this response; once the subscription is materialized,
    // the deterministic identity below makes it durable and deduplicated.
    if (!alert.subscription_id || !alert.identity_key) {
      persisted.push(parseStoredAlert(alert));
      continue;
    }
    const result = await database.query(`
      INSERT INTO subscription_alerts (
        subscription_id, alert_type, severity, title, description,
        old_amount, new_amount, percentage_change, identity_key,
        evidence_start_date, evidence_end_date, expected_date, days_past_due,
        occurrence_id, correction_capabilities_json, time_scope_json, expires_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17
      )
      ON CONFLICT(identity_key) WHERE identity_key IS NOT NULL DO UPDATE SET
        severity = excluded.severity,
        title = excluded.title,
        description = excluded.description,
        old_amount = excluded.old_amount,
        new_amount = excluded.new_amount,
        percentage_change = excluded.percentage_change,
        evidence_start_date = excluded.evidence_start_date,
        evidence_end_date = excluded.evidence_end_date,
        expected_date = excluded.expected_date,
        days_past_due = excluded.days_past_due,
        occurrence_id = excluded.occurrence_id,
        correction_capabilities_json = excluded.correction_capabilities_json,
        time_scope_json = excluded.time_scope_json,
        expires_at = excluded.expires_at
      RETURNING id, is_dismissed, is_actioned, dismissed_at, actioned_at, action_taken, created_at
    `, [
      alert.subscription_id,
      alert.alert_type,
      alert.severity,
      alert.title,
      alert.description,
      alert.old_amount,
      alert.new_amount,
      alert.percentage_change,
      alert.identity_key,
      alert.evidence_start_date || null,
      alert.evidence_end_date || null,
      alert.expected_date || null,
      alert.days_past_due ?? null,
      alert.occurrence_id || null,
      JSON.stringify(alert.correction_capabilities || []),
      JSON.stringify(alert.time_scope || {}),
      alert.expires_at || null,
    ]);
    const stored = result.rows?.[0];
    const normalized = parseStoredAlert({ ...alert, ...(stored || {}) });
    if (!normalized.is_dismissed && !normalized.is_actioned) persisted.push(normalized);
  }
  return persisted;
}

/**
 * Calculate the next expected date based on frequency and last charge date
 */
function calculateNextExpectedDate(lastChargeDate, frequency) {
  if (!lastChargeDate || !frequency || !FREQUENCY_INTERVALS[frequency]) {
    return null;
  }

  const lastDate = new Date(lastChargeDate);
  const intervalDays = FREQUENCY_INTERVALS[frequency];

  if (!intervalDays) return null;

  const nextDate = new Date(lastDate);
  nextDate.setDate(nextDate.getDate() + intervalDays);

  return nextDate.toISOString().split('T')[0];
}


/**
 * Get all subscriptions, merging detected patterns with stored subscription records
 * @param {Object} options - Filter options
 * @param {string} options.status - Filter by status (active, paused, cancelled, keep, review)
 * @param {string} options.frequency - Filter by frequency
 * @param {string} options.locale - Locale for category names
 */
async function getSubscriptions(options = {}) {
  const { status, frequency, locale = 'he' } = options;
  const truthSnapshot = loadTruthSnapshot();
  const truthById = new Map(truthSnapshot.patterns.map((pattern) => [pattern.id, pattern]));
  const truthByName = new Map();
  truthSnapshot.patterns
    .filter((pattern) => pattern.direction === 'expense')
    .forEach((pattern) => {
      if (!truthByName.has(pattern.normalizedName)) truthByName.set(pattern.normalizedName, pattern);
    });
  const patterns = truthSnapshot.patterns.length > 0
    ? truthSnapshot.patterns
      .filter((pattern) => (
        pattern.direction === 'expense'
        && pattern.isSubscription
        && pattern.state !== 'suppressed'
      ))
      .map((pattern) => ({
        financial_pattern_id: pattern.id,
        pattern_key: pattern.normalizedName,
        display_name: pattern.displayName,
        detected_frequency: pattern.frequency,
        detected_amount: pattern.amount,
        amount_is_fixed: pattern.amountTolerance <= Math.max(5, pattern.amount * 0.15) ? 1 : 0,
        consistency_score: pattern.confidence,
        category_definition_id: pattern.categoryDefinitionId,
        first_detected_date: pattern.firstSeenDate,
        last_charge_date: pattern.lastSeenDate,
        occurrence_count: pattern.occurrenceCount,
        total_spent: pattern.amount * pattern.occurrenceCount,
      }))
    : (await recurringAnalyzerRef.analyzeRecurringPatterns({
      monthsBack: 6,
      minOccurrences: 2,
      minConsistency: 0.3,
      minVariableAmount: 50,
      aggregateBy: 'day',
      excludeCreditCardRepayments: true,
    })).patterns;

  // Get stored subscriptions
  const storedSubsResult = await database.query(
    `SELECT
      s.*,
      cd.name as category_name,
      cd.name_en as category_name_en,
      cd.name_fr as category_name_fr,
      cd.icon as category_icon,
      cd.color as category_color,
      parent_cd.id as parent_category_id,
      parent_cd.name as parent_category_name,
      parent_cd.name_en as parent_category_name_en,
      parent_cd.name_fr as parent_category_name_fr
    FROM subscriptions s
    LEFT JOIN category_definitions cd ON s.category_definition_id = cd.id
    LEFT JOIN category_definitions parent_cd ON cd.parent_id = parent_cd.id`,
    []
  );

  const storedSubs = storedSubsResult.rows || [];
  const storedSubsMap = new Map(storedSubs.map(s => [s.pattern_key, s]));

  const subscriptions = [];

  for (const pattern of patterns) {
    const storedSub = storedSubsMap.get(pattern.pattern_key);
    const truthPattern = truthById.get(Number(storedSub?.financial_pattern_id || pattern.financial_pattern_id))
      || truthByName.get(recurringAnalyzerRef.normalizePatternKey(pattern.display_name || pattern.pattern_key));
    if (truthPattern && !truthPattern.isSubscription) {
      storedSubsMap.delete(pattern.pattern_key);
      continue;
    }
    const categoryDefinitionId = storedSub?.category_definition_id ?? pattern.category_definition_id ?? null;
    const truthStatus = truthPattern?.state === 'suppressed' || truthPattern?.state === 'ended'
      ? 'cancelled'
      : truthPattern?.state === 'paused'
        ? 'paused'
        : null;

    const subscription = {
      id: storedSub?.id || null,
      financial_pattern_id: truthPattern?.id || storedSub?.financial_pattern_id || null,
      patternId: truthPattern?.id || storedSub?.financial_pattern_id || null,
      pattern_key: pattern.pattern_key,
      display_name: storedSub?.display_name || pattern.display_name,
      detected_frequency: pattern.detected_frequency,
      detected_amount: pattern.detected_amount,
      amount_is_fixed: storedSub?.amount_is_fixed ?? pattern.amount_is_fixed,
      consistency_score: pattern.consistency_score,
      user_frequency: truthPattern && truthPattern.frequency !== pattern.detected_frequency ? truthPattern.frequency : (storedSub?.user_frequency || null),
      user_amount: truthPattern && truthPattern.amount !== pattern.detected_amount ? truthPattern.amount : (storedSub?.user_amount || null),
      billing_day: truthPattern?.billingDay || storedSub?.billing_day || null,
      status: truthStatus || storedSub?.status || 'active',
      category_definition_id: categoryDefinitionId,
      category_name: getLocalizedCategoryName({
        name: storedSub?.category_name || pattern.category_name,
        name_en: storedSub?.category_name_en || pattern.category_name_en,
        name_fr: storedSub?.category_name_fr || pattern.category_name_fr
      }, locale),
      category_icon: storedSub?.category_icon || pattern.category_icon || null,
      category_color: storedSub?.category_color || pattern.category_color || null,
      parent_category_name: getLocalizedCategoryName({
        name: storedSub?.parent_category_name || pattern.parent_category_name,
        name_en: storedSub?.parent_category_name_en || pattern.parent_category_name_en,
        name_fr: storedSub?.parent_category_name_fr || pattern.parent_category_name_fr
      }, locale),
      first_detected_date: storedSub?.first_detected_date || pattern.first_detected_date,
      last_charge_date: pattern.last_charge_date,
      next_expected_date: truthPattern?.nextExpectedDate || calculateNextExpectedDate(
        pattern.last_charge_date,
        storedSub?.user_frequency || pattern.detected_frequency
      ),
      is_manual: storedSub?.is_manual || 0,
      notes: storedSub?.notes || null,
      occurrence_count: pattern.occurrence_count,
      total_spent: pattern.total_spent,
      truthRevision: truthSnapshot.truthRevision,
      predictionKind: 'recurring_expense',
      correctionCapabilities: ['skip_occurrence', 'suppress_pattern', 'end_pattern', 'pause_pattern', 'override_pattern'],
    };

    // Apply filters
    if (status && subscription.status !== status) continue;
    if (frequency && (subscription.user_frequency || subscription.detected_frequency) !== frequency) continue;

    subscriptions.push(subscription);

    // Remove from stored map to track what's left
    storedSubsMap.delete(pattern.pattern_key);
  }

  // Add manual subscriptions that weren't matched
  for (const storedSub of storedSubsMap.values()) {
    if (!storedSub.is_manual) continue;

    // Apply filters
    if (frequency && (storedSub.user_frequency || storedSub.detected_frequency) !== frequency) continue;

    const truthPattern = truthById.get(Number(storedSub.financial_pattern_id))
      || truthByName.get(recurringAnalyzerRef.normalizePatternKey(storedSub.display_name || storedSub.pattern_key));
    if (truthPattern && !truthPattern.isSubscription) continue;
    const resolvedStatus = truthPattern?.state === 'suppressed' || truthPattern?.state === 'ended'
      ? 'cancelled'
      : truthPattern?.state === 'paused' ? 'paused' : storedSub.status;
    if (truthPattern?.state === 'suppressed') continue;
    if (status && resolvedStatus !== status) continue;
    subscriptions.push({
      ...storedSub,
      financial_pattern_id: truthPattern?.id || storedSub.financial_pattern_id || null,
      patternId: truthPattern?.id || storedSub.financial_pattern_id || null,
      status: resolvedStatus,
      category_name: getLocalizedCategoryName({
        name: storedSub.category_name,
        name_en: storedSub.category_name_en,
        name_fr: storedSub.category_name_fr
      }, locale),
      parent_category_name: getLocalizedCategoryName({
        name: storedSub.parent_category_name,
        name_en: storedSub.parent_category_name_en,
        name_fr: storedSub.parent_category_name_fr
      }, locale),
      detected_amount: storedSub.detected_amount || storedSub.user_amount,
      occurrence_count: 0,
      total_spent: 0,
      truthRevision: truthSnapshot.truthRevision,
      predictionKind: 'recurring_expense',
      correctionCapabilities: ['suppress_pattern', 'end_pattern', 'pause_pattern', 'override_pattern'],
    });
  }

  // Sort by total spent descending
  subscriptions.sort((a, b) => (b.total_spent || 0) - (a.total_spent || 0));

  return { subscriptions, truthRevision: truthSnapshot.truthRevision, refreshState: 'ready' };
}

/**
 * Calculate interval consistency score
 */
/**
 * Get subscription cost summary
 */
async function getSubscriptionSummary(options = {}) {
  const { locale = 'he' } = options;
  const { subscriptions, truthRevision = 0 } = await getSubscriptions({ locale });

  const activeSubscriptions = subscriptions.filter(s => s.status === 'active' || s.status === 'keep');

  // Calculate monthly costs
  const monthlyTotal = activeSubscriptions.reduce((sum, sub) => {
    const amount = sub.user_amount || sub.detected_amount || 0;
    const frequency = sub.user_frequency || sub.detected_frequency || 'monthly';
    const monthlyAmount = convertToMonthly(amount, frequency);
    return sum + monthlyAmount;
  }, 0);

  // Calculate yearly costs
  const yearlyTotal = monthlyTotal * 12;

  // Group by category
  const categoryBreakdown = {};
  for (const sub of activeSubscriptions) {
    const categoryName = sub.parent_category_name || sub.category_name || 'Uncategorized';
    if (!categoryBreakdown[categoryName]) {
      categoryBreakdown[categoryName] = {
        name: categoryName,
        icon: sub.category_icon,
        color: sub.category_color,
        count: 0,
        monthly_total: 0
      };
    }

    const amount = sub.user_amount || sub.detected_amount || 0;
    const frequency = sub.user_frequency || sub.detected_frequency || 'monthly';

    categoryBreakdown[categoryName].count++;
    categoryBreakdown[categoryName].monthly_total += convertToMonthly(amount, frequency);
  }

  // Group by frequency
  const frequencyBreakdown = {};
  for (const sub of activeSubscriptions) {
    const frequency = sub.user_frequency || sub.detected_frequency || 'monthly';
    if (!frequencyBreakdown[frequency]) {
      frequencyBreakdown[frequency] = {
        frequency,
        count: 0,
        monthly_total: 0
      };
    }

    const amount = sub.user_amount || sub.detected_amount || 0;
    frequencyBreakdown[frequency].count++;
    frequencyBreakdown[frequency].monthly_total += convertToMonthly(amount, frequency);
  }

  return {
    total_count: subscriptions.length,
    active_count: activeSubscriptions.length,
    monthly_total: Math.round(monthlyTotal * 100) / 100,
    yearly_total: Math.round(yearlyTotal * 100) / 100,
    truthRevision,
    refreshState: 'ready',
    category_breakdown: Object.values(categoryBreakdown).sort((a, b) => b.monthly_total - a.monthly_total),
    frequency_breakdown: Object.values(frequencyBreakdown).sort((a, b) => b.monthly_total - a.monthly_total)
  };
}

/**
 * Convert amount to monthly equivalent
 */
function convertToMonthly(amount, frequency) {
  switch (frequency) {
    case 'daily': return amount * 30;
    case 'weekly': return amount * 4.33;
    case 'biweekly': return amount * 2.17;
    case 'monthly': return amount;
    case 'bimonthly': return amount / 2;
    case 'quarterly': return amount / 3;
    case 'yearly': return amount / 12;
    default: return amount;
  }
}

/**
 * Get subscription creep (historical cost growth)
 */
async function getSubscriptionCreep(options = {}) {
  const { months = 12 } = options;
  const { subscriptions, truthRevision = 0 } = await getSubscriptions();
  const subscriptionKeys = new Set(subscriptions.map((sub) => sub.pattern_key));
  const repaymentCategoryCondition = getCreditCardRepaymentCategoryCondition('cd');

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);

  // Get monthly subscription costs over time
  const result = await database.query(
    `SELECT
      strftime('%Y-%m', t.date) as month,
      LOWER(TRIM(COALESCE(t.name, t.vendor))) as pattern_key,
      SUM(ABS(t.price)) as monthly_amount,
      COUNT(*) as charge_count
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    WHERE t.status = 'completed'
      AND t.category_type = 'expense'
      AND t.price < 0
      AND t.date >= $1
      AND TRIM(COALESCE(t.name, t.vendor)) != ''
      AND (cd.id IS NULL OR NOT ${repaymentCategoryCondition})
    GROUP BY strftime('%Y-%m', t.date), LOWER(TRIM(COALESCE(t.name, t.vendor)))
    ORDER BY month`,
    [startDate.toISOString()]
  );

  const rows = result.rows || [];

  // Build monthly totals
  const monthlyData = new Map();
  const patternKeys = new Set();

  for (const row of rows) {
    const normalizedKey = recurringAnalyzerRef.normalizePatternKey(row.pattern_key);
    if (!normalizedKey || !subscriptionKeys.has(normalizedKey)) continue;

    patternKeys.add(normalizedKey);

    if (!monthlyData.has(row.month)) {
      monthlyData.set(row.month, { month: row.month, total: 0, count: 0, patterns: {} });
    }

    const monthData = monthlyData.get(row.month);
    monthData.total += row.monthly_amount;
    monthData.count++;
    monthData.patterns[normalizedKey] = row.monthly_amount;
  }

  const sortedMonths = Array.from(monthlyData.values()).sort((a, b) =>
    a.month.localeCompare(b.month)
  );

  // Calculate growth
  let previousTotal = sortedMonths[0]?.total || 0;
  const creepData = sortedMonths.map((data, idx) => {
    const growth = idx > 0 ? ((data.total - previousTotal) / previousTotal) * 100 : 0;
    previousTotal = data.total;

    return {
      month: data.month,
      total: Math.round(data.total * 100) / 100,
      subscription_count: data.count,
      growth_percentage: Math.round(growth * 100) / 100
    };
  });

  // Calculate overall creep
  const firstMonth = sortedMonths[0]?.total || 0;
  const lastMonth = sortedMonths[sortedMonths.length - 1]?.total || 0;
  const totalCreep = firstMonth > 0
    ? ((lastMonth - firstMonth) / firstMonth) * 100
    : 0;

  return {
    data: creepData,
    total_creep_percentage: Math.round(totalCreep * 100) / 100,
    starting_total: Math.round(firstMonth * 100) / 100,
    current_total: Math.round(lastMonth * 100) / 100,
    months_analyzed: months,
    truthRevision,
    refreshState: 'ready',
  };
}

/**
 * Get subscription alerts
 */
async function getSubscriptionAlerts(options = {}) {
  const { locale = 'he', include_dismissed = false } = options;

  // Get stored alerts
  const alertsResult = await database.query(
    `SELECT
      sa.*,
      s.display_name as subscription_name,
      s.detected_amount,
      s.detected_frequency,
      s.financial_pattern_id
    FROM subscription_alerts sa
    JOIN subscriptions s ON sa.subscription_id = s.id
    WHERE (sa.is_dismissed = 0 OR $1 = 1)
      AND sa.is_actioned = 0
      AND s.status IN ('active', 'keep', 'review')
      AND ${activeSubscriptionAlertPredicate('sa')}
    ORDER BY
      CASE sa.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      sa.created_at DESC`,
    [include_dismissed ? 1 : 0]
  );

  const alerts = (alertsResult.rows || []).map(parseStoredAlert);

  // Detect new alerts from patterns
  const subscriptionResult = await getSubscriptions({ locale });
  const detectedAlerts = await detectNewAlerts(locale, subscriptionResult);
  const newAlerts = await persistDetectedAlerts(detectedAlerts);
  const storedIdentities = new Set(alerts.map((alert) => alert.identity_key).filter(Boolean));
  const freshAlerts = newAlerts.filter((alert) => !storedIdentities.has(alert.identity_key));
  const combined = [...alerts, ...freshAlerts];

  return {
    alerts: combined,
    total_count: combined.length,
    critical_count: combined.filter(a => a.severity === 'critical').length,
    warning_count: combined.filter(a => a.severity === 'warning').length,
    truthRevision: subscriptionResult.truthRevision || 0,
    refreshState: 'ready',
  };
}

/**
 * Detect new alerts from transaction patterns
 */
async function detectNewAlerts(locale = 'he', existingSubscriptionResult = null) {
  const alerts = [];
  const { subscriptions } = existingSubscriptionResult || await getSubscriptions({ locale });
  const repaymentCategoryCondition = getCreditCardRepaymentCategoryCondition('cd');

  const today = new Date();

  for (const sub of subscriptions) {
    if (sub.status === 'cancelled' && sub.id && sub.last_charge_date) {
      const cancellationResult = await database.query(`
        SELECT event_date
        FROM subscription_history
        WHERE subscription_id = $1
          AND event_type = 'status_change'
          AND new_value = 'cancelled'
        ORDER BY event_date DESC, id DESC
        LIMIT 1
      `, [sub.id]);
      const cancelledAt = String(cancellationResult.rows?.[0]?.event_date || '').slice(0, 10);
      if (cancelledAt && String(sub.last_charge_date).slice(0, 10) > cancelledAt) {
        const evidenceDate = String(sub.last_charge_date).slice(0, 10);
        alerts.push({
          id: null,
          identity_key: `subscription:${sub.id}:cancelled_still_charging:${evidenceDate}`,
          subscription_id: sub.id,
          financial_pattern_id: sub.patternId || sub.financial_pattern_id || null,
          subscription_name: sub.display_name,
          alert_type: 'cancelled_still_charging',
          severity: 'critical',
          title: `${sub.display_name} charged after cancellation`,
          description: `A charge was detected on ${evidenceDate}, after cancellation on ${cancelledAt}`,
          old_amount: null,
          new_amount: sub.user_amount || sub.detected_amount || null,
          percentage_change: null,
          evidence_start_date: cancelledAt,
          evidence_end_date: evidenceDate,
          time_scope: { kind: 'evidence_range', start: cancelledAt, end: evidenceDate },
          correction_capabilities: ['suppress_pattern', 'end_pattern', 'override_pattern'],
          expires_at: `${addCalendarDays(evidenceDate, PRICE_CHANGE_FRESHNESS_DAYS)}T23:59:59.999Z`,
          is_dismissed: 0,
          created_at: new Date().toISOString(),
        });
      }
      continue;
    }
    if (sub.status !== 'active' && sub.status !== 'keep') continue;

    // Check for price increases
    if (!sub.display_name) continue;

    const priceChangeResult = await database.query(
      `SELECT
        substr(t.date, 1, 10) as charge_date,
        SUM(ABS(t.price)) as amount
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      WHERE LOWER(TRIM(COALESCE(t.name, t.vendor))) = LOWER(TRIM($1))
        AND t.status = 'completed'
        AND t.category_type = 'expense'
        AND t.price < 0
        AND (cd.id IS NULL OR NOT ${repaymentCategoryCondition})
      GROUP BY substr(t.date, 1, 10)
      ORDER BY charge_date DESC
      LIMIT 12`,
      [sub.display_name]
    );

    const priceRows = priceChangeResult.rows || [];
    const charges = priceRows.map((row) => ({
      date: row.charge_date,
      amount: Number(row.amount) || 0,
    }));
    const dominantCluster = charges.length >= 2
      ? recurringAnalyzerRef.selectDominantCluster(charges)
      : null;
    let clusterCharges = dominantCluster?.charges?.length ? dominantCluster.charges : charges;
    if (clusterCharges.length < 2) {
      clusterCharges = charges;
    }

    if (clusterCharges.length >= 2) {
      const sortedCharges = [...clusterCharges].sort((a, b) => b.date.localeCompare(a.date));
      const current = sortedCharges[0]?.amount || 0;
      const previous = sortedCharges[1]?.amount || 0;
      const currentChargeDate = sortedCharges[0]?.date || null;
      const previousChargeDate = sortedCharges[1]?.date || null;
      const evidenceAgeDays = calendarDaysSince(currentChargeDate, today);
      const hasFreshEvidence = evidenceAgeDays !== null
        && evidenceAgeDays >= 0
        && evidenceAgeDays <= PRICE_CHANGE_FRESHNESS_DAYS;

      if (hasFreshEvidence && previous > 0 && current > previous) {
        const percentChange = ((current - previous) / previous) * 100;

        if (percentChange >= 5) {
          alerts.push({
            id: null, // Not stored yet
            identity_key: `subscription:${sub.id}:price_increase:${currentChargeDate}:${Math.round(current * 100)}`,
            subscription_id: sub.id,
            financial_pattern_id: sub.patternId || sub.financial_pattern_id || null,
            subscription_name: sub.display_name,
            alert_type: 'price_increase',
            severity: percentChange >= 20 ? 'critical' : 'warning',
            title: `Price increase detected for ${sub.display_name}`,
            description: `The price has increased from ${previous.toFixed(2)} to ${current.toFixed(2)} (${percentChange.toFixed(1)}% increase)`,
            old_amount: previous,
            new_amount: current,
            percentage_change: Math.round(percentChange * 100) / 100,
            detected_amount: sub.user_amount || sub.detected_amount || current,
            detected_frequency: sub.user_frequency || sub.detected_frequency || 'monthly',
            evidence_start_date: previousChargeDate,
            evidence_end_date: currentChargeDate,
            time_scope: {
              kind: 'evidence_range',
              start: previousChargeDate,
              end: currentChargeDate,
            },
            correction_capabilities: ['suppress_pattern', 'end_pattern', 'pause_pattern', 'override_pattern'],
            expires_at: `${addCalendarDays(currentChargeDate, PRICE_CHANGE_FRESHNESS_DAYS)}T23:59:59.999Z`,
            is_dismissed: 0,
            created_at: new Date().toISOString()
          });
        }
      } else if (hasFreshEvidence && previous > 0 && current < previous) {
        const percentChange = ((current - previous) / previous) * 100;
        if (percentChange <= -5) {
          alerts.push({
            id: null,
            identity_key: `subscription:${sub.id}:price_decrease:${currentChargeDate}:${Math.round(current * 100)}`,
            subscription_id: sub.id,
            financial_pattern_id: sub.patternId || sub.financial_pattern_id || null,
            subscription_name: sub.display_name,
            alert_type: 'price_decrease',
            severity: 'info',
            title: `Price decrease detected for ${sub.display_name}`,
            description: `The price decreased from ${previous.toFixed(2)} to ${current.toFixed(2)} (${Math.abs(percentChange).toFixed(1)}% decrease)`,
            old_amount: previous,
            new_amount: current,
            percentage_change: Math.round(percentChange * 100) / 100,
            evidence_start_date: previousChargeDate,
            evidence_end_date: currentChargeDate,
            time_scope: { kind: 'evidence_range', start: previousChargeDate, end: currentChargeDate },
            correction_capabilities: ['override_pattern'],
            expires_at: `${addCalendarDays(currentChargeDate, PRICE_CHANGE_FRESHNESS_DAYS)}T23:59:59.999Z`,
            is_dismissed: 0,
            created_at: new Date().toISOString(),
          });
        }
      }
    }

    if (sub.id) {
      const duplicateResult = await database.query(`
        SELECT substr(t.date, 1, 10) AS charge_date,
          ROUND(ABS(t.price), 2) AS amount,
          COUNT(*) AS charge_count
        FROM transactions t
        WHERE LOWER(TRIM(COALESCE(t.name, t.vendor))) = LOWER(TRIM($1))
          AND t.status = 'completed'
          AND t.category_type = 'expense'
          AND t.price < 0
          AND t.date >= date('now', '-14 days')
        GROUP BY substr(t.date, 1, 10), ROUND(ABS(t.price), 2)
        HAVING COUNT(*) >= 2
        ORDER BY charge_date DESC
        LIMIT 1
      `, [sub.display_name]);
      const duplicate = duplicateResult.rows?.[0];
      if (duplicate) {
        const duplicateDate = String(duplicate.charge_date).slice(0, 10);
        const amount = Number(duplicate.amount) || 0;
        const duplicatePatternId = sub.patternId || sub.financial_pattern_id || null;
        const occurrenceId = duplicatePatternId
          ? `pattern:${duplicatePatternId}:${duplicateDate}`
          : null;
        alerts.push({
          id: null,
          identity_key: `subscription:${sub.id}:duplicate:${duplicateDate}:${Math.round(amount * 100)}`,
          subscription_id: sub.id,
          financial_pattern_id: duplicatePatternId,
          occurrence_id: occurrenceId,
          subscription_name: sub.display_name,
          alert_type: 'duplicate',
          severity: 'warning',
          title: `Possible duplicate charge for ${sub.display_name}`,
          description: `${duplicate.charge_count} charges of ${amount.toFixed(2)} were detected on ${duplicateDate}`,
          old_amount: amount,
          new_amount: amount,
          percentage_change: 0,
          evidence_start_date: duplicateDate,
          evidence_end_date: duplicateDate,
          time_scope: { kind: 'evidence_range', start: duplicateDate, end: duplicateDate },
          correction_capabilities: occurrenceId
            ? ['skip_occurrence', 'override_pattern']
            : ['override_pattern'],
          expires_at: `${addCalendarDays(duplicateDate, PRICE_CHANGE_FRESHNESS_DAYS)}T23:59:59.999Z`,
          is_dismissed: 0,
          created_at: new Date().toISOString(),
        });
      }
    }

    // Check for missed charges
    if (sub.next_expected_date) {
      const daysPastDue = calendarDaysSince(sub.next_expected_date, today);
      const freshnessDays = missedChargeFreshnessDays(sub);

      if (daysPastDue !== null && daysPastDue > 7 && daysPastDue <= freshnessDays) {
        const patternId = sub.patternId || sub.financial_pattern_id || null;
        const occurrenceId = patternId
          ? `pattern:${patternId}:${sub.next_expected_date}`
          : null;
        alerts.push({
          id: null,
          identity_key: `subscription:${sub.id}:missed_charge:${sub.next_expected_date}`,
          subscription_id: sub.id,
          financial_pattern_id: patternId,
          occurrence_id: occurrenceId,
          subscription_name: sub.display_name,
          alert_type: 'missed_charge',
          severity: daysPastDue > 30 ? 'warning' : 'info',
          title: `Missed charge for ${sub.display_name}`,
          description: `Expected charge on ${sub.next_expected_date} has not been detected (${daysPastDue} days overdue)`,
          old_amount: null,
          new_amount: null,
          percentage_change: null,
          detected_amount: sub.user_amount || sub.detected_amount || null,
          detected_frequency: sub.user_frequency || sub.detected_frequency || 'monthly',
          expected_date: sub.next_expected_date,
          days_past_due: daysPastDue,
          time_scope: {
            kind: 'overdue_since',
            start: sub.next_expected_date,
          },
          correction_capabilities: occurrenceId
            ? ['skip_occurrence', 'suppress_pattern', 'end_pattern', 'pause_pattern', 'override_pattern']
            : ['suppress_pattern', 'end_pattern', 'pause_pattern', 'override_pattern'],
          expires_at: `${addCalendarDays(sub.next_expected_date, freshnessDays)}T23:59:59.999Z`,
          is_dismissed: 0,
          created_at: new Date().toISOString()
        });
      }
    }

    const effectiveFrequency = sub.user_frequency || sub.detected_frequency;
    if (sub.next_expected_date && ['quarterly', 'yearly'].includes(effectiveFrequency)) {
      const daysUntilRenewal = -calendarDaysSince(sub.next_expected_date, today);
      if (daysUntilRenewal >= 0 && daysUntilRenewal <= 14) {
        alerts.push({
          id: null,
          identity_key: `subscription:${sub.id}:upcoming_renewal:${sub.next_expected_date}`,
          subscription_id: sub.id,
          financial_pattern_id: sub.patternId || sub.financial_pattern_id || null,
          subscription_name: sub.display_name,
          alert_type: 'upcoming_renewal',
          severity: 'info',
          title: `${sub.display_name} renews soon`,
          description: `The next expected charge is ${sub.next_expected_date}`,
          old_amount: null,
          new_amount: sub.user_amount || sub.detected_amount || null,
          percentage_change: null,
          expected_date: sub.next_expected_date,
          time_scope: { kind: 'upcoming_until', end: sub.next_expected_date },
          correction_capabilities: ['pause_pattern', 'end_pattern', 'override_pattern'],
          expires_at: `${sub.next_expected_date}T23:59:59.999Z`,
          is_dismissed: 0,
          created_at: new Date().toISOString(),
        });
      }
    }
  }

  return alerts;
}

/**
 * Get upcoming renewals
 */
async function getUpcomingRenewals(options = {}) {
  const { days = 30, locale = 'he' } = options;
  const { subscriptions, truthRevision = 0 } = await getSubscriptions({ locale });

  const today = new Date();
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + days);

  const renewals = subscriptions
    .filter(sub => {
      if ((sub.status !== 'active' && sub.status !== 'keep') || !sub.next_expected_date) return false;
      const nextDate = new Date(sub.next_expected_date);
      return nextDate >= today && nextDate <= futureDate;
    })
    .map(sub => ({
      ...sub,
      days_until_renewal: Math.ceil(
        (new Date(sub.next_expected_date) - today) / (1000 * 60 * 60 * 24)
      )
    }))
    .sort((a, b) => new Date(a.next_expected_date) - new Date(b.next_expected_date));

  return { renewals, truthRevision, refreshState: 'ready' };
}

/**
 * Update a subscription
 */
async function updateSubscription(id, updates) {
  const {
    display_name,
    user_frequency,
    user_amount,
    billing_day,
    status,
    category_definition_id,
    notes
  } = updates;

  // Get current subscription to check for changes
  const currentResult = await database.query(
    'SELECT * FROM subscriptions WHERE id = $1',
    [id]
  );

  const current = currentResult.rows?.[0];
  if (!current) {
    throw new Error('Subscription not found');
  }

  // Update subscription
  await database.query(
    `UPDATE subscriptions SET
      display_name = COALESCE($1, display_name),
      user_frequency = COALESCE($2, user_frequency),
      user_amount = COALESCE($3, user_amount),
      billing_day = COALESCE($4, billing_day),
      status = COALESCE($5, status),
      category_definition_id = COALESCE($6, category_definition_id),
      notes = COALESCE($7, notes),
      updated_at = datetime('now')
    WHERE id = $8`,
    [
      display_name,
      user_frequency,
      user_amount,
      billing_day,
      status,
      category_definition_id,
      notes,
      id
    ]
  );

  // Log status change to history
  if (status && status !== current.status) {
    await database.query(
      `INSERT INTO subscription_history
        (subscription_id, event_type, old_value, new_value, event_date)
      VALUES ($1, 'status_change', $2, $3, datetime('now'))`,
      [id, current.status, status]
    );
  }

  // Log amount change to history
  if (user_amount !== undefined && user_amount !== null && user_amount !== current.user_amount) {
    await database.query(
      `INSERT INTO subscription_history
        (subscription_id, event_type, old_value, new_value, amount, event_date)
      VALUES ($1, 'price_change', $2, $3, $4, datetime('now'))`,
      [id, String(current.user_amount || current.detected_amount), String(user_amount), user_amount]
    );
  }

  const truthResult = syncTruthFromSubscription(id, updates);

  return { success: true, id, ...(truthResult || {}) };
}

/**
 * Add a manual subscription
 */
async function addManualSubscription(subscription) {
  const {
    display_name,
    detected_frequency,
    detected_amount,
    user_frequency,
    user_amount,
    billing_day,
    status = 'active',
    category_definition_id,
    notes
  } = subscription;

  const patternKey = recurringAnalyzerRef.normalizePatternKey(display_name);

  // Check if subscription with this pattern key already exists
  const existingResult = await database.query(
    'SELECT id FROM subscriptions WHERE pattern_key = $1',
    [patternKey]
  );

  if (existingResult.rows?.length > 0) {
    throw new Error('A subscription with this name already exists');
  }

  const result = await database.query(
    `INSERT INTO subscriptions (
      pattern_key, display_name, detected_frequency, detected_amount,
      user_frequency, user_amount, billing_day, status, category_definition_id,
      is_manual, notes, first_detected_date, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, datetime('now'), datetime('now'), datetime('now'))
    RETURNING id`,
    [
      patternKey,
      display_name,
      detected_frequency || user_frequency || 'monthly',
      detected_amount || user_amount,
      user_frequency,
      user_amount,
      billing_day,
      status,
      category_definition_id,
      notes
    ]
  );

  const id = result.rows?.[0]?.id;

  const truthResult = syncTruthFromSubscription(id, {
    user_amount: user_amount ?? detected_amount,
    user_frequency: user_frequency || detected_frequency || 'monthly',
    billing_day,
    status,
  });

  return { success: true, id, ...(truthResult || {}) };
}

/**
 * Delete a subscription
 */
async function deleteSubscription(id) {
  // Check if subscription exists and is manual
  const result = await database.query(
    'SELECT is_manual FROM subscriptions WHERE id = $1',
    [id]
  );

  const subscription = result.rows?.[0];
  if (!subscription) {
    throw new Error('Subscription not found');
  }

  if (!subscription.is_manual) {
    // For detected subscriptions, just set status to cancelled
    await database.query(
      `UPDATE subscriptions SET status = 'cancelled', updated_at = datetime('now') WHERE id = $1`,
      [id]
    );
    const truthResult = syncTruthFromSubscription(id, { status: 'cancelled' });
    return { success: true, action: 'cancelled', ...(truthResult || {}) };
  }

  const truthResult = syncTruthFromSubscription(id, { status: 'cancelled' });
  // Delete manual subscription
  await database.query('DELETE FROM subscriptions WHERE id = $1', [id]);

  return { success: true, action: 'deleted', ...(truthResult || {}) };
}

/**
 * Dismiss an alert
 */
async function dismissAlert(alertId) {
  await database.query(
    `UPDATE subscription_alerts SET
      is_dismissed = 1,
      dismissed_at = datetime('now')
    WHERE id = $1`,
    [alertId]
  );

  return { success: true };
}

/**
 * Compute status for a newly detected subscription based on confidence signals.
 * High-confidence patterns become 'active'; low-confidence ones become 'keep'.
 */
function computeAutoStatus(sub) {
  const score = sub.consistency_score || 0;
  const occurrences = sub.occurrence_count || 0;
  const isFixed = sub.amount_is_fixed === 1;

  if (score >= 0.6 && occurrences >= 3) return 'active';
  if (score >= 0.4 && occurrences >= 3 && isFixed) return 'active';
  return 'keep';
}

/**
 * Refresh subscription detection
 * Syncs detected patterns with subscriptions table
 */
let lastAutoDetectionAt = 0;

async function refreshDetection(input = {}) {
  let locale = 'he';
  if (typeof input === 'string') {
    locale = input;
  } else if (input && typeof input === 'object') {
    locale = input.locale || locale;
  }

  const { subscriptions } = await getSubscriptions({ locale });

  let created = 0;
  let updated = 0;

  for (const sub of subscriptions) {
    if (sub.id) {
      // Update existing subscription with fresh detection data
      if (sub.status === 'review') {
        // Reclassify leftover 'review' subscriptions using auto-classification
        await database.query(
          `UPDATE subscriptions SET
            detected_frequency = $1,
            detected_amount = $2,
            consistency_score = $3,
            last_charge_date = $4,
            next_expected_date = $5,
            status = $6,
            updated_at = datetime('now')
          WHERE id = $7`,
          [
            sub.detected_frequency,
            sub.detected_amount,
            sub.consistency_score,
            sub.last_charge_date,
            sub.next_expected_date,
            computeAutoStatus(sub),
            sub.id
          ]
        );
      } else {
        await database.query(
          `UPDATE subscriptions SET
            detected_frequency = $1,
            detected_amount = $2,
            consistency_score = $3,
            last_charge_date = $4,
            next_expected_date = $5,
            updated_at = datetime('now')
          WHERE id = $6`,
          [
            sub.detected_frequency,
            sub.detected_amount,
            sub.consistency_score,
            sub.last_charge_date,
            sub.next_expected_date,
            sub.id
          ]
        );
      }
      updated++;
    } else {
      // Create new subscription record
      await database.query(
        `INSERT INTO subscriptions (
          pattern_key, display_name, detected_frequency, detected_amount,
          amount_is_fixed, consistency_score, status, category_definition_id,
          first_detected_date, last_charge_date, next_expected_date,
          is_manual, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, datetime('now'), datetime('now'))
        ON CONFLICT(pattern_key) DO UPDATE SET
          detected_frequency = $3,
          detected_amount = $4,
          consistency_score = $6,
          last_charge_date = $10,
          next_expected_date = $11,
          updated_at = datetime('now')`,
        [
          sub.pattern_key,
          sub.display_name,
          sub.detected_frequency,
          sub.detected_amount,
          sub.amount_is_fixed,
          sub.consistency_score,
          computeAutoStatus(sub),
          sub.category_definition_id,
          sub.first_detected_date,
          sub.last_charge_date,
          sub.next_expected_date
        ]
      );
      created++;
    }
  }

  return { success: true, created, updated };
}

async function maybeRunAutoDetection({ locale = 'he', debounceMs = 30 * 60 * 1000 } = {}) {
  const now = Date.now();
  if (now - lastAutoDetectionAt < debounceMs) {
    return { success: false, skipped: true, reason: 'debounced' };
  }
  lastAutoDetectionAt = now;
  return refreshDetection({ locale });
}

module.exports = {
  getSubscriptions,
  getSubscriptionSummary,
  getSubscriptionCreep,
  getSubscriptionAlerts,
  getUpcomingRenewals,
  updateSubscription,
  addManualSubscription,
  deleteSubscription,
  dismissAlert,
  refreshDetection,
  maybeRunAutoDetection,
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __setRecurringAnalyzer(mock = {}) {
    recurringAnalyzerRef = {
      ...defaultRecurringAnalyzer,
      ...mock,
    };
  },
  __setFinancialTruth(mock) {
    financialTruth = mock || actualFinancialTruth;
  },
  __resetDependencies() {
    database = actualDatabase;
    financialTruth = actualFinancialTruth;
    recurringAnalyzerRef = { ...defaultRecurringAnalyzer };
    lastAutoDetectionAt = 0;
  },
};
