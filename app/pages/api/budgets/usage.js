import { getDB } from '../db.js';
// Duplicate filter removed from '../analytics/utils.js';
import { startOfWeek, startOfMonth, startOfYear, endOfWeek, endOfMonth, endOfYear } from 'date-fns';

function isMissingCategoryIdColumnError(error) {
  if (!error || !error.message) return false;
  return error.message.includes('category_definition_id');
}

function getPeriodRange(periodType) {
  const now = new Date();

  switch (periodType) {
    case 'weekly':
      return {
        start: startOfWeek(now, { weekStartsOn: 0 }),
        end: endOfWeek(now, { weekStartsOn: 0 })
      };
    case 'monthly':
      return {
        start: startOfMonth(now),
        end: endOfMonth(now)
      };
    case 'yearly':
      return {
        start: startOfYear(now),
        end: endOfYear(now)
      };
    default:
      throw new Error('Invalid period type');
  }
}

async function computeSpent(client, { categoryDefinitionId, categoryName }, start, end) {
  if (categoryDefinitionId) {
    const spendingResult = await client.query(
      `WITH RECURSIVE category_tree(id) AS (
          SELECT id FROM category_definitions WHERE id = $1
          UNION ALL
          SELECT cd.id
          FROM category_definitions cd
          JOIN category_tree ct ON cd.parent_id = ct.id
        )
       SELECT COALESCE(SUM(ABS(price)), 0) as spent
       FROM transactions t
       WHERE t.category_definition_id IN (SELECT id FROM category_tree)
         AND t.price < 0
         AND t.date >= $2
         AND t.date <= $3
         `,
      [categoryDefinitionId, start, end]
    );

    return parseFloat(spendingResult.rows[0].spent) || 0;
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
     WHERE t.category_definition_id IN (SELECT id FROM category_tree)
       AND t.price < 0
       AND t.date >= $2
       AND t.date <= $3
       `,
    [categoryName, start, end]
  );

  return parseFloat(fallbackResult.rows[0].spent) || 0;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    // Get all active budgets
    let budgetsResult;
    let legacyBudgetSchema = false;
    let categoryLookupByName = null;
    let categoryLookupById = null;

    try {
      budgetsResult = await client.query(
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
         WHERE cb.is_active = true`
      );
    } catch (error) {
      if (!isMissingCategoryIdColumnError(error)) {
        throw error;
      }

      legacyBudgetSchema = true;
      budgetsResult = await client.query(
        `SELECT
           cb.id,
           cb.category,
           cb.period_type,
           cb.budget_limit,
           cb.is_active
         FROM category_budgets cb
         WHERE cb.is_active = true`
      );

      const categoryRows = await client.query(
        `SELECT id, name, name_en, parent_id FROM category_definitions`
      );
      categoryLookupByName = new Map();
      categoryLookupById = new Map();
      categoryRows.rows.forEach((row) => {
        categoryLookupByName.set(row.name, row);
        categoryLookupById.set(row.id, row);
      });
    }

    const budgets = budgetsResult.rows;
    const usageData = [];

    for (const budget of budgets) {
      const { start, end } = getPeriodRange(budget.period_type);
      const limit = parseFloat(budget.budget_limit || 0);
      if (Number.isNaN(limit) || limit <= 0) {
        continue;
      }

      let categoryDefinitionId = budget.category_definition_id || null;
      let categoryName = budget.category_name || null;
      let categoryNameEn = budget.category_name_en || null;
      let parentCategoryName = budget.parent_category_name || null;
      let parentCategoryNameEn = budget.parent_category_name_en || null;

      if (legacyBudgetSchema) {
        const legacyCategory = budget.category;
        const mappedCategory = legacyCategory ? categoryLookupByName.get(legacyCategory) : null;
        categoryDefinitionId = mappedCategory?.id || null;
        categoryName = legacyCategory || mappedCategory?.name || null;
        categoryNameEn = mappedCategory?.name_en || null;
        const parentRow = mappedCategory?.parent_id ? categoryLookupById.get(mappedCategory.parent_id) : null;
        parentCategoryName = parentRow?.name || null;
        parentCategoryNameEn = parentRow?.name_en || null;
      }

      const spent = await computeSpent(
        client,
        { categoryDefinitionId, categoryName },
        start,
        end
      );

      const percentage = (spent / limit) * 100;

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
        status: percentage >= 100 ? 'exceeded' : percentage >= 80 ? 'warning' : 'good'
      });
    }

    res.status(200).json(usageData);
  } catch (error) {
    console.error('Error calculating budget usage:', error);
    res.status(500).json({ error: 'Failed to calculate budget usage' });
  } finally {
    client.release();
  }
}
