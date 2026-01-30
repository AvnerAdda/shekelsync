const actualDatabase = require('../database.js');
const { resolveCategory: actualResolveCategory } = require('../../../lib/category-helpers.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');
const { dialect } = require('../../../lib/sql-dialect.js');

const CONFIDENCE_UPDATE_EXPR = dialect.useSqlite
  ? 'CASE WHEN confidence_score IS NULL OR confidence_score < $3 THEN $3 ELSE confidence_score END'
  : 'GREATEST(confidence_score, $3)';

const CONFIDENCE_UPDATE_BULK_EXPR = dialect.useSqlite
  ? 'CASE WHEN confidence_score IS NULL OR confidence_score < $3 THEN $3 ELSE confidence_score END'
  : 'GREATEST(confidence_score, $3)';

let database = actualDatabase;
let resolveCategoryFn = actualResolveCategory;

async function categorizeTransaction(payload = {}) {
  const client = await database.getClient();

  try {
    const { transaction_name: transactionName, transaction_id: transactionId, vendor } = payload;

    if (!transactionName) {
      const error = new Error('transaction_name is required');
      error.status = 400;
      throw error;
    }

    const cleanName = transactionName.toLowerCase().trim();

    const matchesResult = await client.query(
      `SELECT
         cr.id,
         cr.name_pattern,
         cr.category_definition_id,
         cd.name AS subcategory,
         parent.name AS parent_category,
         cr.priority
       FROM categorization_rules cr
       LEFT JOIN category_definitions cd ON cd.id = cr.category_definition_id
       LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
       WHERE cr.is_active = true
         AND LOWER($1) LIKE '%' || LOWER(cr.name_pattern) || '%'
       ORDER BY
         LENGTH(cr.name_pattern) DESC,
         cr.priority DESC
       LIMIT 5`,
      [cleanName],
    );

    const matches = matchesResult.rows || [];

    if (matches.length === 0) {
      return {
        success: false,
        message: 'No matching merchant pattern found',
        transaction_name: transactionName,
        suggestions: [],
      };
    }

    const bestMatch = matches[0];
    const patternLength = bestMatch.name_pattern.length;
    const nameLength = cleanName.length || 1;
    const lengthRatio = patternLength / nameLength;
    const baseConfidence = bestMatch.category_definition_id ? 0.8 : 0.5;
    const finalConfidence = Math.min(baseConfidence * Math.max(lengthRatio, 0.5), 1.0);

    let categoryDefinitionId = bestMatch.category_definition_id || null;
    let parentCategory = bestMatch.parent_category || null;
    let subcategory = bestMatch.subcategory || null;

    if (!categoryDefinitionId) {
      const resolved = await resolveCategoryFn({
        client,
        rawCategory: subcategory || parentCategory,
        transactionName,
      });

      if (resolved) {
        categoryDefinitionId = resolved.categoryDefinitionId;
        parentCategory = resolved.parentCategory || parentCategory;
        subcategory = resolved.subcategory || subcategory;
      }
    }

    if (transactionId && vendor) {
      const updateResult = await client.query(
        `UPDATE transactions
            SET category_definition_id = COALESCE($1, category_definition_id),
                merchant_name = $2,
                auto_categorized = true,
                confidence_score = ${CONFIDENCE_UPDATE_EXPR}
          WHERE identifier = $4 AND vendor = $5
          RETURNING *`,
        [
          categoryDefinitionId,
          transactionName,
          finalConfidence,
          transactionId,
          vendor,
        ],
      );

      if (updateResult.rowCount === 0) {
        const error = new Error('Transaction not found');
        error.status = 404;
        throw error;
      }

      return {
        success: true,
        message: 'Transaction categorized successfully',
        transaction: updateResult.rows[0],
        match: {
          ...bestMatch,
          category_definition_id: categoryDefinitionId,
          parent_category: parentCategory,
          subcategory,
        },
        confidence: finalConfidence,
      };
    }

    return {
      success: true,
      message: 'Categorization suggestions found',
      transaction_name: transactionName,
      best_match: {
        category_definition_id: categoryDefinitionId,
        parent_category: parentCategory,
        subcategory,
        confidence: finalConfidence,
        pattern: bestMatch.name_pattern,
      },
      all_matches: matches.map((match) => ({
        category_definition_id: match.category_definition_id,
        parent_category: match.parent_category,
        subcategory: match.subcategory,
        confidence: Math.min(
          (match.category_definition_id ? 0.8 : 0.5) *
            Math.max(match.name_pattern.length / (cleanName.length || 1), 0.5),
          1.0,
        ),
        pattern: match.name_pattern,
      })),
    };
  } finally {
    client.release();
  }
}

async function bulkCategorizeTransactions(providedClient = null) {
  const client = providedClient || (await database.getClient());
  const shouldRelease = !providedClient;

  try {
    const patternsResult = await client.query(`
      SELECT
        cr.id,
        cr.name_pattern,
        cr.category_definition_id,
        cd.name AS subcategory,
        parent.name AS parent_category,
        cr.priority
      FROM categorization_rules cr
      LEFT JOIN category_definitions cd ON cd.id = cr.category_definition_id
      LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
      WHERE cr.is_active = true
      ORDER BY LENGTH(cr.name_pattern) DESC, cr.priority DESC
    `);

    const patterns = patternsResult.rows || [];
    let totalUpdated = 0;

    for (const pattern of patterns) {
      let categoryId = pattern.category_definition_id || null;
      let parentCategory = pattern.parent_category || null;
      let subcategory = pattern.subcategory || null;

      if (!categoryId) {
        const resolved = await resolveCategoryFn({
          client,
          rawCategory: subcategory || parentCategory,
          transactionName: pattern.name_pattern,
        });
        if (resolved) {
          categoryId = resolved.categoryDefinitionId;
          parentCategory = resolved.parentCategory || parentCategory;
          subcategory = resolved.subcategory || subcategory;
        }
      }

      const confidence = categoryId ? 0.8 : 0.5;

      const updateResult = await client.query(
        `UPDATE transactions
            SET category_definition_id = COALESCE($2, category_definition_id),
                merchant_name = name,
                auto_categorized = true,
                confidence_score = ${CONFIDENCE_UPDATE_BULK_EXPR}
          WHERE LOWER(name) LIKE '%' || LOWER($1) || '%'
            AND category_definition_id NOT IN (
              SELECT id FROM category_definitions
              WHERE name = $4 OR category_type = 'income'
            )
            AND (
              category_definition_id IS NULL
              OR auto_categorized = false
              OR confidence_score < $3
            )`,
        [
          pattern.name_pattern,
          categoryId,
          confidence,
          BANK_CATEGORY_NAME,
        ],
      );

      totalUpdated += Number(updateResult.rowCount || 0);
    }

    return {
      patternsApplied: patterns.length,
      transactionsUpdated: totalUpdated,
    };
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

module.exports = {
  categorizeTransaction,
  bulkCategorizeTransactions,
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __setResolveCategory(fn) {
    resolveCategoryFn = typeof fn === 'function' ? fn : actualResolveCategory;
  },
  __resetDependencies() {
    database = actualDatabase;
    resolveCategoryFn = actualResolveCategory;
  },
};

module.exports.default = module.exports;
