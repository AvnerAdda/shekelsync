import { getDB } from '../db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { transactionName, categoryDefinitionId, categoryType } = req.body;

  if (!transactionName || !categoryDefinitionId) {
    return res.status(400).json({ 
      error: 'Missing required fields: transactionName, categoryDefinitionId' 
    });
  }

  const client = await getDB();
  
  try {
    // Check if a rule with this exact pattern already exists
    const existingRule = await client.query(
      `SELECT id FROM categorization_rules 
       WHERE LOWER(name_pattern) = LOWER($1)`,
      [transactionName]
    );

    if (existingRule.rows.length > 0) {
      return res.status(409).json({ 
        error: 'A rule with this pattern already exists',
        ruleId: existingRule.rows[0].id
      });
    }

    // Get category details
    const categoryResult = await client.query(
      `SELECT cd.id, cd.name, cd.category_type, cd.parent_id, parent.name as parent_name
       FROM category_definitions cd
       LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
       WHERE cd.id = $1`,
      [categoryDefinitionId]
    );

    if (categoryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const category = categoryResult.rows[0];
    const targetCategory = category.name;

    // Build category path (e.g., "Food > Groceries" or just "Income")
    const categoryPath = category.parent_name
      ? `${category.parent_name} > ${category.name}`
      : category.name;

    // Create the rule
    const insertResult = await client.query(
      `INSERT INTO categorization_rules
       (name_pattern, target_category, category_path, category_definition_id, category_type, is_active, priority)
       VALUES ($1, $2, $3, $4, $5, true, 50)
       RETURNING id, name_pattern, target_category, category_path, category_definition_id, category_type, is_active, priority`,
      [
        transactionName,
        targetCategory,
        categoryPath,
        categoryDefinitionId,
        categoryType || category.category_type
      ]
    );

    const newRule = insertResult.rows[0];

    return res.status(201).json({
      success: true,
      rule: newRule,
      message: 'Rule created successfully'
    });
  } catch (error) {
    console.error('Error creating auto-assignment rule:', error);
    return res.status(500).json({ 
      error: 'Failed to create rule',
      details: error.message 
    });
  } finally {
    client.release();
  }
}

