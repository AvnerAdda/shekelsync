import { getDB } from './db.js';
import {
  resolveCategory,
  matchCategorizationRule
} from '../../lib/category-helpers.js';
import { BANK_CATEGORY_NAME } from '../../lib/category-constants.js';

/**
 * Intelligent transaction categorization using merchant catalog
 * This API attempts to auto-categorize a transaction based on its name
 * using pattern matching against categorization rules (and optional merchant mappings)
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { transaction_name, transaction_id, vendor } = req.body;

    if (!transaction_name) {
      return res.status(400).json({ error: 'transaction_name is required' });
    }

    // Clean the transaction name for better matching
    const cleanName = transaction_name.toLowerCase().trim();

    const rulesResult = await client.query(
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
      [cleanName]
    );

    const matches = rulesResult.rows;

    if (matches.length === 0) {
      return res.status(200).json({
        success: false,
        message: 'No matching merchant pattern found',
        transaction_name,
        suggestions: []
      });
    }

    // Get the best match (first one due to ordering)
    const bestMatch = matches[0];
    const patternLength = bestMatch.name_pattern.length;
    const nameLength = cleanName.length;
    const lengthRatio = patternLength / (nameLength || 1);
    const baseConfidence = bestMatch.category_definition_id ? 0.8 : 0.5;
    const finalConfidence = Math.min(baseConfidence * Math.max(lengthRatio, 0.5), 1.0);

    // If transaction_id and vendor are provided, update the transaction
    if (transaction_id && vendor) {
      let parentCategory = bestMatch.parent_category || null;
      let subcategory = bestMatch.subcategory || null;
      let categoryDefinitionId = bestMatch.category_definition_id || null;

      if (!categoryDefinitionId) {
        const resolved = await resolveCategory({
          client,
          rawCategory: bestMatch.subcategory || bestMatch.parent_category,
          transactionName: transaction_name,
        });
        if (resolved) {
          categoryDefinitionId = resolved.categoryDefinitionId;
          parentCategory = resolved.parentCategory || parentCategory;
          subcategory = resolved.subcategory || subcategory;
        }
      }

      const categoryLabel = subcategory || parentCategory || transaction_name;

      const updateResult = await client.query(
        `UPDATE transactions
         SET
           category_definition_id = COALESCE($1, category_definition_id),
           parent_category = COALESCE($2, parent_category),
           subcategory = COALESCE($3, subcategory),
           category = COALESCE($4, category),
           merchant_name = $5,
           auto_categorized = true,
           confidence_score = MAX(confidence_score, $6)
         WHERE identifier = $7 AND vendor = $8
         RETURNING *`,
        [
          categoryDefinitionId,
          parentCategory,
          subcategory,
          categoryLabel,
          transaction_name,
          finalConfidence,
          transaction_id,
          vendor
        ]
      );

      if (updateResult.rowCount === 0) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      return res.status(200).json({
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
      all_matches: matches
    });
    }

    // If no transaction to update, just return the suggestions
    return res.status(200).json({
      success: true,
      message: 'Categorization suggestions found',
      transaction_name,
      best_match: {
        category_definition_id: bestMatch.category_definition_id,
        parent_category: bestMatch.parent_category,
        subcategory: bestMatch.subcategory,
        confidence: finalConfidence,
        pattern: bestMatch.name_pattern
      },
      all_matches: matches.map(m => ({
        category_definition_id: m.category_definition_id,
        parent_category: m.parent_category,
        subcategory: m.subcategory,
        confidence: Math.min(
          (m.category_definition_id ? 0.8 : 0.5) *
            Math.max(m.name_pattern.length / (cleanName.length || 1), 0.5),
          1.0
        ),
        pattern: m.name_pattern
      }))
    });

  } catch (error) {
    console.error('Error in categorize_transaction API:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  } finally {
    client.release();
  }
}

/**
 * Bulk categorize all transactions using merchant catalog
 */
export async function bulkCategorizeTransactions(client) {
  try {
    // Get all active merchant patterns
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

    const patterns = patternsResult.rows;
    let totalUpdated = 0;

    // Apply each pattern to matching transactions
    for (const pattern of patterns) {
      let categoryId = pattern.category_definition_id;
      let parentCategory = pattern.parent_category || null;
      let subcategory = pattern.subcategory || null;

      if (!categoryId) {
        const resolved = await resolveCategory({
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

      const categoryLabel = subcategory || parentCategory || pattern.name_pattern;
      const confidence = categoryId ? 0.8 : 0.5;

      const updateResult = await client.query(
        `UPDATE transactions
         SET
           category_definition_id = COALESCE($2, category_definition_id),
           parent_category = COALESCE($3, parent_category),
           subcategory = COALESCE($4, subcategory),
           category = COALESCE($5, category),
           merchant_name = name,
           auto_categorized = true,
           confidence_score = MAX(confidence_score, $6)
         WHERE
           LOWER(name) LIKE '%' || LOWER($1) || '%'
           AND category_definition_id NOT IN (
             SELECT id FROM category_definitions
             WHERE name = $7 OR category_type = 'income'
           )
           AND (
             category_definition_id IS NULL
             OR auto_categorized = false
             OR confidence_score < $6
           )`,
        [
          pattern.name_pattern,
          categoryId,
          parentCategory,
          subcategory,
          categoryLabel,
          confidence,
          BANK_CATEGORY_NAME
        ]
      );

      totalUpdated += updateResult.rowCount;
    }

    console.log(`Bulk categorization: Applied ${patterns.length} patterns to ${totalUpdated} transactions`);

    return {
      patternsApplied: patterns.length,
      transactionsUpdated: totalUpdated
    };
  } catch (error) {
    console.error('Error in bulk categorization:', error);
    throw error;
  }
}
