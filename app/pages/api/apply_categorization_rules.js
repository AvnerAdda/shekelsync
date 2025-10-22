import { createApiHandler } from "./utils/apiHandler";
import { getDB } from "./db";
import { BANK_CATEGORY_NAME } from '../../lib/category-constants.js';

const handler = createApiHandler({
  validate: (req) => {
    if (req.method !== 'POST') {
      return "Only POST method is allowed";
    }
  },
  query: async (req) => {
    // This is a special case where we need to execute multiple queries
    // We'll handle this in the transform function
    return {
      sql: 'SELECT 1', // Dummy query
      params: []
    };
  },
  transform: async (result, req) => {
    const client = await getDB();
    
    try {
      // Get all active rules with category_definition_id
      const rulesResult = await client.query(`
        SELECT id, name_pattern, target_category, category_definition_id, category_type
        FROM categorization_rules
        WHERE is_active = true
        ORDER BY priority DESC, id
      `);

      const rules = rulesResult.rows;
      let totalUpdated = 0;

      // Apply each rule
      for (const rule of rules) {
        const pattern = `%${rule.name_pattern}%`;

        let categoryId = rule.category_definition_id || null;
        let categoryRecord = null;

        if (categoryId) {
          const recordResult = await client.query(
            `SELECT
               cd.id,
               cd.name,
               cd.category_type,
               cd.parent_id,
               parent.name AS parent_name
             FROM category_definitions cd
             LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
             WHERE cd.id = $1`,
            [categoryId]
          );
          categoryRecord = recordResult.rows[0] || null;
        } else if (rule.target_category) {
          const fallbackResult = await client.query(
            `SELECT
               cd.id,
               cd.name,
               cd.category_type,
               cd.parent_id,
               parent.name AS parent_name
             FROM category_definitions cd
             LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
             WHERE LOWER(cd.name) = LOWER($1)
             LIMIT 1`,
            [rule.target_category]
          );
          categoryRecord = fallbackResult.rows[0] || null;
          categoryId = categoryRecord?.id || null;
        }

        if (!categoryRecord || !categoryId) {
          continue;
        }

        const priceCondition = categoryRecord.category_type === 'income'
          ? 'AND price > 0'
          : categoryRecord.category_type === 'expense'
            ? 'AND price < 0'
            : '';

        const parentName = categoryRecord.parent_name || null;
        const subcategory = categoryRecord.parent_id ? categoryRecord.name : null;
        const categoryLabel = subcategory || categoryRecord.name;
        const confidence = categoryRecord.category_type === 'income' ? 0.7 : 0.8;

        const updateResult = await client.query(`
          UPDATE transactions
          SET
            category_definition_id = $2,
            category = $3,
            parent_category = $4,
            subcategory = $5,
            category_type = $6,
            auto_categorized = true,
            confidence_score = GREATEST(confidence_score, $7)
          WHERE LOWER(name) LIKE LOWER($1)
            ${priceCondition}
            AND category_definition_id NOT IN (
              SELECT id FROM category_definitions
              WHERE name = $8 OR category_type = 'income'
            )
        `, [
          pattern,
          categoryId,
          categoryLabel,
          parentName,
          subcategory,
          categoryRecord.category_type,
          confidence,
          BANK_CATEGORY_NAME
        ]);

        totalUpdated += updateResult.rowCount;
      }
      
      return {
        success: true,
        rulesApplied: rules.length,
        transactionsUpdated: totalUpdated
      };
    } catch (error) {
      console.error('Error applying categorization rules:', error);
      throw error;
    } finally {
      client.release();
    }
  }
});

export default handler; 
