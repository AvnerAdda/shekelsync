import { getDB } from './db.js';

export default async function handler(req, res) {
  const client = await getDB();

  try {
    if (req.method === 'GET') {
      // Get all merchant patterns or search by pattern
      const { pattern, category, active_only } = req.query;

      let sql = `
        SELECT * FROM merchant_catalog
        WHERE 1=1
      `;
      const params = [];

      if (pattern) {
        params.push(`%${pattern}%`);
        sql += ` AND merchant_pattern ILIKE $${params.length}`;
      }

      if (category) {
        params.push(category);
        sql += ` AND parent_category = $${params.length}`;
      }

      if (active_only === 'true') {
        sql += ` AND is_active = true`;
      }

      sql += ` ORDER BY parent_category, subcategory, confidence DESC`;

      const result = await client.query(sql, params);

      return res.status(200).json(result.rows);

    } else if (req.method === 'POST') {
      // Create new merchant pattern
      const { merchant_pattern, parent_category, subcategory, mcc_code, confidence } = req.body;

      if (!merchant_pattern || !parent_category) {
        return res.status(400).json({ error: 'merchant_pattern and parent_category are required' });
      }

      const result = await client.query(
        `INSERT INTO merchant_catalog
         (merchant_pattern, parent_category, subcategory, mcc_code, confidence, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (merchant_pattern, parent_category, subcategory)
         DO UPDATE SET
           mcc_code = EXCLUDED.mcc_code,
           confidence = EXCLUDED.confidence,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [
          merchant_pattern.toLowerCase(),
          parent_category,
          subcategory || null,
          mcc_code || null,
          confidence || 1.0
        ]
      );

      return res.status(201).json(result.rows[0]);

    } else if (req.method === 'PUT') {
      // Update existing merchant pattern
      const { id, merchant_pattern, parent_category, subcategory, mcc_code, confidence, is_active } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      const updates = [];
      const params = [id];
      let paramIndex = 2;

      if (merchant_pattern !== undefined) {
        updates.push(`merchant_pattern = $${paramIndex++}`);
        params.push(merchant_pattern.toLowerCase());
      }
      if (parent_category !== undefined) {
        updates.push(`parent_category = $${paramIndex++}`);
        params.push(parent_category);
      }
      if (subcategory !== undefined) {
        updates.push(`subcategory = $${paramIndex++}`);
        params.push(subcategory);
      }
      if (mcc_code !== undefined) {
        updates.push(`mcc_code = $${paramIndex++}`);
        params.push(mcc_code);
      }
      if (confidence !== undefined) {
        updates.push(`confidence = $${paramIndex++}`);
        params.push(confidence);
      }
      if (is_active !== undefined) {
        updates.push(`is_active = $${paramIndex++}`);
        params.push(is_active);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      updates.push('updated_at = CURRENT_TIMESTAMP');

      const result = await client.query(
        `UPDATE merchant_catalog
         SET ${updates.join(', ')}
         WHERE id = $1
         RETURNING *`,
        params
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Merchant pattern not found' });
      }

      return res.status(200).json(result.rows[0]);

    } else if (req.method === 'DELETE') {
      // Delete merchant pattern
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      const result = await client.query(
        'DELETE FROM merchant_catalog WHERE id = $1 RETURNING *',
        [id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Merchant pattern not found' });
      }

      return res.status(200).json({ message: 'Merchant pattern deleted successfully', deleted: result.rows[0] });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in merchant_catalog API:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  } finally {
    client.release();
  }
}
