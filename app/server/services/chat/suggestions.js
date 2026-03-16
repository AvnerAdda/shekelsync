/**
 * Smart Suggestions Module
 * Generates dynamic, data-driven suggested questions based on actual financial data
 */

const { dialect } = require('../../../lib/sql-dialect.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');

const PAIRING_EXCLUSION_JOIN = `
  LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
    ON t.identifier = tpe.transaction_identifier
    AND t.vendor = tpe.transaction_vendor
`;
const EXCLUDE_PIKADON = dialect.excludePikadon('t');

// Simple in-memory cache with TTL
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCacheKey(permissions) {
  return `${permissions.allowTransactionAccess}-${permissions.allowCategoryAccess}-${permissions.allowAnalyticsAccess}`;
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
  cache.set(key, { suggestions, expiresAt: Date.now() + CACHE_TTL_MS });
}

const TEMPLATES = {
  en: {
    budgetOverrun: (category, pct) => `Your ${category} budget is ${pct}% used — want to explore alternatives?`,
    spendingSpike: (pct) => `Your spending jumped ${pct}% compared to last month — want to see why?`,
    spendingDrop: (pct) => `Your spending dropped ${Math.abs(pct)}% vs last month — nice! Want to see what changed?`,
    newMerchants: (count) => `You started shopping at ${count} new places this month — want a breakdown?`,
    savingsOpportunity: (amount) => `You have ₪${amount} unallocated this month — want investment ideas?`,
  },
  he: {
    budgetOverrun: (category, pct) => `התקציב של ${category} ב-${pct}% ניצול — רוצה לבדוק חלופות?`,
    spendingSpike: (pct) => `ההוצאות שלך קפצו ב-${pct}% לעומת החודש שעבר — רוצה לראות למה?`,
    spendingDrop: (pct) => `ההוצאות שלך ירדו ב-${Math.abs(pct)}% לעומת החודש שעבר — יפה! רוצה לראות מה השתנה?`,
    newMerchants: (count) => `התחלת לקנות ב-${count} מקומות חדשים החודש — רוצה פירוט?`,
    savingsOpportunity: (amount) => `יש לך ₪${amount} לא מנוצלים החודש — רוצה רעיונות להשקעה?`,
  },
  fr: {
    budgetOverrun: (category, pct) => `Votre budget ${category} est utilisé à ${pct}% — voulez-vous explorer des alternatives ?`,
    spendingSpike: (pct) => `Vos dépenses ont augmenté de ${pct}% par rapport au mois dernier — voulez-vous savoir pourquoi ?`,
    spendingDrop: (pct) => `Vos dépenses ont baissé de ${Math.abs(pct)}% — bien ! Voulez-vous voir ce qui a changé ?`,
    newMerchants: (count) => `Vous avez commencé à acheter dans ${count} nouveaux endroits — voulez-vous un détail ?`,
    savingsOpportunity: (amount) => `Vous avez ₪${amount} non alloués ce mois-ci — des idées d'investissement ?`,
  },
};

/**
 * Generate smart suggestions based on actual financial data
 * @param {Object} db - Database client
 * @param {Object} permissions - User permissions
 * @param {string} locale - User locale
 * @returns {Promise<Array<{text: string, category: string}>>}
 */
async function generateSuggestions(db, permissions, locale = 'en') {
  const cacheKey = getCacheKey(permissions);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const templates = TEMPLATES[locale] || TEMPLATES.en;
  const suggestions = [];

  const hasAnyPermission = permissions.allowTransactionAccess
    || permissions.allowCategoryAccess
    || permissions.allowAnalyticsAccess;

  if (!hasAnyPermission) {
    return [];
  }

  // Run queries in parallel where possible
  const queries = [];

  // 1. Budget overruns (requires category access)
  if (permissions.allowCategoryAccess) {
    queries.push(checkBudgetOverruns(db, templates));
  }

  // 2. Spending spike/drop vs last month (requires analytics or transaction access)
  if (permissions.allowAnalyticsAccess || permissions.allowTransactionAccess) {
    queries.push(checkSpendingChange(db, templates));
  }

  // 3. New merchants (requires transaction access)
  if (permissions.allowTransactionAccess) {
    queries.push(checkNewMerchants(db, templates));
  }

  // 4. Savings opportunity (requires analytics access)
  if (permissions.allowAnalyticsAccess) {
    queries.push(checkSavingsOpportunity(db, templates));
  }

  const results = await Promise.allSettled(queries);
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      suggestions.push(result.value);
    }
  }

  // Limit to 4 suggestions
  const final = suggestions.slice(0, 4);
  setCache(cacheKey, final);
  return final;
}

async function checkBudgetOverruns(db, templates) {
  try {
    const result = await db.query(`
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
      HAVING spent > budget * 0.9
      ORDER BY (spent / budget) DESC
      LIMIT 1
    `);

    if (result.rows.length > 0) {
      const row = result.rows[0];
      const pct = Math.round((parseFloat(row.spent) / parseFloat(row.budget)) * 100);
      return {
        text: templates.budgetOverrun(row.category, pct),
        category: 'budget',
      };
    }
  } catch {
    // Budget tables might not exist
  }
  return null;
}

async function checkSpendingChange(db, templates) {
  try {
    const result = await db.query(`
      SELECT
        SUM(CASE WHEN t.date >= date('now', 'start of month') THEN ABS(t.price) ELSE 0 END) as this_month,
        SUM(CASE WHEN t.date >= date('now', '-1 month', 'start of month')
                  AND t.date < date('now', 'start of month') THEN ABS(t.price) ELSE 0 END) as last_month
      FROM transactions t
      ${PAIRING_EXCLUSION_JOIN}
      WHERE t.price < 0
        AND t.date >= date('now', '-1 month', 'start of month')
        AND tpe.transaction_identifier IS NULL
        AND ${EXCLUDE_PIKADON}
    `);

    if (result.rows.length > 0) {
      const thisMonth = parseFloat(result.rows[0].this_month || 0);
      const lastMonth = parseFloat(result.rows[0].last_month || 0);

      if (lastMonth > 0) {
        const changePct = Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
        if (changePct > 20) {
          return { text: templates.spendingSpike(changePct), category: 'spike' };
        }
        if (changePct < -20) {
          return { text: templates.spendingDrop(changePct), category: 'spike' };
        }
      }
    }
  } catch {
    // Query might fail
  }
  return null;
}

async function checkNewMerchants(db, templates) {
  try {
    const result = await db.query(`
      SELECT COUNT(DISTINCT t1.merchant_name) as new_count
      FROM transactions t1
      ${PAIRING_EXCLUSION_JOIN}
      WHERE t1.date >= date('now', 'start of month')
        AND t1.price < 0
        AND t1.merchant_name IS NOT NULL
        AND tpe.transaction_identifier IS NULL
        AND ${EXCLUDE_PIKADON}
        AND t1.merchant_name NOT IN (
          SELECT DISTINCT t2.merchant_name
          FROM transactions t2
          WHERE t2.date >= date('now', '-3 months')
            AND t2.date < date('now', 'start of month')
            AND t2.merchant_name IS NOT NULL
        )
    `);

    if (result.rows.length > 0) {
      const count = Number.parseInt(result.rows[0].new_count || 0, 10);
      if (count >= 2) {
        return { text: templates.newMerchants(count), category: 'merchant' };
      }
    }
  } catch {
    // Query might fail
  }
  return null;
}

async function checkSavingsOpportunity(db, templates) {
  try {
    const CATEGORY_TYPE_EXPR = 'COALESCE(cd.category_type, t.category_type)';
    const result = await db.query(`
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
      WHERE t.date >= date('now', 'start of month')
        AND tpe.transaction_identifier IS NULL
        AND ${EXCLUDE_PIKADON}
    `, [BANK_CATEGORY_NAME]);

    if (result.rows.length > 0) {
      const income = parseFloat(result.rows[0].income || 0);
      const expenses = parseFloat(result.rows[0].expenses || 0);
      const unallocated = income - expenses;

      if (income > 0 && unallocated > income * 0.1) {
        const formatted = Math.round(unallocated).toLocaleString();
        return { text: templates.savingsOpportunity(formatted), category: 'savings' };
      }
    }
  } catch {
    // Query might fail
  }
  return null;
}

// For testing
function __clearCache() {
  cache.clear();
}

module.exports = {
  generateSuggestions,
  __clearCache,
};
