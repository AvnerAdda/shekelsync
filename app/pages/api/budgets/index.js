import { getDB } from '../db.js';

export default async function handler(req, res) {
  const client = await getDB();

  try {
    if (req.method === 'GET') {
      const result = await client.query(
        `SELECT
           cb.id,
           cb.category_definition_id,
           cb.period_type,
           cb.budget_limit,
           cb.is_active,
           cb.created_at,
           cb.updated_at,
           cd.name AS category_name,
           cd.name_en AS category_name_en,
           cd.category_type,
           parent.name AS parent_category_name,
           parent.name_en AS parent_category_name_en
         FROM category_budgets cb
         JOIN category_definitions cd ON cd.id = cb.category_definition_id
         LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
         WHERE cb.is_active = true
         ORDER BY cd.category_type, parent.name, cd.name, cb.period_type`
      );
      res.status(200).json(result.rows);
    } else if (req.method === 'POST') {
      const { category_definition_id, period_type, budget_limit } = req.body;

      if (!category_definition_id || !period_type || budget_limit === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      if (!['weekly', 'monthly', 'yearly'].includes(period_type)) {
        return res.status(400).json({ error: 'Invalid period_type' });
      }

      const categoryId = parseInt(category_definition_id, 10);
      if (Number.isNaN(categoryId)) {
        return res.status(400).json({ error: 'Invalid category selected' });
      }

      const categoryCheck = await client.query(
        `SELECT id, category_type FROM category_definitions WHERE id = $1`,
        [categoryId]
      );

      if (categoryCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Category not found' });
      }

      const categoryType = categoryCheck.rows[0].category_type;
      if (categoryType !== 'expense') {
        return res.status(400).json({ error: 'Budgets can only be created for expense categories' });
      }

      const limit = parseFloat(budget_limit);
      if (Number.isNaN(limit) || limit <= 0) {
        return res.status(400).json({ error: 'Budget limit must be greater than zero' });
      }

      const result = await client.query(
        `INSERT INTO category_budgets (category_definition_id, period_type, budget_limit)
         VALUES ($1, $2, $3)
         ON CONFLICT (category_definition_id, period_type)
         DO UPDATE SET budget_limit = $3, updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [categoryId, period_type, limit]
      );

      const inserted = await client.query(
        `SELECT
           cb.id,
           cb.category_definition_id,
           cb.period_type,
           cb.budget_limit,
           cb.is_active,
           cb.created_at,
           cb.updated_at,
           cd.name AS category_name,
           cd.name_en AS category_name_en,
           cd.category_type,
           parent.name AS parent_category_name,
           parent.name_en AS parent_category_name_en
         FROM category_budgets cb
         JOIN category_definitions cd ON cd.id = cb.category_definition_id
         LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
         WHERE cb.id = $1`,
        [result.rows[0].id]
      );

      res.status(201).json(inserted.rows[0]);
    } else if (req.method === 'PUT') {
      const { id, budget_limit, is_active } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'Missing budget ID' });
      }

      const updates = [];
      const params = [];
      let paramCount = 1;

      if (budget_limit !== undefined) {
        const limitValue = parseFloat(budget_limit);
        if (Number.isNaN(limitValue) || limitValue <= 0) {
          return res.status(400).json({ error: 'Budget limit must be greater than zero' });
        }
        updates.push(`budget_limit = $${paramCount++}`);
        params.push(limitValue);
      }

      if (is_active !== undefined) {
        updates.push(`is_active = $${paramCount++}`);
        params.push(is_active);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      params.push(id);

      const result = await client.query(
        `UPDATE category_budgets SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id`,
        params
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Budget not found' });
      }

      const updated = await client.query(
        `SELECT
           cb.id,
           cb.category_definition_id,
           cb.period_type,
           cb.budget_limit,
           cb.is_active,
           cb.created_at,
           cb.updated_at,
           cd.name AS category_name,
           cd.name_en AS category_name_en,
           cd.category_type,
           parent.name AS parent_category_name,
           parent.name_en AS parent_category_name_en
         FROM category_budgets cb
         JOIN category_definitions cd ON cd.id = cb.category_definition_id
         LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
         WHERE cb.id = $1`,
        [result.rows[0].id]
      );

      res.status(200).json(updated.rows[0]);
    } else if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'Missing budget ID' });
      }

      await client.query(
        'UPDATE category_budgets SET is_active = false WHERE id = $1',
        [id]
      );

      res.status(200).json({ success: true });
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in budgets API:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
}
