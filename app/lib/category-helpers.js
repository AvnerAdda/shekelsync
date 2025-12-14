const database = require('../server/services/database.js');
const { BANK_CATEGORY_NAME } = require('./category-constants.js');

function normalizeCategoryPath(path) {
  if (!path) {
    return path;
  }
  return path.split('>').map((segment) => segment.trim()).join(' > ');
}

async function findCategoryByName(name, parentId = null, client) {
  const normalizedName = name.trim().toLowerCase();
  const params = [normalizedName];
  let parentClause = '';
  if (parentId !== null && parentId !== undefined) {
    parentClause = 'AND parent_id = $2';
    params.push(parentId);
  }

  const result = await client.query(
    `
      SELECT id, name, category_type, parent_id
      FROM category_definitions
      WHERE LOWER(name) = $1 ${parentClause}
      LIMIT 1
    `,
    params,
  );

  return result.rows[0] || null;
}

async function matchCategorizationRule(transactionName, client) {
  const result = await client.query(
    `
      SELECT
        cr.id,
        cr.name_pattern,
        cr.target_category,
        cr.category_definition_id,
        cd.name AS subcategory,
        parent.name AS parent_category
      FROM categorization_rules cr
      LEFT JOIN category_definitions cd ON cd.id = cr.category_definition_id
      LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
      WHERE cr.is_active = true
      ORDER BY cr.priority DESC, cr.id
    `,
  );

  const normalizedName = (transactionName || '').toLowerCase();
  return result.rows.find((rule) => {
    const pattern = (rule.name_pattern || '').toLowerCase();
    return pattern && normalizedName.includes(pattern);
  }) || null;
}

async function getCategoryInfo(categoryId, client = null) {
  if (!categoryId) return null;

  const executor = client || await database.getClient();
  const shouldRelease = !client;

  try {
    const result = await executor.query(
      `SELECT
         cd.id,
         cd.name,
         cd.name_en,
         cd.name_fr,
         cd.category_type,
         cd.parent_id,
         parent.name AS parent_name,
         parent.name_en AS parent_name_en,
         parent.name_fr AS parent_name_fr
       FROM category_definitions cd
       LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
       WHERE cd.id = $1`,
      [categoryId]
    );

    return result.rows[0] || null;
  } finally {
    if (shouldRelease && executor.release) {
      executor.release();
    }
  }
}

function normaliseCategoryRecord(record) {
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

async function resolveCategoryFromMapping(term, client) {
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
     WHERE cm.old_category_name = $1`,
    [term]
  );

  if (mapping.rows.length === 0) return null;
  return mapping.rows[0];
}

async function resolveCategory({
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

module.exports = {
  normalizeCategoryPath,
  resolveCategory,
  findCategoryByName,
  matchCategorizationRule,
  getCategoryInfo,
  BANK_CATEGORY_NAME,
};
