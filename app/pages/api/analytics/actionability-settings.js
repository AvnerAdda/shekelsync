import { getDB } from '../db.js';
import { getCategoryInfo } from '../../../lib/category-helpers.js';

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
        cas.actionability_level,
        cas.monthly_average,
        cas.transaction_count,
        cas.is_default,
        cas.user_notes,
        cas.created_at,
        cas.updated_at,
        cd.name AS subcategory,
        cd.name_en AS subcategory_en,
        parent.name AS parent_category,
        parent.name_en AS parent_category_en
      FROM category_actionability_settings cas
      JOIN category_definitions cd ON cd.id = cas.category_definition_id
      LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
      ORDER BY cas.monthly_average DESC, cd.display_order
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
          actionability_level,
          monthly_average,
          transaction_count,
          is_default,
          user_notes
        )
        VALUES ($1, $2, $3, $4, false, $5)
        ON CONFLICT (category_definition_id)
        DO UPDATE SET
          actionability_level = EXCLUDED.actionability_level,
          monthly_average = EXCLUDED.monthly_average,
          transaction_count = EXCLUDED.transaction_count,
          is_default = false,
          user_notes = EXCLUDED.user_notes,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [
        category_definition_id,
        actionability_level,
        monthly_average || 0,
        transaction_count || 0,
        user_notes || null
      ]);

      const persisted = result.rows[0];
      const categoryInfo = await getCategoryInfo(persisted.category_definition_id, client);
      results.push({
        ...persisted,
        subcategory: categoryInfo?.name || null,
        subcategory_en: categoryInfo?.name_en || null,
        parent_category: categoryInfo?.parent_name || null,
        parent_category_en: categoryInfo?.parent_name_en || null
      });
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

  const enriched = await getCategoryInfo(result.rows[0].category_definition_id, client);

  return res.status(200).json({
    ...result.rows[0],
    subcategory: enriched?.name || null,
    subcategory_en: enriched?.name_en || null,
    parent_category: enriched?.parent_name || null,
    parent_category_en: enriched?.parent_name_en || null
  });
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
