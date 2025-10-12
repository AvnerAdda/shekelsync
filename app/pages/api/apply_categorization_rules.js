import { createApiHandler } from "./utils/apiHandler";
import { getDB } from "./db";

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
        SELECT id, name_pattern, target_category, category_definition_id
        FROM categorization_rules
        WHERE is_active = true
        ORDER BY priority DESC, id
      `);

      const rules = rulesResult.rows;
      let totalUpdated = 0;

      // Apply each rule
      for (const rule of rules) {
        const pattern = `%${rule.name_pattern}%`;

        // Update using category_definition_id if available, otherwise use legacy category field
        if (rule.category_definition_id) {
          // Build price condition based on category type
          let priceCondition = '';
          if (rule.category_type === 'income') {
            priceCondition = 'AND price > 0';
          } else if (rule.category_type === 'expense') {
            priceCondition = 'AND price < 0';
          }
          // If category_type is null, apply to all transactions (backward compatibility)

          const updateResult = await client.query(`
            UPDATE transactions
            SET category_definition_id = $2,
                category = $3,
                parent_category = (
                  SELECT parent_cd.name
                  FROM category_definitions cd
                  LEFT JOIN category_definitions parent_cd ON cd.parent_id = parent_cd.id
                  WHERE cd.id = $2
                )
            WHERE LOWER(name) LIKE LOWER($1)
            ${priceCondition}
            AND (category_definition_id IS NULL OR category_definition_id != $2)
          `, [pattern, rule.category_definition_id, rule.target_category]);

          totalUpdated += updateResult.rowCount;
        } else {
          // Legacy support for old rules without category_definition_id
          const updateResult = await client.query(`
            UPDATE transactions
            SET category = $2
            WHERE LOWER(name) LIKE LOWER($1)
            AND category != $2
            AND category IS NOT NULL
            AND category != 'Bank'
            AND category != 'Income'
          `, [pattern, rule.target_category]);

          totalUpdated += updateResult.rowCount;
        }
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