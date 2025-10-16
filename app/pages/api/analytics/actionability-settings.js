import { getDB } from '../db.js';

/**
 * Category Actionability Settings API
 * Manage user-defined actionability levels for categories
 * 
 * GET    /api/analytics/actionability-settings - Get all settings
 * POST   /api/analytics/actionability-settings - Bulk update settings
 * PUT    /api/analytics/actionability-settings - Update single setting
 * DELETE /api/analytics/actionability-settings - Reset to defaults
 */
export default async function handler(req, res) {
  const client = await getDB();

  try {
    if (req.method === 'GET') {
      return await handleGet(client, req, res);
    } else if (req.method === 'POST') {
      return await handleBulkUpdate(client, req, res);
    } else if (req.method === 'PUT') {
      return await handleUpdate(client, req, res);
    } else if (req.method === 'DELETE') {
      return await handleReset(client, req, res);
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in actionability settings API:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  } finally {
    client.release();
  }
}

/**
 * GET - Retrieve all actionability settings
 */
async function handleGet(client, req, res) {
  const result = await client.query(`
    SELECT
      cas.id,
      cas.category_definition_id,
      cas.parent_category,
      cas.subcategory,
      cas.actionability_level,
      cas.monthly_average,
      cas.transaction_count,
      cas.is_default,
      cas.user_notes,
      cas.created_at,
      cas.updated_at
    FROM category_actionability_settings cas
    ORDER BY cas.monthly_average DESC
  `);

  return res.status(200).json(result.rows);
}

/**
 * POST - Bulk update actionability settings (from modal save)
 */
async function handleBulkUpdate(client, req, res) {
  const { settings } = req.body;

  if (!settings || !Array.isArray(settings)) {
    return res.status(400).json({ error: 'Settings array required' });
  }

  try {
    await client.query('BEGIN');

    const results = [];

    for (const setting of settings) {
      const {
        category_definition_id,
        parent_category,
        subcategory,
        actionability_level,
        monthly_average,
        transaction_count,
        user_notes
      } = setting;

      if (!category_definition_id || !actionability_level) {
        continue; // Skip invalid entries
      }

      if (!['low', 'medium', 'high'].includes(actionability_level)) {
        continue; // Skip invalid actionability levels
      }

      const result = await client.query(`
        INSERT INTO category_actionability_settings (
          category_definition_id,
          parent_category,
          subcategory,
          actionability_level,
          monthly_average,
          transaction_count,
          is_default,
          user_notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, false, $7)
        ON CONFLICT (category_definition_id)
        DO UPDATE SET
          actionability_level = $4,
          monthly_average = $5,
          transaction_count = $6,
          is_default = false,
          user_notes = $7,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [
        category_definition_id,
        parent_category,
        subcategory,
        actionability_level,
        monthly_average || 0,
        transaction_count || 0,
        user_notes || null
      ]);

      results.push(result.rows[0]);
    }

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      updated: results.length,
      settings: results
    });

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * PUT - Update single actionability setting
 */
async function handleUpdate(client, req, res) {
  const { id, actionability_level, user_notes } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Setting ID required' });
  }

  if (actionability_level && !['low', 'medium', 'high'].includes(actionability_level)) {
    return res.status(400).json({ error: 'Invalid actionability level' });
  }

  const updates = [];
  const params = [];
  let paramCount = 1;

  if (actionability_level) {
    updates.push(`actionability_level = $${paramCount++}`);
    params.push(actionability_level);
    updates.push(`is_default = false`);
  }

  if (user_notes !== undefined) {
    updates.push(`user_notes = $${paramCount++}`);
    params.push(user_notes);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  params.push(id);

  const result = await client.query(`
    UPDATE category_actionability_settings
    SET ${updates.join(', ')}
    WHERE id = $${paramCount}
    RETURNING *
  `, params);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Setting not found' });
  }

  return res.status(200).json(result.rows[0]);
}

/**
 * DELETE - Reset all settings to defaults
 */
async function handleReset(client, req, res) {
  await client.query('DELETE FROM category_actionability_settings');

  return res.status(200).json({
    success: true,
    message: 'All actionability settings reset to defaults'
  });
}
