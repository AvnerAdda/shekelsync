const database = require('./database.js');

let dateFnsPromise = null;

async function loadDateFns() {
  if (!dateFnsPromise) {
    dateFnsPromise = import('date-fns');
  }
  return dateFnsPromise;
}

const PERIOD_TYPES = new Set(['weekly', 'monthly', 'yearly']);

const BASE_SELECT = `
  SELECT
    cb.id,
    cb.category_definition_id,
    cb.period_type,
    cb.budget_limit,
    cb.is_active,
    cb.created_at,
    cb.updated_at,
    cd.name AS category_name,
    cd.name_en AS category_name_en,
    cd.category_type,
    parent.name AS parent_category_name,
    parent.name_en AS parent_category_name_en
  FROM category_budgets cb
  JOIN category_definitions cd ON cd.id = cb.category_definition_id
  LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
`;

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function listBudgets() {
  const result = await getDatabase().query(
    `${BASE_SELECT}
     WHERE cb.is_active = true
     ORDER BY cd.category_type, parent.name, cd.name, cb.period_type`
  );
  return result.rows;
}

async function getCategoryForBudget(categoryId) {
  const result = await getDatabase().query(
    'SELECT id, category_type FROM category_definitions WHERE id = $1',
    [categoryId]
  );

  if (result.rows.length === 0) {
    throw serviceError(404, 'Category not found');
  }

  return result.rows[0];
}

async function fetchBudgetById(id) {
  const result = await getDatabase().query(
    `${BASE_SELECT}
     WHERE cb.id = $1`,
    [id]
  );

  return result.rows[0] || null;
}

async function upsertBudget(payload = {}) {
  const {
    category_definition_id,
    period_type,
    budget_limit,
  } = payload;

  if (!category_definition_id || !period_type || budget_limit === undefined) {
    throw serviceError(400, 'Missing required fields');
  }

  if (!PERIOD_TYPES.has(period_type)) {
    throw serviceError(400, 'Invalid period_type');
  }

  const categoryId = Number.parseInt(category_definition_id, 10);
  if (Number.isNaN(categoryId)) {
    throw serviceError(400, 'Invalid category selected');
  }

  const category = await getCategoryForBudget(categoryId);
  if (category.category_type !== 'expense') {
    throw serviceError(400, 'Budgets can only be created for expense categories');
  }

  const limit = Number.parseFloat(budget_limit);
  if (Number.isNaN(limit) || limit <= 0) {
    throw serviceError(400, 'Budget limit must be greater than zero');
  }

  const result = await getDatabase().query(
    `INSERT INTO category_budgets (category_definition_id, period_type, budget_limit)
     VALUES ($1, $2, $3)
     ON CONFLICT (category_definition_id, period_type)
     DO UPDATE SET budget_limit = $3, updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [categoryId, period_type, limit]
  );

  const inserted = await fetchBudgetById(result.rows[0].id);
  return inserted;
}

async function updateBudget(payload = {}) {
  const { id, budget_limit, is_active } = payload;

  if (!id) {
    throw serviceError(400, 'Missing budget ID');
  }

  const updates = [];
  const params = [];
  let paramIndex = 1;

  if (budget_limit !== undefined) {
    const limitValue = Number.parseFloat(budget_limit);
    if (Number.isNaN(limitValue) || limitValue <= 0) {
      throw serviceError(400, 'Budget limit must be greater than zero');
    }
    updates.push(`budget_limit = $${paramIndex++}`);
    params.push(limitValue);
  }

  if (is_active !== undefined) {
    updates.push(`is_active = $${paramIndex++}`);
    params.push(is_active);
  }

  if (updates.length === 0) {
    throw serviceError(400, 'No fields to update');
  }

  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  params.push(id);

  const updateResult = await getDatabase().query(
    `UPDATE category_budgets
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING id`,
    params
  );

  if (updateResult.rows.length === 0) {
    throw serviceError(404, 'Budget not found');
  }

  const updated = await fetchBudgetById(updateResult.rows[0].id);
  return updated;
}

async function deactivateBudget(query = {}) {
  const { id } = query;

  if (!id) {
    throw serviceError(400, 'Missing budget ID');
  }

  const result = await getDatabase().query(
    'UPDATE category_budgets SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [id]
  );

  if (result.rowCount === 0) {
    throw serviceError(404, 'Budget not found');
  }

  return { success: true };
}

function getPeriodRange(periodType, dateFns) {
  const now = new Date();
  const { startOfWeek, startOfMonth, startOfYear, endOfWeek, endOfMonth, endOfYear } = dateFns;

  switch (periodType) {
    case 'weekly':
      return {
        start: startOfWeek(now, { weekStartsOn: 0 }),
        end: endOfWeek(now, { weekStartsOn: 0 }),
      };
    case 'monthly':
      return {
        start: startOfMonth(now),
        end: endOfMonth(now),
      };
    case 'yearly':
      return {
        start: startOfYear(now),
        end: endOfYear(now),
      };
    default:
      throw new Error('Invalid period type');
  }
}

async function computeBudgetSpent(client, { categoryDefinitionId, categoryName }, start, end) {
  if (categoryDefinitionId) {
    const spendingResult = await client.query(
      `WITH RECURSIVE category_tree(id) AS (
          SELECT id FROM category_definitions WHERE id = $1
          UNION ALL
          SELECT cd.id
          FROM category_definitions cd
          JOIN category_tree ct ON cd.parent_id = ct.id
        )
       SELECT COALESCE(SUM(ABS(price)), 0) AS spent
       FROM transactions t
       LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
         ON t.identifier = tpe.transaction_identifier
         AND t.vendor = tpe.transaction_vendor
       WHERE t.category_definition_id IN (SELECT id FROM category_tree)
         AND t.price < 0
         AND t.date >= $2
         AND t.date <= $3
         AND tpe.transaction_identifier IS NULL`,
      [categoryDefinitionId, start, end],
    );

    return Number.parseFloat(spendingResult.rows[0]?.spent || 0);
  }

  if (!categoryName) {
    return 0;
  }

  const fallbackResult = await client.query(
    `WITH RECURSIVE category_tree AS (
        SELECT id
        FROM category_definitions
        WHERE name = $1
      UNION ALL
        SELECT cd.id
        FROM category_definitions cd
        JOIN category_tree ct ON cd.parent_id = ct.id
      )
     SELECT COALESCE(SUM(ABS(price)), 0) AS spent
     FROM transactions t
     LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
       ON t.identifier = tpe.transaction_identifier
       AND t.vendor = tpe.transaction_vendor
     WHERE t.category_definition_id IN (SELECT id FROM category_tree)
       AND t.price < 0
       AND t.date >= $2
       AND t.date <= $3
       AND tpe.transaction_identifier IS NULL`,
    [categoryName, start, end],
  );

  return Number.parseFloat(fallbackResult.rows[0]?.spent || 0);
}

async function listBudgetUsage() {
  const dateFns = await loadDateFns();
  const client = await getDatabase().getClient();

  try {
    const budgetsResult = await client.query(
      `SELECT
         cb.id,
         cb.category_definition_id,
         cb.period_type,
         cb.budget_limit,
         cb.is_active,
         cd.name AS category_name,
         cd.name_en AS category_name_en,
         parent.name AS parent_category_name,
         parent.name_en AS parent_category_name_en
       FROM category_budgets cb
       JOIN category_definitions cd ON cd.id = cb.category_definition_id
       LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
       WHERE cb.is_active = true`,
    );

    const budgets = budgetsResult.rows;
    const usageData = [];

    for (const budget of budgets) {
      const periodType = budget.period_type;
      const { start, end } = getPeriodRange(periodType, dateFns);
      const limit = Number.parseFloat(budget.budget_limit || 0);
      if (!Number.isFinite(limit) || limit <= 0) {
        continue;
      }

      let categoryDefinitionId = budget.category_definition_id || null;
      let categoryName = budget.category_name || null;
      let categoryNameEn = budget.category_name_en || null;
      let parentCategoryName = budget.parent_category_name || null;
      let parentCategoryNameEn = budget.parent_category_name_en || null;

      const spent = await computeBudgetSpent(
        client,
        { categoryDefinitionId, categoryName },
        start,
        end,
      );

      const percentage = limit > 0 ? (spent / limit) * 100 : 0;
      usageData.push({
        ...budget,
        category_definition_id: categoryDefinitionId,
        category_name: categoryName,
        category_name_en: categoryNameEn,
        parent_category_name: parentCategoryName,
        parent_category_name_en: parentCategoryNameEn,
        spent,
        budget_limit: limit,
        remaining: limit - spent,
        percentage: Math.min(percentage, 100),
        status: percentage >= 100 ? 'exceeded' : percentage >= 80 ? 'warning' : 'good',
      });
    }

    return usageData;
  } finally {
    client.release();
  }
}

// Test helpers for dependency injection
let testDatabase = null;

function __setDatabase(db) {
  testDatabase = db;
}

function __resetDatabase() {
  testDatabase = null;
}

function getDatabase() {
  return testDatabase || database;
}

module.exports = {
  listBudgets,
  upsertBudget,
  updateBudget,
  deactivateBudget,
  listBudgetUsage,
  __setDatabase,
  __resetDatabase,
};
module.exports.default = module.exports;
