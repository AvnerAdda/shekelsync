/**
 * Smart Suggestions Module
 * Generates ranked, data-driven suggested questions based on actual financial data.
 */

const { dialect } = require('../../../lib/sql-dialect.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');

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
const PAIRING_EXCLUSION_JOIN_T1 = `
  LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
    ON t1.identifier = tpe.transaction_identifier
    AND t1.vendor = tpe.transaction_vendor
`;
const EXCLUDE_PIKADON = dialect.excludePikadon('t');
const EXCLUDE_PIKADON_T1 = dialect.excludePikadon('t1');

const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 32;
const TARGET_SPENDING_CATEGORIES = new Set(['essential', 'growth', 'stability', 'reward']);

function normalizeNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCurrency(value) {
  return Math.round(Number(value) || 0).toLocaleString();
}

async function optionalQuery(db, sql, params = []) {
  try {
    const result = await db.query(sql, params);
    return result.rows || [];
  } catch {
    return [];
  }
}

async function getDataVersion(db) {
  // Per-table queries stay isolated (a missing table must not blank the whole
  // version) and include the mutable tables behind the top-ranked suggestions,
  // so dismissing a quest or editing a target invalidates the cache.
  const [transactionRows, scrapeRows, actionRows, subscriptionRows, targetRows, budgetRows, truthRows] = await Promise.all([
    optionalQuery(db, `
      SELECT COUNT(*) as transaction_count, MAX(date) as latest_transaction_date
      FROM transactions
    `),
    optionalQuery(db, `
      SELECT MAX(created_at) as latest_scrape_at
      FROM scrape_events
    `),
    optionalQuery(db, 'SELECT MAX(updated_at) as latest_change_at FROM smart_action_items'),
    optionalQuery(db, 'SELECT MAX(updated_at) as latest_change_at FROM subscriptions'),
    optionalQuery(db, 'SELECT MAX(updated_at) as latest_change_at FROM spending_category_targets'),
    optionalQuery(db, 'SELECT MAX(updated_at) as latest_change_at FROM category_budgets'),
    optionalQuery(db, 'SELECT revision FROM financial_truth_state WHERE id = 1'),
  ]);
  const tx = transactionRows[0] || {};
  const scrape = scrapeRows[0] || {};
  return [
    normalizeInt(tx.transaction_count) || 0,
    tx.latest_transaction_date || '',
    scrape.latest_scrape_at || '',
    actionRows[0]?.latest_change_at || '',
    subscriptionRows[0]?.latest_change_at || '',
    targetRows[0]?.latest_change_at || '',
    budgetRows[0]?.latest_change_at || '',
    normalizeInt(truthRows[0]?.revision) || 0,
  ].join(':');
}

function getCacheKey(permissions, locale, dataVersion) {
  return [
    locale,
    permissions.allowTransactionAccess ? 'tx' : 'no-tx',
    permissions.allowCategoryAccess ? 'cat' : 'no-cat',
    permissions.allowAnalyticsAccess ? 'ana' : 'no-ana',
    dataVersion,
  ].join('|');
}

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.suggestions;
  }
  cache.delete(key);
  return null;
}

function setCache(key, suggestions) {
  // Data-versioned keys are never looked up again once superseded, so prune
  // here — otherwise the map grows for the life of the process.
  const now = Date.now();
  for (const [existingKey, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(existingKey);
    }
  }
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, { suggestions, expiresAt: now + CACHE_TTL_MS });
}

function makeSuggestion({
  text,
  category,
  priority,
  source,
  estimatedImpactMonthly = null,
  requiresPermission = [],
}) {
  return {
    text,
    category,
    priority,
    source,
    estimatedImpactMonthly,
    requiresPermission,
  };
}

const CATEGORY_LABELS = {
  en: {
    essential: 'essential',
    growth: 'growth',
    stability: 'stability',
    reward: 'reward',
  },
  he: {
    essential: 'הכרחי',
    growth: 'צמיחה',
    stability: 'יציבות',
    reward: 'פינוק',
  },
  fr: {
    essential: 'essentiel',
    growth: 'croissance',
    stability: 'stabilite',
    reward: 'plaisir',
  },
};

const TEMPLATES = {
  en: {
    smartAction: (count, amount) => amount > 0
      ? `You have ${count} active money actions worth about ₪${formatCurrency(amount)}/mo — want the highest-impact one?`
      : `You have ${count} active money actions — want the best next step?`,
    subscriptionReview: (count, amount) => amount > 0
      ? `You have ${count} subscriptions marked for review worth about ₪${formatCurrency(amount)}/mo — should we prioritize them?`
      : `You have ${count} subscriptions marked for review — should we prioritize them?`,
    upcomingRenewals: (count) => `${count} subscriptions renew soon — want to review what is coming up?`,
    targetDrift: (category, drift) => `${category} spending is ${drift} pts above target this month — want a practical reset plan?`,
    staleData: (date) => `Your latest transaction is from ${date} — want to check whether your insights are stale?`,
    budgetOverrun: (category, pct) => `Your ${category} budget is ${pct}% used — want to explore alternatives?`,
    spendingSpike: (pct) => `Your spending jumped ${pct}% compared to last month — want to see why?`,
    spendingDrop: (pct) => `Your spending dropped ${Math.abs(pct)}% vs last month — want to see what changed?`,
    newMerchants: (count) => `You started shopping at ${count} new places this month — want a breakdown?`,
    savingsOpportunity: (amount) => `You have ₪${amount} unallocated this month — want investment ideas?`,
  },
  he: {
    smartAction: (count, amount) => amount > 0
      ? `יש לך ${count} פעולות כסף פעילות בשווי כ-₪${formatCurrency(amount)} לחודש — רוצה להתחיל מההשפעה הגבוהה ביותר?`
      : `יש לך ${count} פעולות כסף פעילות — רוצה את הצעד הבא הכי טוב?`,
    subscriptionReview: (count, amount) => amount > 0
      ? `יש לך ${count} מנויים לסקירה בשווי כ-₪${formatCurrency(amount)} לחודש — לתעדף אותם?`
      : `יש לך ${count} מנויים לסקירה — לתעדף אותם?`,
    upcomingRenewals: (count) => `${count} מנויים מתחדשים בקרוב — רוצה לבדוק מה מגיע?`,
    targetDrift: (category, drift) => `הוצאות ${category} גבוהות ב-${drift} נקודות מהיעד החודש — רוצה תוכנית איפוס מעשית?`,
    staleData: (date) => `העסקה האחרונה שלך היא מ-${date} — לבדוק אם התובנות התיישנו?`,
    budgetOverrun: (category, pct) => `התקציב של ${category} ב-${pct}% ניצול — רוצה לבדוק חלופות?`,
    spendingSpike: (pct) => `ההוצאות שלך קפצו ב-${pct}% לעומת החודש שעבר — רוצה לראות למה?`,
    spendingDrop: (pct) => `ההוצאות שלך ירדו ב-${Math.abs(pct)}% לעומת החודש שעבר — רוצה לראות מה השתנה?`,
    newMerchants: (count) => `התחלת לקנות ב-${count} מקומות חדשים החודש — רוצה פירוט?`,
    savingsOpportunity: (amount) => `יש לך ₪${amount} לא מנוצלים החודש — רוצה רעיונות להשקעה?`,
  },
  fr: {
    smartAction: (count, amount) => amount > 0
      ? `Vous avez ${count} actions financières actives d'environ ₪${formatCurrency(amount)}/mois — voir la plus utile ?`
      : `Vous avez ${count} actions financières actives — voir la meilleure prochaine étape ?`,
    subscriptionReview: (count, amount) => amount > 0
      ? `Vous avez ${count} abonnements à revoir pour environ ₪${formatCurrency(amount)}/mois — les prioriser ?`
      : `Vous avez ${count} abonnements à revoir — les prioriser ?`,
    upcomingRenewals: (count) => `${count} abonnements se renouvellent bientôt — voulez-vous les passer en revue ?`,
    targetDrift: (category, drift) => `Les dépenses ${category} sont ${drift} pts au-dessus de l'objectif ce mois-ci — faire un plan ?`,
    staleData: (date) => `Votre dernière transaction date du ${date} — vérifier si les insights sont à jour ?`,
    budgetOverrun: (category, pct) => `Votre budget ${category} est utilisé à ${pct}% — voulez-vous explorer des alternatives ?`,
    spendingSpike: (pct) => `Vos dépenses ont augmenté de ${pct}% par rapport au mois dernier — voulez-vous savoir pourquoi ?`,
    spendingDrop: (pct) => `Vos dépenses ont baissé de ${Math.abs(pct)}% — voulez-vous voir ce qui a changé ?`,
    newMerchants: (count) => `Vous avez commencé à acheter dans ${count} nouveaux endroits — voulez-vous un détail ?`,
    savingsOpportunity: (amount) => `Vous avez ₪${amount} non alloués ce mois-ci — des idées d'investissement ?`,
  },
};

/**
 * Generate smart suggestions based on actual financial data.
 * @param {Object} db - Database client
 * @param {Object} permissions - User permissions
 * @param {string} locale - User locale
 * @returns {Promise<Array<{text: string, category: string, priority: number, source: string, estimatedImpactMonthly: number|null, requiresPermission: string[]}>>}
 */
async function generateSuggestions(db, permissions, locale = 'en') {
  const normalizedLocale = ['en', 'he', 'fr'].includes(locale) ? locale : 'en';
  const hasAnyPermission = permissions.allowTransactionAccess
    || permissions.allowCategoryAccess
    || permissions.allowAnalyticsAccess;

  if (!hasAnyPermission) {
    return [];
  }

  const dataVersion = await getDataVersion(db);
  const cacheKey = getCacheKey(permissions, normalizedLocale, dataVersion);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const templates = TEMPLATES[normalizedLocale] || TEMPLATES.en;
  const suggestions = [];
  const queries = [];

  if (permissions.allowAnalyticsAccess) {
    queries.push(checkSmartActions(db, templates));
  }
  if (permissions.allowAnalyticsAccess || permissions.allowTransactionAccess) {
    queries.push(checkSubscriptionReview(db, templates));
    queries.push(checkUpcomingRenewals(db, templates));
    queries.push(checkDataFreshness(db, templates));
    queries.push(checkSpendingChange(db, templates));
  }
  if (permissions.allowAnalyticsAccess || permissions.allowCategoryAccess) {
    queries.push(checkSpendingTargetDrift(db, templates, normalizedLocale));
  }
  if (permissions.allowCategoryAccess) {
    queries.push(checkBudgetOverruns(db, templates));
  }
  if (permissions.allowTransactionAccess) {
    queries.push(checkNewMerchants(db, templates));
  }
  if (permissions.allowAnalyticsAccess) {
    queries.push(checkSavingsOpportunity(db, templates));
  }

  const results = await Promise.allSettled(queries);
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      suggestions.push(result.value);
    }
  }

  const final = suggestions
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .slice(0, 4);
  setCache(cacheKey, final);
  return final;
}

async function checkSmartActions(db, templates) {
  // 'accepted' quests are in progress and still actionable (quests.js treats
  // active+accepted as live). Only positive impacts count toward the savings
  // claim — negative values are cost warnings and must not net against it.
  const rows = await optionalQuery(db, `
    SELECT
      COUNT(*) as action_count,
      SUM(CASE WHEN potential_impact > 0 THEN potential_impact ELSE 0 END) as potential_impact
    FROM smart_action_items
    WHERE user_status IN ('active', 'accepted')
      AND dismissed_at IS NULL
      AND resolved_at IS NULL
  `);

  const count = normalizeInt(rows[0]?.action_count) || 0;
  if (count <= 0) return null;
  const amount = normalizeNumber(rows[0]?.potential_impact) || 0;
  return makeSuggestion({
    text: templates.smartAction(count, amount),
    category: 'smart_action',
    priority: 100,
    source: 'smart_action_items',
    estimatedImpactMonthly: amount > 0 ? Math.round(amount) : null,
    requiresPermission: ['analytics'],
  });
}

async function checkSubscriptionReview(db, templates) {
  const rows = await optionalQuery(db, `
    SELECT
      COUNT(*) as review_count,
      SUM(${subscriptionMonthlySql('s')}) as monthly_total
    FROM subscriptions s
    WHERE status = 'review'
  `);

  const count = normalizeInt(rows[0]?.review_count) || 0;
  if (count <= 0) return null;
  const amount = normalizeNumber(rows[0]?.monthly_total) || 0;
  return makeSuggestion({
    text: templates.subscriptionReview(count, amount),
    category: 'subscription',
    priority: 92,
    source: 'subscriptions_review',
    estimatedImpactMonthly: amount > 0 ? Math.round(amount) : null,
    requiresPermission: ['analytics', 'transactions'],
  });
}

async function checkUpcomingRenewals(db, templates) {
  const rows = await optionalQuery(db, `
    SELECT COUNT(*) as renewal_count
    FROM subscriptions
    WHERE status = 'active'
      AND next_expected_date IS NOT NULL
      AND next_expected_date >= date('now', 'localtime')
      AND next_expected_date <= date('now', 'localtime', '+30 day')
  `);

  const count = normalizeInt(rows[0]?.renewal_count) || 0;
  if (count <= 0) return null;
  return makeSuggestion({
    text: templates.upcomingRenewals(count),
    category: 'subscription',
    priority: 84,
    source: 'subscriptions_upcoming',
    requiresPermission: ['analytics', 'transactions'],
  });
}

async function checkSpendingTargetDrift(db, templates, locale) {
  // Reuse the Spending Categories screen's own calculation so the coach can
  // never quote a drift number that contradicts the dashboard.
  let breakdown;
  try {
    ({ breakdown } = await loadSpendingCategoryBreakdown({ currentMonthOnly: true }) || {});
  } catch {
    return null;
  }

  const ranked = (Array.isArray(breakdown) ? breakdown : [])
    .filter((row) => TARGET_SPENDING_CATEGORIES.has(row.spending_category)
      && (normalizeNumber(row.target_percentage) || 0) > 0)
    .map((row) => ({
      category: row.spending_category,
      drift: Math.round(normalizeNumber(row.variance) || 0),
    }))
    .filter((row) => row.drift >= 8)
    .sort((a, b) => b.drift - a.drift);

  const top = ranked[0];
  if (!top) return null;
  const labels = CATEGORY_LABELS[locale] || CATEGORY_LABELS.en;
  return makeSuggestion({
    text: templates.targetDrift(labels[top.category] || top.category, top.drift),
    category: 'spending_target',
    priority: 88,
    source: 'spending_category_targets',
    requiresPermission: ['analytics', 'category'],
  });
}

async function checkDataFreshness(db, templates) {
  const rows = await optionalQuery(db, `
    SELECT
      MAX(date) as latest_transaction_date,
      CAST(julianday('now', 'localtime') - julianday(MAX(date)) AS INTEGER) as days_since_latest
    FROM transactions
    WHERE status = 'completed'
  `);

  const days = normalizeInt(rows[0]?.days_since_latest);
  const latest = rows[0]?.latest_transaction_date ? String(rows[0].latest_transaction_date).slice(0, 10) : null;
  if (latest && days !== null && days >= 7) {
    return makeSuggestion({
      text: templates.staleData(latest),
      category: 'freshness',
      priority: 75,
      source: 'transactions_freshness',
      requiresPermission: ['analytics', 'transactions'],
    });
  }
  return null;
}

async function checkBudgetOverruns(db, templates) {
  const result = await optionalQuery(db, `
    SELECT
      cd.name as category,
      cb.budget_limit as budget,
      SUM(CASE WHEN t.price < 0 AND tpe.transaction_identifier IS NULL AND ${EXCLUDE_PIKADON}
        THEN ABS(t.price) ELSE 0 END) as spent
    FROM category_budgets cb
    JOIN category_definitions cd ON cb.category_definition_id = cd.id
    LEFT JOIN transactions t ON t.category_definition_id = cd.id
      AND t.date >= date('now', 'localtime', 'start of month')
      AND t.price < 0
    LEFT JOIN transaction_pairing_exclusions tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE cb.is_active = 1 AND cb.period_type = 'monthly' AND cb.budget_limit > 0
    GROUP BY cd.id, cd.name, cb.budget_limit
    HAVING spent > budget * 0.9
    ORDER BY (spent / budget) DESC
    LIMIT 1
  `);

  if (result.length > 0) {
    const row = result[0];
    const pct = Math.round((parseFloat(row.spent) / parseFloat(row.budget)) * 100);
    return makeSuggestion({
      text: templates.budgetOverrun(row.category, pct),
      category: 'budget',
      priority: 82,
      source: 'category_budgets',
      requiresPermission: ['category'],
    });
  }
  return null;
}

async function checkSpendingChange(db, templates) {
  const result = await optionalQuery(db, `
    SELECT
      SUM(CASE WHEN t.date >= date('now', 'localtime', 'start of month') THEN ABS(t.price) ELSE 0 END) as this_month,
      SUM(CASE WHEN t.date >= date('now', 'localtime', '-1 month', 'start of month')
                AND t.date < date('now', 'localtime', 'start of month') THEN ABS(t.price) ELSE 0 END) as last_month
    FROM transactions t
    ${PAIRING_EXCLUSION_JOIN}
    WHERE t.price < 0
      AND t.date >= date('now', 'localtime', '-1 month', 'start of month')
      AND tpe.transaction_identifier IS NULL
      AND ${EXCLUDE_PIKADON}
  `);

  if (result.length > 0) {
    const thisMonth = parseFloat(result[0].this_month || 0);
    const lastMonth = parseFloat(result[0].last_month || 0);

    if (lastMonth > 0) {
      const changePct = Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
      if (changePct > 20) {
        return makeSuggestion({
          text: templates.spendingSpike(changePct),
          category: 'spike',
          priority: 72,
          source: 'monthly_spending_change',
          requiresPermission: ['analytics', 'transactions'],
        });
      }
      if (changePct < -20) {
        return makeSuggestion({
          text: templates.spendingDrop(changePct),
          category: 'spike',
          priority: 64,
          source: 'monthly_spending_change',
          requiresPermission: ['analytics', 'transactions'],
        });
      }
    }
  }
  return null;
}

async function checkNewMerchants(db, templates) {
  const result = await optionalQuery(db, `
    SELECT COUNT(DISTINCT t1.merchant_name) as new_count
    FROM transactions t1
    ${PAIRING_EXCLUSION_JOIN_T1}
    WHERE t1.date >= date('now', 'localtime', 'start of month')
      AND t1.price < 0
      AND t1.merchant_name IS NOT NULL
      AND tpe.transaction_identifier IS NULL
      AND ${EXCLUDE_PIKADON_T1}
      AND t1.merchant_name NOT IN (
        SELECT DISTINCT t2.merchant_name
        FROM transactions t2
        WHERE t2.date >= date('now', 'localtime', '-3 months')
          AND t2.date < date('now', 'localtime', 'start of month')
          AND t2.merchant_name IS NOT NULL
      )
  `);

  if (result.length > 0) {
    const count = Number.parseInt(result[0].new_count || 0, 10);
    if (count >= 2) {
      return makeSuggestion({
        text: templates.newMerchants(count),
        category: 'merchant',
        priority: 58,
        source: 'new_merchant_count',
        requiresPermission: ['transactions'],
      });
    }
  }
  return null;
}

async function checkSavingsOpportunity(db, templates) {
  const CATEGORY_TYPE_EXPR = 'COALESCE(cd.category_type, t.category_type)';
  const result = await optionalQuery(db, `
    SELECT
      SUM(CASE WHEN (
        (${CATEGORY_TYPE_EXPR} = 'income' AND t.price > 0 AND COALESCE(cd.is_counted_as_income, 1) = 1)
        OR (${CATEGORY_TYPE_EXPR} IS NULL AND t.price > 0)
        OR (COALESCE(cd.name, '') = $1 AND t.price > 0)
      ) THEN t.price ELSE 0 END) as income,
      SUM(CASE WHEN (
        (${CATEGORY_TYPE_EXPR} = 'expense' OR (${CATEGORY_TYPE_EXPR} IS NULL AND t.price < 0))
        AND t.price < 0
      ) THEN ABS(t.price) ELSE 0 END) as expenses
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    ${PAIRING_EXCLUSION_JOIN}
    WHERE t.date >= date('now', 'localtime', 'start of month')
      AND tpe.transaction_identifier IS NULL
      AND ${EXCLUDE_PIKADON}
  `, [BANK_CATEGORY_NAME]);

  if (result.length > 0) {
    const income = parseFloat(result[0].income || 0);
    const expenses = parseFloat(result[0].expenses || 0);
    const unallocated = income - expenses;

    if (income > 0 && unallocated > income * 0.1) {
      const formatted = Math.round(unallocated).toLocaleString();
      return makeSuggestion({
        text: templates.savingsOpportunity(formatted),
        category: 'savings',
        priority: 54,
        source: 'monthly_cashflow',
        estimatedImpactMonthly: Math.round(unallocated),
        requiresPermission: ['analytics'],
      });
    }
  }
  return null;
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

function __clearCache() {
  cache.clear();
}

module.exports = {
  generateSuggestions,
  __clearCache,
  __setSpendingBreakdownLoader,
};
