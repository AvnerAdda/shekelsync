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

      // Look up the bank category ID once so rules can override those assignments
      const bankCategoryResult = await client.query(
        `SELECT id FROM category_definitions
         WHERE name = $1
         LIMIT 1`,
        [BANK_CATEGORY_NAME]
      );
      const bankCategoryId = bankCategoryResult.rows[0]?.id ?? null;

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

        // For legacy category field, use the leaf category name
        const categoryLabel = categoryRecord.name;
        const confidence = categoryRecord.category_type === 'income' ? 0.7 : 0.8;

        const updateResult = await client.query(`
          UPDATE transactions
          SET
            category_definition_id = $2,
            category = $3,
            category_type = $4,
            auto_categorized = true,
            confidence_score = MAX(confidence_score, $5)
          WHERE LOWER(name) LIKE LOWER($1)
            ${priceCondition}
            AND (
              category_definition_id IS NULL
              OR ($6 IS NOT NULL AND category_definition_id = $6)
              OR auto_categorized = true
            )
        `, [
          pattern,
          categoryId,
          categoryLabel,
          categoryRecord.category_type,
          confidence,
          bankCategoryId
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
