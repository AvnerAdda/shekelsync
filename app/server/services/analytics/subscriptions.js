const actualDatabase = require('../database.js');
const { getLocalizedCategoryName } = require('../../../lib/server/locale-utils.js');
const { getCreditCardRepaymentCategoryCondition } = require('../accounts/repayment-category.js');

let database = actualDatabase;

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
  const { patterns } = await recurringAnalyzerRef.analyzeRecurringPatterns({
    monthsBack: 6,
    minOccurrences: 2,
    minConsistency: 0.3,
    minVariableAmount: 50,
    aggregateBy: 'day',
    excludeCreditCardRepayments: true,
  });

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
    const categoryDefinitionId = storedSub?.category_definition_id ?? pattern.category_definition_id ?? null;

    const subscription = {
      id: storedSub?.id || null,
      pattern_key: pattern.pattern_key,
      display_name: storedSub?.display_name || pattern.display_name,
      detected_frequency: pattern.detected_frequency,
      detected_amount: pattern.detected_amount,
      amount_is_fixed: storedSub?.amount_is_fixed ?? pattern.amount_is_fixed,
      consistency_score: pattern.consistency_score,
      user_frequency: storedSub?.user_frequency || null,
      user_amount: storedSub?.user_amount || null,
      billing_day: storedSub?.billing_day || null,
      status: storedSub?.status || 'active',
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
      next_expected_date: calculateNextExpectedDate(
        pattern.last_charge_date,
        storedSub?.user_frequency || pattern.detected_frequency
      ),
      is_manual: storedSub?.is_manual || 0,
      notes: storedSub?.notes || null,
      occurrence_count: pattern.occurrence_count,
      total_spent: pattern.total_spent
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
    if (status && storedSub.status !== status) continue;
    if (frequency && (storedSub.user_frequency || storedSub.detected_frequency) !== frequency) continue;

    subscriptions.push({
      ...storedSub,
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
      total_spent: 0
    });
  }

  // Sort by total spent descending
  subscriptions.sort((a, b) => (b.total_spent || 0) - (a.total_spent || 0));

  return { subscriptions };
}

/**
 * Calculate interval consistency score
 */
/**
 * Get subscription cost summary
 */
async function getSubscriptionSummary(options = {}) {
  const { locale = 'he' } = options;
  const { subscriptions } = await getSubscriptions({ locale });

  const activeSubscriptions = subscriptions.filter(s => s.status === 'active');

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
  const { subscriptions } = await getSubscriptions();
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
    months_analyzed: months
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
      s.detected_frequency
    FROM subscription_alerts sa
    JOIN subscriptions s ON sa.subscription_id = s.id
    WHERE (sa.is_dismissed = 0 OR $1 = 1)
      AND (sa.expires_at IS NULL OR sa.expires_at > datetime('now'))
    ORDER BY
      CASE sa.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      sa.created_at DESC`,
    [include_dismissed ? 1 : 0]
  );

  const alerts = alertsResult.rows || [];

  // Detect new alerts from patterns
  const newAlerts = await detectNewAlerts(locale);

  return {
    alerts: [...alerts, ...newAlerts],
    total_count: alerts.length + newAlerts.length,
    critical_count: [...alerts, ...newAlerts].filter(a => a.severity === 'critical').length,
    warning_count: [...alerts, ...newAlerts].filter(a => a.severity === 'warning').length
  };
}

/**
 * Detect new alerts from transaction patterns
 */
async function detectNewAlerts(locale = 'he') {
  const alerts = [];
  const { subscriptions } = await getSubscriptions({ locale });
  const repaymentCategoryCondition = getCreditCardRepaymentCategoryCondition('cd');

  const today = new Date();

  for (const sub of subscriptions) {
    if (sub.status !== 'active') continue;

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

      if (previous > 0 && current > previous) {
        const percentChange = ((current - previous) / previous) * 100;

        if (percentChange >= 5) {
          alerts.push({
            id: null, // Not stored yet
            subscription_id: sub.id,
            subscription_name: sub.display_name,
            alert_type: 'price_increase',
            severity: percentChange >= 20 ? 'critical' : 'warning',
            title: `Price increase detected for ${sub.display_name}`,
            description: `The price has increased from ${previous.toFixed(2)} to ${current.toFixed(2)} (${percentChange.toFixed(1)}% increase)`,
            old_amount: previous,
            new_amount: current,
            percentage_change: Math.round(percentChange * 100) / 100,
            is_dismissed: 0,
            created_at: new Date().toISOString()
          });
        }
      }
    }

    // Check for missed charges
    if (sub.next_expected_date) {
      const expectedDate = new Date(sub.next_expected_date);
      const daysPastDue = Math.floor((today - expectedDate) / (1000 * 60 * 60 * 24));

      if (daysPastDue > 7) {
        alerts.push({
          id: null,
          subscription_id: sub.id,
          subscription_name: sub.display_name,
          alert_type: 'missed_charge',
          severity: daysPastDue > 30 ? 'warning' : 'info',
          title: `Missed charge for ${sub.display_name}`,
          description: `Expected charge on ${sub.next_expected_date} has not been detected (${daysPastDue} days overdue)`,
          old_amount: null,
          new_amount: null,
          percentage_change: null,
          is_dismissed: 0,
          created_at: new Date().toISOString()
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
  const { subscriptions } = await getSubscriptions({ locale });

  const today = new Date();
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + days);

  const renewals = subscriptions
    .filter(sub => {
      if (sub.status !== 'active' || !sub.next_expected_date) return false;
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

  return { renewals };
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

  return { success: true, id };
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

  return { success: true, id };
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
    return { success: true, action: 'cancelled' };
  }

  // Delete manual subscription
  await database.query('DELETE FROM subscriptions WHERE id = $1', [id]);

  return { success: true, action: 'deleted' };
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
 * Refresh subscription detection
 * Syncs detected patterns with subscriptions table
 */
let lastAutoDetectionAt = 0;

async function refreshDetection(input = {}) {
  let locale = 'he';
  let defaultStatus = 'active';
  if (typeof input === 'string') {
    locale = input;
  } else if (input && typeof input === 'object') {
    locale = input.locale || locale;
    defaultStatus = input.defaultStatus || defaultStatus;
  }
  const allowedStatuses = new Set(['active', 'paused', 'cancelled', 'keep', 'review']);
  if (!allowedStatuses.has(defaultStatus)) {
    defaultStatus = 'active';
  }

  const { subscriptions } = await getSubscriptions({ locale });

  let created = 0;
  let updated = 0;

  for (const sub of subscriptions) {
    if (sub.id) {
      // Update existing subscription with fresh detection data
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
          defaultStatus,
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

async function maybeRunAutoDetection({ locale = 'he', defaultStatus = 'review', debounceMs = 30 * 60 * 1000 } = {}) {
  const now = Date.now();
  if (now - lastAutoDetectionAt < debounceMs) {
    return { success: false, skipped: true, reason: 'debounced' };
  }
  lastAutoDetectionAt = now;
  return refreshDetection({ locale, defaultStatus });
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
  __resetDependencies() {
    database = actualDatabase;
    recurringAnalyzerRef = { ...defaultRecurringAnalyzer };
    lastAutoDetectionAt = 0;
  },
};
