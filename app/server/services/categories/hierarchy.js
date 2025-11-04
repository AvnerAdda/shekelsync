const database = require('../database.js');

const CREDIT_CARD_VENDORS = ['visaCal', 'max', 'isracard', 'amex'];
const BANK_VENDORS = [
  'hapoalim',
  'leumi',
  'mizrahi',
  'otsarHahayal',
  'beinleumi',
  'massad',
  'yahav',
  'union',
  'discount',
  'mercantile',
  'beyahadBishvilha',
  'behatsdaa',
  'pagi',
  'oneZero',
];

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function toBoolean(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function normalizeNumeric(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw serviceError(400, `${field} is required`);
    }
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw serviceError(400, `${field} must be a number`);
  }
  return parsed;
}

function buildPlaceholders(values, startIndex = 1) {
  return values.map((_, index) => `$${startIndex + index}`).join(', ');
}

async function listHierarchy(params = {}) {
  const includeInactiveFlag = toBoolean(params.includeInactive);
  const includeInactive = includeInactiveFlag === undefined ? false : includeInactiveFlag;
  const { type } = params;

  let query = `
    SELECT
      cd.id,
      cd.name,
      cd.name_en,
      cd.parent_id,
      cd.category_type,
      cd.display_order,
      cd.icon,
      cd.color,
      cd.description,
      cd.is_active,
      cd.hierarchy_path,
      cd.depth_level,
      cd.created_at,
      cd.updated_at,
      COUNT(DISTINCT t.identifier || '-' || t.vendor) as transaction_count,
      COALESCE(SUM(ABS(t.price)), 0) as total_amount
    FROM category_definitions cd
    LEFT JOIN transactions t ON t.category_definition_id = cd.id
  `;

  const conditions = [];
  const queryParams = [];

  if (!includeInactive) {
    conditions.push('cd.is_active = true');
  }

  if (type) {
    conditions.push(`cd.category_type = $${queryParams.length + 1}`);
    queryParams.push(type);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += `
    GROUP BY cd.id, cd.name, cd.name_en, cd.parent_id, cd.category_type, cd.display_order,
             cd.icon, cd.color, cd.description, cd.is_active, cd.hierarchy_path, cd.depth_level,
             cd.created_at, cd.updated_at
    ORDER BY cd.category_type, cd.display_order, cd.name
  `;

  const categoryResult = await database.query(query, queryParams);
  const categories = categoryResult.rows.map((row) => ({
    ...row,
    transaction_count: Number.parseInt(row.transaction_count, 10) || 0,
    total_amount: Number.parseFloat(row.total_amount) || 0,
  }));

  // Find transactions that need categorization:
  // 1. Transactions with no category assigned (category_definition_id IS NULL)
  // 2. Transactions assigned to non-leaf categories (categories that have children)
  const [uncategorizedSummary, uncategorizedRecent] = await Promise.all([
    database.query(
      `SELECT COUNT(*) AS total_transactions, COALESCE(SUM(ABS(price)), 0) AS total_amount
       FROM transactions t
       LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
       WHERE t.category_definition_id IS NULL
          OR EXISTS (
            SELECT 1 FROM category_definitions child
            WHERE child.parent_id = cd.id
          )`,
    ),
    database.query(
      `SELECT
         t.identifier,
         t.vendor,
         t.name,
         t.date,
         t.price,
         t.account_number,
         t.category_definition_id,
         t.category_type,
         cd.name as category_name,
         cd.color as category_color,
         cd.icon as category_icon
       FROM transactions t
       LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
       WHERE t.category_definition_id IS NULL
          OR EXISTS (
            SELECT 1 FROM category_definitions child
            WHERE child.parent_id = cd.id
          )
       ORDER BY t.date DESC
       LIMIT 50`,
    ),
  ]);

  const summaryRow = uncategorizedSummary.rows[0] || { total_transactions: 0, total_amount: 0 };

  return {
    categories,
    uncategorized: {
      totalCount: Number.parseInt(summaryRow.total_transactions, 10) || 0,
      totalAmount: Number.parseFloat(summaryRow.total_amount) || 0,
      recentTransactions: uncategorizedRecent.rows.map((row) => ({
        identifier: row.identifier,
        vendor: row.vendor,
        name: row.name,
        date: row.date,
        price: Number.parseFloat(row.price),
        accountNumber: row.account_number,
        categoryDefinitionId: row.category_definition_id,
        categoryType: row.category_type,
        categoryName: row.category_name,
        categoryColor: row.category_color,
        categoryIcon: row.category_icon,
      })),
    },
  };
}

async function createCategory(payload = {}) {
  const {
    name,
    parent_id,
    category_type,
    icon,
    color,
    description,
    display_order,
  } = payload;

  if (!name || !category_type) {
    throw serviceError(400, 'Name and category_type are required');
  }

  if (!['expense', 'investment', 'income'].includes(category_type)) {
    throw serviceError(400, 'Invalid category_type. Must be expense, investment, or income');
  }

  const parentId = parent_id !== undefined ? normalizeNumeric(parent_id, 'parent_id') : null;

  const duplicateCheck = await database.query(
    `SELECT id FROM category_definitions
     WHERE name = $1 AND parent_id IS NOT DISTINCT FROM $2 AND category_type = $3`,
    [name, parentId, category_type],
  );

  if (duplicateCheck.rows.length > 0) {
    throw serviceError(400, 'Category with this name already exists at this level');
  }

  let hierarchyBase = null;
  let depthLevel = 0;

  if (parentId !== null) {
    const parentResult = await database.query(
      'SELECT category_type, hierarchy_path, depth_level FROM category_definitions WHERE id = $1',
      [parentId],
    );

    if (parentResult.rows.length === 0) {
      throw serviceError(400, 'Parent category not found');
    }

    const parentRow = parentResult.rows[0];

    if (parentRow.category_type !== category_type) {
      throw serviceError(400, 'Parent category must be of the same type');
    }

    hierarchyBase = parentRow.hierarchy_path;
    depthLevel = (parentRow.depth_level || 0) + 1;
  }

  let finalDisplayOrder = display_order;
  if (finalDisplayOrder !== undefined) {
    finalDisplayOrder = normalizeNumeric(finalDisplayOrder, 'display_order');
  }

  if (finalDisplayOrder === null || finalDisplayOrder === undefined) {
    const orderResult = await database.query(
      `SELECT COALESCE(MAX(display_order), 0) + 1 as next_order
       FROM category_definitions
       WHERE parent_id IS NOT DISTINCT FROM $1 AND category_type = $2`,
      [parentId, category_type],
    );
    finalDisplayOrder = orderResult.rows[0].next_order;
  }

  const insertResult = await database.query(
    `INSERT INTO category_definitions
      (name, parent_id, category_type, icon, color, description, display_order, depth_level, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     RETURNING *`,
    [
      name,
      parentId,
      category_type,
      icon || null,
      color || null,
      description || null,
      finalDisplayOrder,
      depthLevel,
    ],
  );

  const newCategory = insertResult.rows[0];
  const newId = newCategory.id;

  let hierarchyPath;
  if (parentId !== null) {
    if (hierarchyBase) {
      hierarchyPath = `${hierarchyBase}/${newId}`;
    } else {
      hierarchyPath = `${parentId}/${newId}`;
    }
  } else {
    hierarchyPath = String(newId);
  }

  await database.query(
    'UPDATE category_definitions SET hierarchy_path = $1 WHERE id = $2',
    [hierarchyPath, newId],
  );

  newCategory.hierarchy_path = hierarchyPath;
  return newCategory;
}

async function updateCategory(payload = {}) {
  const { id, name, icon, color, description, display_order, is_active } = payload;

  const categoryId = normalizeNumeric(id, 'Category ID', { required: true });

  const updates = [];
  const params = [];
  let paramIndex = 1;

  if (name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    params.push(name);
  }

  if (icon !== undefined) {
    updates.push(`icon = $${paramIndex++}`);
    params.push(icon);
  }

  if (color !== undefined) {
    updates.push(`color = $${paramIndex++}`);
    params.push(color);
  }

  if (description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    params.push(description);
  }

  if (display_order !== undefined) {
    const orderValue = normalizeNumeric(display_order, 'display_order');
    updates.push(`display_order = $${paramIndex++}`);
    params.push(orderValue);
  }

  if (is_active !== undefined) {
    const activeValue = toBoolean(is_active);
    if (activeValue === undefined) {
      throw serviceError(400, 'is_active must be a boolean value');
    }
    updates.push(`is_active = $${paramIndex++}`);
    params.push(activeValue);
  }

  if (updates.length === 0) {
    throw serviceError(400, 'No fields to update');
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(categoryId);

  const result = await database.query(
    `UPDATE category_definitions
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    params,
  );

  if (result.rows.length === 0) {
    throw serviceError(404, 'Category not found');
  }

  return result.rows[0];
}

async function deleteCategory(params = {}) {
  const categoryId = normalizeNumeric(params.id, 'Category ID', { required: true });

  const txnCheck = await database.query(
    'SELECT COUNT(*) as count FROM transactions WHERE category_definition_id = $1',
    [categoryId],
  );

  if (Number.parseInt(txnCheck.rows[0].count, 10) > 0) {
    throw serviceError(
      400,
      'Cannot delete category with existing transactions. Please reassign transactions first.',
    );
  }

  const childCheck = await database.query(
    'SELECT COUNT(*) as count FROM category_definitions WHERE parent_id = $1',
    [categoryId],
  );

  if (Number.parseInt(childCheck.rows[0].count, 10) > 0) {
    throw serviceError(
      400,
      'Cannot delete category with subcategories. Please delete subcategories first.',
    );
  }

  const result = await database.query(
    'DELETE FROM category_definitions WHERE id = $1 RETURNING *',
    [categoryId],
  );

  if (result.rows.length === 0) {
    throw serviceError(404, 'Category not found');
  }

  return { message: 'Category deleted successfully', category: result.rows[0] };
}

module.exports = {
  listHierarchy,
  createCategory,
  updateCategory,
  deleteCategory,
};
module.exports.default = module.exports;
