const actualDatabase = require('../database.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');

let database = actualDatabase;

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function listRules() {
  const result = await database.query(
    `
      SELECT
        cr.id,
        cr.name_pattern,
        cr.category_definition_id,
        cr.category_type,
        cr.category_path,
        cr.is_active,
        cr.priority,
        cr.created_at,
        cr.updated_at,
        cd.name AS category_name,
        cd.name_en AS category_name_en,
        cd.hierarchy_path,
        cd.depth_level
      FROM categorization_rules cr
      LEFT JOIN category_definitions cd ON cr.category_definition_id = cd.id
      ORDER BY cr.priority DESC, cr.created_at DESC
    `,
  );

  return result.rows;
}

async function fetchCategoryDetails(client, categoryDefinitionId) {
  const categoryResult = await client.query(
    `
      WITH RECURSIVE category_tree AS (
        SELECT
          cd.id,
          cd.parent_id,
          cd.name,
          cd.category_type,
          cd.name AS path
        FROM category_definitions cd
        WHERE cd.id = $1

        UNION ALL

        SELECT
          parent.id,
          parent.parent_id,
          parent.name,
          parent.category_type,
          parent.name || ' > ' || ct.path AS path
        FROM category_definitions parent
        JOIN category_tree ct ON parent.id = ct.parent_id
      )
      SELECT path, category_type, name
      FROM category_tree
      WHERE parent_id IS NULL
      LIMIT 1
    `,
    [categoryDefinitionId],
  );

  return categoryResult.rows[0] || null;
}

async function createRule(payload = {}) {
  const {
    name_pattern,
    target_category,
    category_definition_id,
    category_type,
    priority,
  } = payload;

  const client = await database.getClient();

  try {
    let finalTargetCategory = target_category ?? null;
    let finalCategoryType = category_type ?? null;
    let categoryPath = null;

    if (category_definition_id) {
      const categoryDetails = await fetchCategoryDetails(client, category_definition_id);

      if (categoryDetails) {
        finalTargetCategory = categoryDetails.name;
        finalCategoryType = categoryDetails.category_type;
        categoryPath = categoryDetails.path;
      }
    }

    const insertResult = await client.query(
      `
        INSERT INTO categorization_rules
          (name_pattern, target_category, category_definition_id, category_type, category_path, priority)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (name_pattern, target_category)
        DO UPDATE SET
          category_definition_id = EXCLUDED.category_definition_id,
          category_type = EXCLUDED.category_type,
          category_path = EXCLUDED.category_path,
          priority = EXCLUDED.priority,
          is_active = true,
          updated_at = CURRENT_TIMESTAMP
        RETURNING
          id,
          name_pattern,
          target_category,
          category_definition_id,
          category_type,
          category_path,
          is_active,
          priority,
          created_at,
          updated_at
      `,
      [
        name_pattern,
        finalTargetCategory,
        category_definition_id || null,
        finalCategoryType || null,
        categoryPath,
        priority || 0,
      ],
    );

    return insertResult.rows[0];
  } finally {
    client.release();
  }
}

async function updateRule(payload = {}) {
  const { id } = payload;
  if (!id) {
    throw serviceError(400, 'id is required');
  }

  const updates = [];
  const params = [id];
  let paramIndex = 2;

  const fields = [
    'name_pattern',
    'target_category',
    'category_definition_id',
    'category_type',
    'category_path',
    'is_active',
    'priority',
  ];

  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      updates.push(`${field} = $${paramIndex}`);
      params.push(payload[field]);
      paramIndex += 1;
    }
  });

  updates.push('updated_at = CURRENT_TIMESTAMP');

  const result = await database.query(
    `
      UPDATE categorization_rules
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING
        id,
        name_pattern,
        target_category,
        category_definition_id,
        category_type,
        category_path,
        is_active,
        priority,
        created_at,
        updated_at
    `,
    params,
  );

  return result.rows[0];
}

async function deleteRule({ id }) {
  if (!id) {
    throw serviceError(400, 'id is required');
  }

  await database.query(
    `
      DELETE FROM categorization_rules
      WHERE id = $1
    `,
    [id],
  );

  return { success: true };
}

async function createAutoRule(payload = {}) {
  const {
    transactionName,
    categoryDefinitionId,
    categoryType,
  } = payload;

  if (!transactionName || !categoryDefinitionId) {
    throw serviceError(400, 'Missing required fields: transactionName, categoryDefinitionId');
  }

  const existingRule = await database.query(
    `SELECT id FROM categorization_rules WHERE LOWER(name_pattern) = LOWER($1)`,
    [transactionName],
  );

  if (existingRule.rows.length > 0) {
    const ruleId = existingRule.rows[0].id;

    // Get full rule details to show user
    const ruleDetails = await database.query(
      `SELECT cr.id, cr.name_pattern, cr.target_category, cr.category_path,
              cd.name as category_name
       FROM categorization_rules cr
       LEFT JOIN category_definitions cd ON cr.category_definition_id = cd.id
       WHERE cr.id = $1`,
      [ruleId],
    );

    const rule = ruleDetails.rows[0];
    const categoryDisplay = rule.category_name || rule.target_category || 'Unknown';

    return {
      success: true,
      alreadyExists: true,
      rule: rule,
      message: `Rule already exists for "${transactionName}" → categorizes to ${categoryDisplay}`,
    };
  }

  const categoryResult = await database.query(
    `SELECT cd.id, cd.name, cd.category_type, cd.parent_id, parent.name AS parent_name
       FROM category_definitions cd
       LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
      WHERE cd.id = $1`,
    [categoryDefinitionId],
  );

  if (categoryResult.rows.length === 0) {
    throw serviceError(404, 'Category not found');
  }

  const category = categoryResult.rows[0];
  const categoryPath = category.parent_name
    ? `${category.parent_name} > ${category.name}`
    : category.name;

  const insertResult = await database.query(
    `INSERT INTO categorization_rules
       (name_pattern, target_category, category_path, category_definition_id, category_type, is_active, priority)
     VALUES ($1, $2, $3, $4, $5, true, 50)
     RETURNING id, name_pattern, target_category, category_path, category_definition_id, category_type, is_active, priority`,
    [
      transactionName,
      category.name,
      categoryPath,
      categoryDefinitionId,
      categoryType || category.category_type,
    ],
  );

  return {
    success: true,
    rule: insertResult.rows[0],
    message: 'Rule created successfully',
  };
}

async function previewRuleMatches(params = {}) {
  const { pattern, ruleId } = params;
  const limitParam = params.limit !== undefined ? params.limit : 100;

  if (!pattern && !ruleId) {
    throw serviceError(400, 'Pattern or ruleId is required');
  }

  let namePattern = pattern;

  if (ruleId) {
    const ruleResult = await database.query(
      'SELECT name_pattern FROM categorization_rules WHERE id = $1',
      [ruleId],
    );

    if (ruleResult.rows.length === 0) {
      throw serviceError(404, 'Rule not found');
    }

    namePattern = ruleResult.rows[0].name_pattern;
  }

  const limit = Number.parseInt(limitParam, 10);
  const safeLimit = Number.isNaN(limit) || limit <= 0 ? 100 : Math.min(limit, 500);
  const patternWithWildcards = `%${namePattern}%`;

  const [transactionsResult, countResult] = await Promise.all([
    database.query(
      `SELECT
         t.identifier,
         t.vendor,
         t.date,
         t.name,
         t.price,
         t.account_number,
         t.memo,
         cd.id AS category_definition_id,
         cd.name AS category_name,
         parent.name AS parent_category_name
       FROM transactions t
       LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
       LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
       WHERE LOWER(t.name) LIKE LOWER($1)
       ORDER BY t.date DESC
       LIMIT $2`,
      [patternWithWildcards, safeLimit],
    ),
    database.query(
      `SELECT COUNT(*) AS total
         FROM transactions
        WHERE LOWER(name) LIKE LOWER($1)`
      , [patternWithWildcards],
    ),
  ]);

  const totalCount = Number.parseInt(countResult.rows[0].total, 10) || 0;
  const matchedTransactions = transactionsResult.rows.map((row) => ({
    identifier: row.identifier,
    vendor: row.vendor,
    date: row.date,
    name: row.name,
    price: Number.parseFloat(row.price),
    category: row.category,
    parentCategory: row.parent_category,
    categoryName: row.category_name,
    parentCategoryName: row.parent_category_name,
    accountNumber: row.account_number,
    memo: row.memo,
  }));

  return {
    pattern: namePattern,
    totalCount,
    matchedTransactions,
    limitApplied: safeLimit,
  };
}

async function applyCategorizationRules() {
  const client = await database.getClient();

  try {
    const rulesResult = await client.query(
      `
        SELECT
          id,
          name_pattern,
          target_category,
          category_definition_id,
          category_type
        FROM categorization_rules
        WHERE is_active = true
        ORDER BY priority DESC, id
      `,
    );

    const rules = rulesResult.rows;

    if (rules.length === 0) {
      return {
        success: true,
        rulesApplied: 0,
        transactionsUpdated: 0,
      };
    }

    const bankCategoryResult = await client.query(
      `
        SELECT id
        FROM category_definitions
        WHERE name = $1
        LIMIT 1
      `,
      [BANK_CATEGORY_NAME],
    );
    const bankCategoryId = bankCategoryResult.rows[0]?.id ?? null;

    let totalUpdated = 0;

    for (const rule of rules) {
      const pattern = `%${rule.name_pattern}%`;
      let categoryId = rule.category_definition_id || null;
      let categoryRecord = null;

      if (categoryId) {
        const recordResult = await client.query(
          `
            SELECT
              cd.id,
              cd.name,
              cd.category_type,
              cd.parent_id,
              parent.name AS parent_name
            FROM category_definitions cd
            LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
            WHERE cd.id = $1
          `,
          [categoryId],
        );
        categoryRecord = recordResult.rows[0] || null;
      } else if (rule.target_category) {
        const fallbackResult = await client.query(
          `
            SELECT
              cd.id,
              cd.name,
              cd.category_type,
              cd.parent_id,
              parent.name AS parent_name
            FROM category_definitions cd
            LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
            WHERE LOWER(cd.name) = LOWER($1)
            LIMIT 1
          `,
          [rule.target_category],
        );
        categoryRecord = fallbackResult.rows[0] || null;
        categoryId = categoryRecord?.id || null;
      }

      if (!categoryRecord || !categoryId) {
        continue;
      }

      const priceCondition =
        categoryRecord.category_type === 'income'
          ? 'AND price > 0'
          : categoryRecord.category_type === 'expense'
            ? 'AND price < 0'
            : '';

      const confidence = categoryRecord.category_type === 'income' ? 0.7 : 0.8;

      const updateResult = await client.query(
        `
          UPDATE transactions
          SET
            category_definition_id = $2,
            category_type = $3,
            auto_categorized = true,
            confidence_score = MAX(confidence_score, $4)
          WHERE LOWER(name) LIKE LOWER($1)
            ${priceCondition}
            AND (
              category_definition_id IS NULL
              OR ($5 IS NOT NULL AND category_definition_id = $5)
              OR auto_categorized = true
              OR category_definition_id IN (
                SELECT id FROM category_definitions
                WHERE depth_level < 2
              )
            )
        `,
        [pattern, categoryId, categoryRecord.category_type, confidence, bankCategoryId],
      );

      totalUpdated += updateResult.rowCount;
    }

    return {
      success: true,
      rulesApplied: rules.length,
      transactionsUpdated: totalUpdated,
    };
  } finally {
    client.release();
  }
}

async function mergeCategories({ sourceCategories, newCategoryName }) {
  if (!Array.isArray(sourceCategories) || sourceCategories.length < 2) {
    throw serviceError(400, 'At least 2 source categories are required');
  }

  if (!newCategoryName || typeof newCategoryName !== 'string' || newCategoryName.trim() === '') {
    throw serviceError(400, 'New category name is required');
  }

  const trimmedName = newCategoryName.trim();
  const placeholders = sourceCategories.map((_, idx) => `$${idx + 2}`).join(', ');

  const result = await database.query(
    `
      UPDATE transactions
      SET category = $1
      WHERE category IN (${placeholders})
    `,
    [trimmedName, ...sourceCategories],
  );

  return {
    success: true,
    message: `Successfully merged categories into "${trimmedName}"`,
    updatedRows: result.rowCount,
  };
}

module.exports = {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  createAutoRule,
  previewRuleMatches,
  applyCategorizationRules,
  mergeCategories,
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
