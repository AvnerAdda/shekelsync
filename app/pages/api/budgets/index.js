import { getDB } from '../db.js';

export default async function handler(req, res) {
  const client = await getDB();

  try {
    if (req.method === 'GET') {
      const result = await client.query(
        'SELECT * FROM category_budgets WHERE is_active = true ORDER BY category, period_type'
      );
      res.status(200).json(result.rows);
    } else if (req.method === 'POST') {
      const { category, period_type, budget_limit } = req.body;

      if (!category || !period_type || !budget_limit) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      if (!['weekly', 'monthly', 'yearly'].includes(period_type)) {
        return res.status(400).json({ error: 'Invalid period_type' });
      }

      const result = await client.query(
        `INSERT INTO category_budgets (category, period_type, budget_limit)
         VALUES ($1, $2, $3)
         ON CONFLICT (category, period_type)
         DO UPDATE SET budget_limit = $3, updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [category, period_type, budget_limit]
      );

      res.status(201).json(result.rows[0]);
    } else if (req.method === 'PUT') {
      const { id, budget_limit, is_active } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'Missing budget ID' });
      }

      const updates = [];
      const params = [];
      let paramCount = 1;

      if (budget_limit !== undefined) {
        updates.push(`budget_limit = $${paramCount++}`);
        params.push(budget_limit);
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
        `UPDATE category_budgets SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
        params
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Budget not found' });
      }

      res.status(200).json(result.rows[0]);
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
