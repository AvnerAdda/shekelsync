/**
 * Financial Context Builder Module
 * Builds efficient financial context for OpenAI based on user permissions
 */

const { dialect } = require('../../../lib/sql-dialect.js');
const { resolveDateRange } = require('../../../lib/server/query-utils.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');
const optimizerService = require('../optimizer.js');

const TARGET_SPENDING_CATEGORIES = new Set(['essential', 'growth', 'stability', 'reward']);

// Test seam: vitest module mocks never reach the CJS require() below in this
// repo's setup, so tests inject a fake loader through the exported setter.
let spendingBreakdownLoader = null;

function __setSpendingBreakdownLoader(loader) {
  spendingBreakdownLoader = loader;
}

async function loadSpendingCategoryBreakdown(params) {
  if (spendingBreakdownLoader) {
    return spendingBreakdownLoader(params);
  }
  const { getSpendingCategoryBreakdown } = require('../analytics/spending-categories.js');
  return getSpendingCategoryBreakdown(params);
}

const PAIRING_EXCLUSION_JOIN = `
  LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
    ON t.identifier = tpe.transaction_identifier
    AND t.vendor = tpe.transaction_vendor
`;
const EXCLUDE_PIKADON = dialect.excludePikadon('t');
const CATEGORY_TYPE_EXPR = 'COALESCE(cd.category_type, t.category_type)';
const INCOME_CASE = `
  (
    (${CATEGORY_TYPE_EXPR} = 'income' AND t.price > 0 AND COALESCE(cd.is_counted_as_income, 1) = 1)
    OR (${CATEGORY_TYPE_EXPR} IS NULL AND t.price > 0)
    OR (COALESCE(cd.name, '') = $3 AND t.price > 0)
  )
`;
const EXPENSE_CASE = `
  (
    (${CATEGORY_TYPE_EXPR} = 'expense' OR (${CATEGORY_TYPE_EXPR} IS NULL AND t.price < 0))
    AND t.price < 0
  )
`;

function normalizeText(value, maxLen = 120) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLen);
}

function normalizeNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

async function optionalQuery(db, sql, params = [], fallbackRows = []) {
  try {
    const result = await db.query(sql, params);
    return result.rows || fallbackRows;
  } catch {
    return fallbackRows;
  }
}

function normalizeDateString(value) {
  if (!value) {
    return null;
  }
  return String(value).slice(0, 10);
}

function hasProfileData(profile = null) {
  if (!profile || typeof profile !== 'object') {
    return false;
  }
  return Boolean(
    profile.name
    || profile.maritalStatus
    || hasValue(profile.age)
    || profile.ageBand
    || profile.occupation
    || profile.employmentStatus
    || hasValue(profile.monthlyIncome)
    || profile.incomeBand
    || profile.location
    || profile.familyStatus
    || profile.industry
    || profile.spouseName
    || profile.spouseOccupation
    || hasValue(profile.spouseMonthlyIncome)
    || profile.spouseIncomeBand
    || hasValue(profile.childrenCount)
    || hasValue(profile.householdSize)
  );
}

function smartActionNextStep(actionType) {
  const normalized = normalizeText(actionType, 80);
  if (!normalized) {
    return 'review this active action item';
  }
  if (normalized.includes('subscription')) {
    return 'review the subscription and decide whether to keep, renegotiate, or cancel';
  }
  if (normalized.includes('fixed_cost')) {
    return 'compare the fixed cost and identify one lower-friction reduction';
  }
  if (normalized.includes('weekend')) {
    return 'set a weekend guardrail before the next high-spend period';
  }
  if (normalized.includes('reduce_spending')) {
    return 'choose one spending category to reduce this month';
  }
  return 'review this active action item';
}

async function getSmartActionsContext(db) {
  // 'accepted' quests are in progress and still actionable (quests.js treats
  // active+accepted as live); deadlines are only set on acceptance. Positive
  // impacts alone feed the savings figure so cost warnings don't net it down,
  // while ordering uses absolute impact so urgent cost increases still rank.
  const rows = await optionalQuery(db, `
    SELECT
      action_type,
      severity,
      COUNT(*) as action_count,
      SUM(CASE WHEN potential_impact > 0 THEN potential_impact ELSE 0 END) as potential_impact,
      AVG(COALESCE(detection_confidence, 0)) as avg_confidence,
      MIN(deadline) as nearest_deadline
    FROM smart_action_items
    WHERE user_status IN ('active', 'accepted')
      AND dismissed_at IS NULL
      AND resolved_at IS NULL
    GROUP BY action_type, severity
    ORDER BY SUM(ABS(COALESCE(potential_impact, 0))) DESC, action_count DESC
    LIMIT 8
  `);

  return rows.map((row) => ({
    actionType: normalizeText(row.action_type, 80) || 'action',
    severity: normalizeText(row.severity, 40) || 'medium',
    count: normalizeInt(row.action_count) || 0,
    potentialImpact: normalizeNumber(row.potential_impact) || 0,
    confidence: normalizeNumber(row.avg_confidence),
    nearestDeadline: normalizeDateString(row.nearest_deadline),
    nextStep: smartActionNextStep(row.action_type),
  })).filter((item) => item.count > 0);
}

function subscriptionMonthlySql(alias = 's') {
  return `
    CASE COALESCE(${alias}.user_frequency, ${alias}.detected_frequency, 'monthly')
      WHEN 'daily' THEN COALESCE(${alias}.user_amount, ${alias}.detected_amount, 0) * 30
      WHEN 'weekly' THEN COALESCE(${alias}.user_amount, ${alias}.detected_amount, 0) * 4.33
      WHEN 'biweekly' THEN COALESCE(${alias}.user_amount, ${alias}.detected_amount, 0) * 2.17
      WHEN 'bimonthly' THEN COALESCE(${alias}.user_amount, ${alias}.detected_amount, 0) / 2
      WHEN 'quarterly' THEN COALESCE(${alias}.user_amount, ${alias}.detected_amount, 0) / 3
      WHEN 'yearly' THEN COALESCE(${alias}.user_amount, ${alias}.detected_amount, 0) / 12
      ELSE COALESCE(${alias}.user_amount, ${alias}.detected_amount, 0)
    END
  `;
}

async function getSubscriptionContext(db) {
  const [byStatusRows, upcomingRows, alertRows] = await Promise.all([
    optionalQuery(db, `
      SELECT
        status,
        COUNT(*) as subscription_count,
        SUM(${subscriptionMonthlySql('s')}) as monthly_total
      FROM subscriptions s
      WHERE status IN ('active', 'keep', 'review', 'paused')
      GROUP BY status
      ORDER BY subscription_count DESC
    `),
    optionalQuery(db, `
      SELECT
        COUNT(*) as renewal_count,
        MIN(next_expected_date) as next_renewal_date,
        SUM(${subscriptionMonthlySql('s')}) as monthly_total
      FROM subscriptions s
      WHERE status = 'active'
        AND next_expected_date IS NOT NULL
        AND next_expected_date >= date('now', 'localtime')
        AND next_expected_date <= date('now', 'localtime', '+30 day')
    `),
    optionalQuery(db, `
      SELECT
        severity,
        COUNT(*) as alert_count
      FROM subscription_alerts alert
      LEFT JOIN subscriptions subscription ON subscription.id = alert.subscription_id
      WHERE COALESCE(alert.is_dismissed, 0) = 0
        AND (alert.expires_at IS NULL OR alert.expires_at > datetime('now'))
        AND (alert.subscription_id IS NULL OR subscription.status IN ('active', 'keep', 'review'))
      GROUP BY severity
    `),
  ]);

  const byStatus = byStatusRows.map((row) => ({
    status: normalizeText(row.status, 40) || 'active',
    count: normalizeInt(row.subscription_count) || 0,
    monthlyTotal: normalizeNumber(row.monthly_total) || 0,
  })).filter((row) => row.count > 0);

  const upcoming = upcomingRows[0] ? {
    count: normalizeInt(upcomingRows[0].renewal_count) || 0,
    nextRenewalDate: normalizeDateString(upcomingRows[0].next_renewal_date),
    monthlyTotal: normalizeNumber(upcomingRows[0].monthly_total) || 0,
  } : { count: 0, nextRenewalDate: null, monthlyTotal: 0 };

  const alerts = alertRows.map((row) => ({
    severity: normalizeText(row.severity, 40) || 'info',
    count: normalizeInt(row.alert_count) || 0,
  })).filter((row) => row.count > 0);

  return byStatus.length > 0 || upcoming.count > 0 || alerts.length > 0
    ? { byStatus, upcoming, alerts }
    : null;
}

async function getSpendingTargetContext() {
  // Reuse the Spending Categories screen's own calculation (capital-return
  // exclusions, investment-into-growth merge) so the prompt can never quote
  // drift numbers that contradict the dashboard.
  let result;
  try {
    result = await loadSpendingCategoryBreakdown({ currentMonthOnly: true });
  } catch {
    return [];
  }

  const rows = Array.isArray(result?.breakdown) ? result.breakdown : [];
  return rows
    .filter((row) => TARGET_SPENDING_CATEGORIES.has(row.spending_category))
    .map((row) => {
      const amount = normalizeNumber(row.total_amount) || 0;
      const targetPercentage = Math.round(normalizeNumber(row.target_percentage) || 0);
      const actualPercentage = Math.round(normalizeNumber(row.actual_percentage) || 0);
      return {
        spendingCategory: normalizeText(row.spending_category, 40) || 'unallocated',
        targetPercentage,
        actualPercentage,
        driftPercentage: actualPercentage - targetPercentage,
        amount,
      };
    })
    .filter((row) => row.targetPercentage > 0 || row.amount > 0);
}

async function getDataFreshnessContext(db) {
  const [transactionRows, scrapeRows] = await Promise.all([
    optionalQuery(db, `
      SELECT
        COUNT(*) as transaction_count,
        MIN(date) as earliest_transaction_date,
        MAX(date) as latest_transaction_date,
        COUNT(DISTINCT substr(date, 1, 7)) as active_months
      FROM transactions
      WHERE status = 'completed'
    `),
    optionalQuery(db, `
      SELECT
        COUNT(*) as scrape_count,
        MAX(created_at) as latest_scrape_at
      FROM scrape_events
    `),
  ]);

  const transaction = transactionRows[0] || {};
  const scrape = scrapeRows[0] || {};
  return {
    transactionCount: normalizeInt(transaction.transaction_count) || 0,
    earliestTransactionDate: normalizeDateString(transaction.earliest_transaction_date),
    latestTransactionDate: normalizeDateString(transaction.latest_transaction_date),
    activeMonths: normalizeInt(transaction.active_months) || 0,
    scrapeCount: normalizeInt(scrape.scrape_count) || 0,
    latestScrapeAt: normalizeDateString(scrape.latest_scrape_at),
  };
}

async function getInvestmentContext(db) {
  const holdingRows = await optionalQuery(db, `
    SELECT
      COUNT(DISTINCT ia.id) as account_count,
      COUNT(ih.id) as holding_count,
      SUM(COALESCE(ih.current_value, 0)) as total_value,
      SUM(CASE WHEN ia.is_liquid = 1 THEN COALESCE(ih.current_value, 0) ELSE 0 END) as liquid_value,
      MAX(ih.as_of_date) as latest_as_of_date
    FROM investment_accounts ia
    LEFT JOIN investment_holdings ih ON ih.account_id = ia.id
      AND COALESCE(ih.status, 'active') = 'active'
    WHERE ia.is_active = 1
  `);

  const holdingRow = holdingRows[0] || {};
  const holdingTotal = normalizeNumber(holdingRow.total_value) || 0;
  const holdingCount = normalizeInt(holdingRow.holding_count) || 0;
  const accountCount = normalizeInt(holdingRow.account_count) || 0;
  // SUM(COALESCE(...)) yields 0 (not NULL) whenever any active account row
  // exists, so only synced holdings with real value may claim the section —
  // otherwise the prompt would assert a ₪0 portfolio for accounts whose
  // holdings simply haven't synced yet.
  if (holdingCount > 0 && holdingTotal > 0) {
    return {
      totalValue: holdingTotal,
      liquidValue: normalizeNumber(holdingRow.liquid_value) || 0,
      accountCount,
      holdingCount,
      latestAsOfDate: normalizeDateString(holdingRow.latest_as_of_date),
    };
  }

  // Legacy DBs stored per-account values on investment_accounts.current_value
  // (absent from the current schema — there the query fails and we omit the
  // section rather than reporting zero).
  const legacyRows = await optionalQuery(db, `
    SELECT
      SUM(current_value) as total_value,
      SUM(CASE WHEN is_liquid = 1 THEN current_value ELSE 0 END) as liquid_value,
      COUNT(DISTINCT id) as account_count
    FROM investment_accounts
    WHERE is_active = 1
  `);
  const legacyRow = legacyRows[0] || {};
  const legacyTotal = normalizeNumber(legacyRow.total_value) || 0;
  if (legacyTotal > 0) {
    return {
      totalValue: legacyTotal,
      liquidValue: normalizeNumber(legacyRow.liquid_value) || 0,
      accountCount: normalizeInt(legacyRow.account_count) || 0,
      holdingCount: null,
      latestAsOfDate: null,
    };
  }

  return null;
}

async function getProfileContext(db) {
  try {
    const result = await db.query(`
      SELECT
        up.username,
        up.marital_status,
        up.age,
        up.occupation,
        up.monthly_income,
        up.employment_status,
        up.family_status,
        up.location,
        up.industry,
        up.children_count,
        up.household_size,
        sp.name as spouse_name,
        sp.occupation as spouse_occupation,
        sp.monthly_income as spouse_monthly_income,
        (
          SELECT COUNT(*)
          FROM children_profile cp
          WHERE cp.user_profile_id = up.id
        ) as children_count_actual
      FROM user_profile up
      LEFT JOIN spouse_profile sp ON sp.user_profile_id = up.id
      ORDER BY up.id ASC
      LIMIT 1
    `);

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const childrenCount = normalizeInt(row.children_count_actual ?? row.children_count);
    const profile = {
      name: normalizeText(row.username, 80),
      maritalStatus: normalizeText(row.marital_status, 64),
      age: normalizeInt(row.age),
      occupation: normalizeText(row.occupation, 120),
      employmentStatus: normalizeText(row.employment_status, 64),
      monthlyIncome: normalizeNumber(row.monthly_income),
      familyStatus: normalizeText(row.family_status, 120),
      location: normalizeText(row.location, 120),
      industry: normalizeText(row.industry, 120),
      childrenCount,
      householdSize: normalizeInt(row.household_size),
      spouseName: normalizeText(row.spouse_name, 80),
      spouseOccupation: normalizeText(row.spouse_occupation, 120),
      spouseMonthlyIncome: normalizeNumber(row.spouse_monthly_income),
    };

    return hasProfileData(profile) ? profile : null;
  } catch {
    // Profile tables might not exist in older DBs.
    return null;
  }
}

function formatProfileSection(profile) {
  if (!hasProfileData(profile)) {
    return [];
  }

  const lines = ['\nUSER PROFILE:'];
  if (profile.name) lines.push(`- Name: ${profile.name}`);
  if (profile.maritalStatus) lines.push(`- Marital status: ${profile.maritalStatus}`);
  if (profile.ageBand) {
    lines.push(`- Age band: ${profile.ageBand}`);
  } else if (hasValue(profile.age)) {
    lines.push(`- Age: ${profile.age}`);
  }
  if (profile.occupation) lines.push(`- Occupation: ${profile.occupation}`);
  if (profile.employmentStatus) lines.push(`- Employment status: ${profile.employmentStatus}`);
  if (profile.incomeBand) {
    lines.push(`- Reported monthly income band: ${profile.incomeBand}`);
  } else if (hasValue(profile.monthlyIncome)) {
    lines.push(`- Reported monthly income: ₪${Math.round(profile.monthlyIncome).toLocaleString()}`);
  }
  if (profile.familyStatus) lines.push(`- Family status: ${profile.familyStatus}`);
  if (profile.location) lines.push(`- Location: ${profile.location}`);
  if (profile.industry) lines.push(`- Industry: ${profile.industry}`);
  if (hasValue(profile.householdSize)) lines.push(`- Household size: ${profile.householdSize}`);
  if (hasValue(profile.childrenCount)) lines.push(`- Children: ${profile.childrenCount}`);
  if (profile.spouseName) lines.push(`- Spouse: ${profile.spouseName}`);
  if (profile.spouseOccupation) lines.push(`- Spouse occupation: ${profile.spouseOccupation}`);
  if (profile.spouseIncomeBand) {
    lines.push(`- Spouse monthly income band: ${profile.spouseIncomeBand}`);
  } else if (hasValue(profile.spouseMonthlyIncome)) {
    lines.push(`- Spouse monthly income: ₪${Math.round(profile.spouseMonthlyIncome).toLocaleString()}`);
  }
  return lines;
}

/**
 * Build financial context respecting user permissions
 * @param {Object} db - Database client
 * @param {Object} permissions - User's chatbot permissions
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Financial context object
 */
async function buildContext(db, permissions, options = {}) {
  const months = options.months || 6;
  const { start, end } = resolveDateRange({
    startDate: options.startDate,
    endDate: options.endDate,
    months,
  });
  const startDateStr = start.toISOString().split('T')[0];
  const endDateStr = end.toISOString().split('T')[0];

  const context = {
    hasData: false,
    truthRevision: 0,
    permissions: {
      transactions: permissions.allowTransactionAccess,
      categories: permissions.allowCategoryAccess,
      analytics: permissions.allowAnalyticsAccess,
    },
  };

  if (options.includeTruthRevision === true) {
    const truthRows = await optionalQuery(
      db,
      'SELECT revision FROM financial_truth_state WHERE id = 1',
    );
    context.truthRevision = normalizeInt(truthRows[0]?.revision) || 0;
  }

  // Always get basic summary stats (no permission needed for aggregates)
  const summaryResult = await db.query(`
    SELECT
      COUNT(*) as transaction_count,
      SUM(CASE WHEN ${INCOME_CASE} THEN t.price ELSE 0 END) as total_income,
      SUM(CASE WHEN ${EXPENSE_CASE} THEN ABS(t.price) ELSE 0 END) as total_expenses,
      MIN(t.date) as earliest_date,
      MAX(t.date) as latest_date
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    ${PAIRING_EXCLUSION_JOIN}
    WHERE t.date >= $1 AND t.date <= $2
      AND tpe.transaction_identifier IS NULL
      AND ${EXCLUDE_PIKADON}
  `, [startDateStr, endDateStr, BANK_CATEGORY_NAME]);

  const summary = summaryResult.rows[0] || {};
  context.summary = {
    transactionCount: parseInt(summary.transaction_count || 0, 10),
    totalIncome: parseFloat(summary.total_income || 0),
    totalExpenses: parseFloat(summary.total_expenses || 0),
    timeRange: {
      months,
      from: summary.earliest_date,
      to: summary.latest_date,
    },
  };

  context.hasData = context.summary.transactionCount > 0;
  context.profile = await getProfileContext(db);

  // Category breakdown (requires category permission)
  if (permissions.allowCategoryAccess) {
    const categoriesResult = await db.query(`
      SELECT
        COALESCE(parent.name, cd.name) as category,
        COALESCE(parent.category_type, cd.category_type, t.category_type) as category_type,
        SUM(ABS(t.price)) as total_expenses,
        COUNT(*) as count
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      ${PAIRING_EXCLUSION_JOIN}
      WHERE t.date >= $1 AND t.date <= $2
        AND t.price < 0
        AND (
          COALESCE(parent.category_type, cd.category_type, t.category_type) = 'expense'
          OR (parent.category_type IS NULL AND cd.category_type IS NULL AND t.category_type IS NULL)
        )
        AND tpe.transaction_identifier IS NULL
        AND ${EXCLUDE_PIKADON}
      GROUP BY COALESCE(parent.name, cd.name), COALESCE(parent.category_type, cd.category_type, t.category_type)
      ORDER BY total_expenses DESC
      LIMIT 25
    `, [startDateStr, endDateStr]);

    context.categories = categoriesResult.rows.map(c => ({
      name: c.category || 'Uncategorized',
      type: c.category_type,
      totalExpenses: parseFloat(c.total_expenses || 0),
      count: parseInt(c.count, 10),
    }));

    // Get budget status
    const budgetResult = await db.query(`
      SELECT
        cd.name as category,
        cb.budget_limit as budget,
        SUM(CASE WHEN t.price < 0 AND tpe.transaction_identifier IS NULL AND ${EXCLUDE_PIKADON}
          THEN ABS(t.price) ELSE 0 END) as spent
      FROM category_budgets cb
      JOIN category_definitions cd ON cb.category_definition_id = cd.id
      LEFT JOIN transactions t ON t.category_definition_id = cd.id
        AND t.date >= date('now', 'start of month')
        AND t.price < 0
      LEFT JOIN transaction_pairing_exclusions tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE cb.is_active = 1 AND cb.period_type = 'monthly'
      GROUP BY cd.id, cd.name, cb.budget_limit
    `);

    context.budgets = budgetResult.rows.map(b => ({
      category: b.category,
      budget: parseFloat(b.budget || 0),
      spent: parseFloat(b.spent || 0),
      remaining: parseFloat(b.budget || 0) - parseFloat(b.spent || 0),
      percentUsed: b.budget > 0 ? Math.round((parseFloat(b.spent || 0) / parseFloat(b.budget)) * 100) : 0,
    }));
  }

  // Recent transactions (requires transaction permission)
  if (permissions.allowTransactionAccess) {
    const recentResult = await db.query(`
      SELECT
        t.name,
        t.merchant_name,
        t.price,
        t.date,
        COALESCE(parent.name, cd.name) as category,
        t.vendor
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      ${PAIRING_EXCLUSION_JOIN}
      WHERE tpe.transaction_identifier IS NULL
        AND ${EXCLUDE_PIKADON}
      ORDER BY t.date DESC
      LIMIT 50
    `);

    context.recentTransactions = recentResult.rows.map(t => ({
      name: t.name,
      merchantName: t.merchant_name,
      price: parseFloat(t.price),
      date: t.date,
      category: t.category,
      vendor: t.vendor,
    }));

    // Top merchants
    const merchantsResult = await db.query(`
      SELECT
        merchant_name,
        COUNT(*) as visit_count,
        SUM(ABS(price)) as total_spent,
        AVG(ABS(price)) as avg_transaction
      FROM transactions t
      ${PAIRING_EXCLUSION_JOIN}
      WHERE date >= $1 AND date <= $2
        AND price < 0
        AND merchant_name IS NOT NULL
        AND tpe.transaction_identifier IS NULL
        AND ${EXCLUDE_PIKADON}
      GROUP BY merchant_name
      ORDER BY total_spent DESC
      LIMIT 20
    `, [startDateStr, endDateStr]);

    context.topMerchants = merchantsResult.rows.map(m => ({
      name: m.merchant_name,
      visits: parseInt(m.visit_count, 10),
      total: parseFloat(m.total_spent || 0),
      avgTransaction: parseFloat(m.avg_transaction || 0),
    }));

    // Recurring transactions (merchants appearing 3+ times)
    const recurringResult = await db.query(`
      SELECT
        merchant_name,
        COUNT(*) as occurrence_count,
        AVG(ABS(price)) as avg_amount,
        MIN(date) as first_seen,
        MAX(date) as last_seen
      FROM transactions t
      ${PAIRING_EXCLUSION_JOIN}
      WHERE date >= $1 AND date <= $2
        AND price < 0
        AND merchant_name IS NOT NULL
        AND tpe.transaction_identifier IS NULL
        AND ${EXCLUDE_PIKADON}
      GROUP BY merchant_name
      HAVING COUNT(*) >= 3
      ORDER BY occurrence_count DESC
      LIMIT 15
    `, [startDateStr, endDateStr]);

    context.recurringTransactions = recurringResult.rows.map(r => ({
      name: r.merchant_name,
      count: parseInt(r.occurrence_count, 10),
      avgAmount: parseFloat(r.avg_amount || 0),
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
    }));
  }

  // Analytics data (requires analytics permission)
  if (permissions.allowAnalyticsAccess) {
    const monthExpr = dialect.toChar('t.date', 'YYYY-MM');
    // Monthly trends
    const trendsResult = await db.query(`
      SELECT
        ${monthExpr} as month,
        SUM(CASE WHEN ${INCOME_CASE} THEN t.price ELSE 0 END) as income,
        SUM(CASE WHEN ${EXPENSE_CASE} THEN ABS(t.price) ELSE 0 END) as expenses
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      ${PAIRING_EXCLUSION_JOIN}
      WHERE t.date >= $1 AND t.date <= $2
        AND tpe.transaction_identifier IS NULL
        AND ${EXCLUDE_PIKADON}
      GROUP BY ${monthExpr}
      ORDER BY month DESC
    `, [startDateStr, endDateStr, BANK_CATEGORY_NAME]);

    context.monthlyTrends = trendsResult.rows.map(t => ({
      month: t.month,
      income: parseFloat(t.income || 0),
      expenses: parseFloat(t.expenses || 0),
      netSavings: parseFloat(t.income || 0) - parseFloat(t.expenses || 0),
    }));

    // Calculate averages and projections
    if (context.monthlyTrends.length > 0) {
      const avgIncome = context.monthlyTrends.reduce((s, t) => s + t.income, 0) / context.monthlyTrends.length;
      const avgExpenses = context.monthlyTrends.reduce((s, t) => s + t.expenses, 0) / context.monthlyTrends.length;

      context.analytics = {
        avgMonthlyIncome: Math.round(avgIncome),
        avgMonthlyExpenses: Math.round(avgExpenses),
        avgMonthlySavings: Math.round(avgIncome - avgExpenses),
        savingsRate: avgIncome > 0 ? Math.round(((avgIncome - avgExpenses) / avgIncome) * 100) : 0,
      };
    }

    // Year-over-year comparison
    try {
      const prevYearStart = new Date(start);
      prevYearStart.setFullYear(prevYearStart.getFullYear() - 1);
      const prevYearEnd = new Date(end);
      prevYearEnd.setFullYear(prevYearEnd.getFullYear() - 1);
      const prevStartStr = prevYearStart.toISOString().split('T')[0];
      const prevEndStr = prevYearEnd.toISOString().split('T')[0];

      const yoyResult = await db.query(`
        SELECT
          SUM(CASE WHEN ${INCOME_CASE} THEN t.price ELSE 0 END) as income,
          SUM(CASE WHEN ${EXPENSE_CASE} THEN ABS(t.price) ELSE 0 END) as expenses
        FROM transactions t
        LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
        ${PAIRING_EXCLUSION_JOIN}
        WHERE t.date >= $1 AND t.date <= $2
          AND tpe.transaction_identifier IS NULL
          AND ${EXCLUDE_PIKADON}
      `, [prevStartStr, prevEndStr, BANK_CATEGORY_NAME]);

      const prevYear = yoyResult.rows[0];
      if (prevYear && (parseFloat(prevYear.income || 0) > 0 || parseFloat(prevYear.expenses || 0) > 0)) {
        const prevIncome = parseFloat(prevYear.income || 0);
        const prevExpenses = parseFloat(prevYear.expenses || 0);
        context.yearOverYear = {
          prevPeriodIncome: Math.round(prevIncome),
          prevPeriodExpenses: Math.round(prevExpenses),
          incomeChange: prevIncome > 0 ? Math.round(((context.summary.totalIncome - prevIncome) / prevIncome) * 100) : null,
          expenseChange: prevExpenses > 0 ? Math.round(((context.summary.totalExpenses - prevExpenses) / prevExpenses) * 100) : null,
        };
      }
    } catch {
      // Previous year data might not exist
    }

    const [investments, smartActions] = await Promise.all([
      getInvestmentContext(db),
      getSmartActionsContext(db),
    ]);
    if (investments) {
      context.investments = investments;
    }
    if (smartActions.length > 0) {
      context.smartActions = smartActions;
    }

    if (options.includeOptimizer === true) {
      try {
        const optimizerContext = await optimizerService.getOptimizerContextForChat(db);
        if (optimizerContext.facts.length > 0 || optimizerContext.recommendations.length > 0) {
          context.optimizer = optimizerContext;
        }
      } catch {
        // Optimizer tables might not exist in older DBs.
      }
    }
  }

  if (permissions.allowAnalyticsAccess || permissions.allowTransactionAccess) {
    const [subscriptions, dataFreshness] = await Promise.all([
      getSubscriptionContext(db),
      getDataFreshnessContext(db),
    ]);
    if (subscriptions) {
      context.subscriptions = subscriptions;
    }
    if (dataFreshness.transactionCount > 0 || dataFreshness.scrapeCount > 0) {
      context.dataFreshness = dataFreshness;
    }
  }

  if (permissions.allowAnalyticsAccess || permissions.allowCategoryAccess) {
    const spendingTargets = await getSpendingTargetContext();
    if (spendingTargets.length > 0) {
      context.spendingTargets = spendingTargets;
    }
  }

  return context;
}

function formatSmartActionsSection(smartActions) {
  if (!smartActions || smartActions.length === 0) return [];
  const parts = ['\nACTIVE PROACTIVE ACTIONS:'];
  smartActions.forEach((action, index) => {
    const impact = action.potentialImpact > 0
      ? `, potential impact ₪${Math.round(action.potentialImpact).toLocaleString()}`
      : '';
    const deadline = action.nearestDeadline ? `, nearest deadline ${action.nearestDeadline}` : '';
    parts.push(`${index + 1}. ${action.actionType}: ${action.count} active, severity ${action.severity}${impact}${deadline}. Next: ${action.nextStep}`);
  });
  return parts;
}

function formatSubscriptionsSection(subscriptions) {
  if (!subscriptions) return [];
  const parts = ['\nSUBSCRIPTION SIGNALS:'];
  if (subscriptions.byStatus && subscriptions.byStatus.length > 0) {
    subscriptions.byStatus.forEach((status) => {
      // Cancelled/paused subscriptions are not an ongoing cost — quoting a
      // monthly figure for them misleads the model into counting them.
      const isOngoingCost = !['cancelled', 'paused'].includes(status.status);
      const cost = isOngoingCost ? `, approx ₪${Math.round(status.monthlyTotal).toLocaleString()}/mo` : '';
      parts.push(`- ${status.status}: ${status.count} subscriptions${cost}`);
    });
  }
  if (subscriptions.upcoming?.count > 0) {
    const next = subscriptions.upcoming.nextRenewalDate ? `, next renewal ${subscriptions.upcoming.nextRenewalDate}` : '';
    parts.push(`- Upcoming renewals: ${subscriptions.upcoming.count} in the next 30 days${next}`);
  }
  if (subscriptions.alerts && subscriptions.alerts.length > 0) {
    subscriptions.alerts.forEach((alert) => {
      parts.push(`- ${alert.severity} subscription alerts: ${alert.count}`);
    });
  }
  return parts.length > 1 ? parts : [];
}

function formatSpendingTargetsSection(spendingTargets) {
  if (!spendingTargets || spendingTargets.length === 0) return [];
  const parts = ['\nSPENDING TARGETS (This Month):'];
  spendingTargets.forEach((target) => {
    const drift = target.driftPercentage >= 0 ? `+${target.driftPercentage}` : String(target.driftPercentage);
    parts.push(`- ${target.spendingCategory}: actual ${target.actualPercentage}% vs target ${target.targetPercentage}% (${drift} pts), ₪${Math.round(target.amount).toLocaleString()}`);
  });
  return parts;
}

function formatDataFreshnessSection(dataFreshness) {
  if (!dataFreshness) return [];
  const parts = ['\nDATA FRESHNESS:'];
  if (dataFreshness.transactionCount > 0) {
    parts.push(`- ${dataFreshness.transactionCount} completed transactions across ${dataFreshness.activeMonths} active months`);
  }
  if (dataFreshness.latestTransactionDate) {
    parts.push(`- Latest transaction date: ${dataFreshness.latestTransactionDate}`);
  }
  if (dataFreshness.latestScrapeAt) {
    parts.push(`- Latest sync event: ${dataFreshness.latestScrapeAt}`);
  }
  return parts.length > 1 ? parts : [];
}

function formatOptimizerSections(optimizer) {
  if (!optimizer) return [];
  const parts = [];
  if (optimizer.facts && optimizer.facts.length > 0) {
    parts.push('\nOPTIMIZATOR CONFIRMED PROFILE FACTS:');
    optimizer.facts.forEach((fact) => {
      parts.push(`- ${fact.label}: ${fact.valueText}`);
    });
  }

  if (optimizer.recommendations && optimizer.recommendations.length > 0) {
    parts.push('\nACTIVE OPTIMIZATOR ACTIONS:');
    optimizer.recommendations.forEach((recommendation, index) => {
      const impact = recommendation.estimatedMonthlyImpact
        ? `, estimated impact ₪${Math.round(recommendation.estimatedMonthlyImpact).toLocaleString()}/mo`
        : '';
      parts.push(`${index + 1}. ${recommendation.title}${impact}, hassle ${recommendation.hassleLevel}. Next: ${recommendation.nextAction || 'review action'}`);
    });
  }
  return parts;
}

/**
 * Format context as a string for the system prompt
 * @param {Object} context - The financial context object
 * @returns {string} Formatted context string
 */
function formatContextForPrompt(context) {
  if (!context.hasData) {
    const profileLines = formatProfileSection(context?.profile);
    const smartActionLines = formatSmartActionsSection(context?.smartActions);
    const subscriptionLines = formatSubscriptionsSection(context?.subscriptions);
    const spendingTargetLines = formatSpendingTargetsSection(context?.spendingTargets);
    const dataFreshnessLines = formatDataFreshnessSection(context?.dataFreshness);
    const optimizerLines = formatOptimizerSections(context?.optimizer);
    const contextLines = [
      ...profileLines,
      ...smartActionLines,
      ...subscriptionLines,
      ...spendingTargetLines,
      ...dataFreshnessLines,
      ...optimizerLines,
    ];
    if (contextLines.length > 0) {
      return `${contextLines.join('\n')}\n\nNo financial data available yet.`;
    }
    return 'No financial data available yet. The user needs to connect their accounts first.';
  }

  const parts = [];
  const profileLines = formatProfileSection(context?.profile);
  if (profileLines.length > 0) {
    parts.push(...profileLines);
  }

  // Summary
  parts.push(`FINANCIAL SUMMARY (Last ${context.summary.timeRange.months} months):`);
  parts.push(`- Total transactions: ${context.summary.transactionCount}`);
  parts.push(`- Total income: ₪${Math.round(context.summary.totalIncome).toLocaleString()}`);
  parts.push(`- Total expenses: ₪${Math.round(context.summary.totalExpenses).toLocaleString()}`);
  parts.push(`- Net: ₪${Math.round(context.summary.totalIncome - context.summary.totalExpenses).toLocaleString()}`);

  // Categories
  if (context.categories && context.categories.length > 0) {
    parts.push('\nTOP SPENDING CATEGORIES:');
    context.categories.forEach((c, i) => {
      parts.push(`${i + 1}. ${c.name}: ₪${Math.round(c.totalExpenses).toLocaleString()} (${c.count} transactions)`);
    });
  }

  // Budgets
  if (context.budgets && context.budgets.length > 0) {
    parts.push('\nBUDGET STATUS (This Month):');
    context.budgets.forEach(b => {
      const status = b.percentUsed > 100 ? '⚠️ OVER' : b.percentUsed > 80 ? '⚡ WARNING' : '✓';
      parts.push(`- ${b.category}: ₪${Math.round(b.spent).toLocaleString()} / ₪${Math.round(b.budget).toLocaleString()} (${b.percentUsed}%) ${status}`);
    });
  }

  // Analytics
  if (context.analytics) {
    parts.push('\nMONTHLY AVERAGES:');
    parts.push(`- Average income: ₪${context.analytics.avgMonthlyIncome.toLocaleString()}`);
    parts.push(`- Average expenses: ₪${context.analytics.avgMonthlyExpenses.toLocaleString()}`);
    parts.push(`- Average savings: ₪${context.analytics.avgMonthlySavings.toLocaleString()}`);
    parts.push(`- Savings rate: ${context.analytics.savingsRate}%`);
  }

  // Investments
  if (context.investments) {
    parts.push('\nINVESTMENTS:');
    parts.push(`- Total portfolio value: ₪${Math.round(context.investments.totalValue).toLocaleString()}`);
    parts.push(`- Liquid investments: ₪${Math.round(context.investments.liquidValue).toLocaleString()}`);
    parts.push(`- Number of accounts: ${context.investments.accountCount}`);
    if (hasValue(context.investments.holdingCount)) {
      parts.push(`- Active holdings: ${context.investments.holdingCount}`);
    }
    if (context.investments.latestAsOfDate) {
      parts.push(`- Latest holding date: ${context.investments.latestAsOfDate}`);
    }
  }

  // Recurring transactions
  if (context.recurringTransactions && context.recurringTransactions.length > 0) {
    parts.push('\nRECURRING TRANSACTIONS:');
    context.recurringTransactions.forEach(r => {
      parts.push(`- ${r.name}: ${r.count} times, avg ₪${Math.round(r.avgAmount).toLocaleString()} (${r.firstSeen} to ${r.lastSeen})`);
    });
  }

  // Year-over-year comparison
  if (context.yearOverYear) {
    parts.push('\nYEAR-OVER-YEAR COMPARISON:');
    if (context.yearOverYear.incomeChange !== null) {
      const direction = context.yearOverYear.incomeChange >= 0 ? '+' : '';
      parts.push(`- Income: ${direction}${context.yearOverYear.incomeChange}% vs same period last year (was ₪${context.yearOverYear.prevPeriodIncome.toLocaleString()})`);
    }
    if (context.yearOverYear.expenseChange !== null) {
      const direction = context.yearOverYear.expenseChange >= 0 ? '+' : '';
      parts.push(`- Expenses: ${direction}${context.yearOverYear.expenseChange}% vs same period last year (was ₪${context.yearOverYear.prevPeriodExpenses.toLocaleString()})`);
    }
  }

  parts.push(...formatOptimizerSections(context.optimizer));
  parts.push(...formatSmartActionsSection(context.smartActions));
  parts.push(...formatSubscriptionsSection(context.subscriptions));
  parts.push(...formatSpendingTargetsSection(context.spendingTargets));
  parts.push(...formatDataFreshnessSection(context.dataFreshness));

  // Permission notices
  const denied = [];
  if (!context.permissions.transactions) denied.push('transaction details');
  if (!context.permissions.categories) denied.push('category analysis');
  if (!context.permissions.analytics) denied.push('analytics and trends');

  if (denied.length > 0) {
    parts.push(`\nNOTE: User has not granted access to: ${denied.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Get database schema information for SQL queries
 * @returns {string} Schema description
 */
function getSchemaDescription() {
  return `
DATABASE SCHEMA (for SQL queries):

transactions:
  - identifier (TEXT) - unique transaction identifier
  - id (INTEGER PRIMARY KEY)
  - name (TEXT) - transaction description
  - merchant_name (TEXT) - merchant name (anonymized as Merchant_N)
  - price (REAL) - amount (negative for expenses, positive for income)
  - date (TEXT) - transaction date (YYYY-MM-DD)
  - processed_date (TEXT) - processed/settlement date (YYYY-MM-DD)
  - status (TEXT) - e.g. 'completed', 'pending', 'canceled'
  - category_definition_id (INTEGER) - FK to category_definitions
  - category_type (TEXT) - cached category type if available
  - vendor (TEXT) - bank/card provider
  - account_number (TEXT) - account identifier
  - is_pikadon_related (INTEGER) - 1 if related to deposit/withdrawal savings (exclude from spend)

category_definitions:
  - id (INTEGER PRIMARY KEY)
  - name (TEXT) - category name
  - parent_id (INTEGER) - self-referential FK to parent category_definitions.id (forms a tree)
  - category_type (TEXT) - 'expense', 'income', etc.
  - depth_level (INTEGER) - 0=virtual root, 1=top-level categories, 2+=subcategories
  - hierarchy_path (TEXT) - slash-separated path of ancestor IDs

  IMPORTANT: Categories form a TREE hierarchy. Transactions point to LEAF categories (depth_level >= 2).
  To get top-level category totals, join through the parent:
    SELECT parent.name, SUM(ABS(t.price)) as total
    FROM transactions t
    JOIN category_definitions cd ON t.category_definition_id = cd.id
    JOIN category_definitions parent ON cd.parent_id = parent.id
    WHERE parent.depth_level = 1
    GROUP BY parent.id ORDER BY total DESC
  To get subcategory totals within a parent:
    SELECT cd.name, SUM(ABS(t.price)) as total
    FROM transactions t
    JOIN category_definitions cd ON t.category_definition_id = cd.id
    WHERE cd.parent_id = <parent_category_id>
    GROUP BY cd.id ORDER BY total DESC

category_budgets:
  - id (INTEGER PRIMARY KEY)
  - category_definition_id (INTEGER) - FK to category_definitions
  - period_type (TEXT) - 'weekly', 'monthly', or 'yearly'
  - budget_limit (REAL) - budget amount
  - is_active (INTEGER) - 1 if active

investment_accounts:
  - id (INTEGER PRIMARY KEY)
  - account_name/name (TEXT) - account name
  - account_type (TEXT) - type of investment
  - is_liquid (INTEGER) - 1 if liquid
  - is_active (INTEGER) - 1 if active

investment_holdings:
  - id (INTEGER PRIMARY KEY)
  - account_id (INTEGER) - FK to investment_accounts
  - asset_name (TEXT)
  - asset_type (TEXT)
  - current_value (REAL) - current holding value
  - cost_basis (REAL)
  - as_of_date (TEXT)
  - status (TEXT)

user_profile:
  - id (INTEGER PRIMARY KEY)
  - username (TEXT) - user preferred name
  - marital_status (TEXT)
  - age (INTEGER)
  - occupation (TEXT)
  - monthly_income (REAL)
  - employment_status (TEXT)
  - family_status (TEXT)
  - location (TEXT)
  - industry (TEXT)

spouse_profile:
  - user_profile_id (INTEGER) - FK to user_profile
  - name (TEXT)
  - occupation (TEXT)
  - monthly_income (REAL)

children_profile:
  - user_profile_id (INTEGER) - FK to user_profile
  - name (TEXT)
  - birth_date (TEXT)
  - education_stage (TEXT)

transaction_pairing_exclusions:
  - transaction_identifier (TEXT)
  - transaction_vendor (TEXT)
  - pairing_id (INTEGER)
  - created_at (TEXT)
  - updated_at (TEXT)

spending_category_targets:
  - spending_category (TEXT) - essential, growth, stability, reward
  - target_percentage (REAL)
  - is_active (INTEGER)

Use these tables for SQL queries. Always use parameterized-style placeholders ($1, $2) even though we'll inject values directly.
Always use SQLite syntax (datetime(), strftime(), etc.).
`;
}

module.exports = {
  buildContext,
  formatContextForPrompt,
  getSchemaDescription,
  __setSpendingBreakdownLoader,
};
