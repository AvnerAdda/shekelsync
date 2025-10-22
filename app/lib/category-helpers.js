import pool from '../pages/api/db.js';

/**
 * Fetch a category definition with its parent information.
 * @param {import('pg').PoolClient | null} client
 * @param {number} categoryId
 * @returns {Promise<{
 *  id: number;
 *  name: string;
 *  name_en: string | null;
 *  category_type: string;
 *  parent_id: number | null;
 *  parent_name: string | null;
 *  parent_name_en: string | null;
 * } | null>}
 */
export async function getCategoryInfo(categoryId, client = null) {
  if (!categoryId) return null;
  const executor = client || (await pool.connect());

  try {
    const result = await executor.query(
      `SELECT
         cd.id,
         cd.name,
         cd.name_en,
         cd.category_type,
         cd.parent_id,
         parent.name AS parent_name,
         parent.name_en AS parent_name_en
       FROM category_definitions cd
       LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
       WHERE cd.id = $1`,
      [categoryId]
    );

    return result.rows[0] || null;
  } finally {
    if (!client) {
      executor.release();
    }
  }
}

/**
 * Resolve a category by matching the Hebrew term stored in category_mapping.
 * Returns the mapped category definition (if any).
 * @param {string} term
 * @param {import('pg').PoolClient} client
 */
export async function resolveCategoryFromMapping(term, client) {
  if (!term) return null;
  const mapping = await client.query(
    `SELECT
        cm.category_definition_id,
        cd.name AS subcategory,
        cd.parent_id,
        parent.name AS parent_category
     FROM category_mapping cm
     JOIN category_definitions cd ON cd.id = cm.category_definition_id
     LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
     WHERE cm.hebrew_category = $1`,
    [term]
  );

  if (mapping.rows.length === 0) return null;
  return mapping.rows[0];
}

/**
 * Find a category definition by its name (case-insensitive).
 * Optionally filter by parent category name.
 * @param {string} name
 * @param {string | null} parentName
 * @param {import('pg').PoolClient} client
 */
export async function findCategoryByName(name, parentName, client) {
  if (!name) return null;
  const params = [name];
  let query = `
    SELECT
      cd.id,
      cd.name,
      cd.name_en,
      cd.category_type,
      cd.parent_id,
      parent.name AS parent_name,
      parent.name_en AS parent_name_en
    FROM category_definitions cd
    LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
    WHERE LOWER(cd.name) = LOWER($1)
  `;

  if (parentName) {
    params.push(parentName);
    query += ' AND LOWER(parent.name) = LOWER($2)';
  }

  const result = await client.query(query, params);
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

export function normaliseCategoryRecord(record) {
  if (!record) return null;

  if ('id' in record) {
    return {
      categoryDefinitionId: record.id,
      subcategory: record.name,
      parentCategory: record.parent_name || null,
      hasParent: record.parent_id !== null && record.parent_id !== undefined,
    };
  }

  return {
    categoryDefinitionId: record.category_definition_id || null,
    subcategory: record.subcategory || null,
    parentCategory: record.parent_category || null,
    hasParent:
      record.parent_id !== null &&
      record.parent_id !== undefined &&
      record.parent_id !== 'null',
  };
}

export async function matchCategorizationRule(transactionName, client) {
  if (!transactionName) return null;

  const cleanName = transactionName.toLowerCase().trim();
  const result = await client.query(
    `SELECT
        cr.id,
        cr.name_pattern,
        cr.category_definition_id,
        cd.name AS subcategory,
        cd.parent_id,
        parent.name AS parent_category,
        cr.priority
     FROM categorization_rules cr
     LEFT JOIN category_definitions cd ON cd.id = cr.category_definition_id
     LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
     WHERE cr.is_active = true
       AND LOWER($1) LIKE '%' || LOWER(cr.name_pattern) || '%'
     ORDER BY
       cr.priority DESC,
       LENGTH(cr.name_pattern) DESC
     LIMIT 1`,
    [cleanName]
  );

  return result.rows[0] || null;
}

/**
 * Resolve the best category information for a transaction.
 * Returns an object containing the categoryDefinitionId (if found),
 * along with the human-friendly parent/subcategory labels.
 */
export async function resolveCategory({
  client,
  rawCategory,
  transactionName,
}) {
  let info = null;

  if (rawCategory) {
    info = normaliseCategoryRecord(
      await resolveCategoryFromMapping(rawCategory, client)
    );
  }

  if (!info && transactionName) {
    info = normaliseCategoryRecord(
      await matchCategorizationRule(transactionName, client)
    );
  }

  if (!info && rawCategory) {
    info = normaliseCategoryRecord(
      await findCategoryByName(rawCategory, null, client)
    );
  }

  if (!info) return null;

  const categoryDefinitionId = info.categoryDefinitionId || null;
  let parentCategory = info.parentCategory || null;
  let subcategory = info.subcategory || null;

  if (categoryDefinitionId) {
    const detailed = await getCategoryInfo(categoryDefinitionId, client);
    if (detailed) {
      parentCategory = detailed.parent_id ? detailed.parent_name : detailed.name;
      subcategory = detailed.parent_id ? detailed.name : null;
    }
  }

  return {
    categoryDefinitionId,
    parentCategory,
    subcategory,
  };
}
