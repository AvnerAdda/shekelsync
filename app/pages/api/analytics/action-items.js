import pool from '../db';

/**
 * Action Items Management API
 * CRUD operations for user action items tracking
 * Manages progress, savings, and completion status
 */
export default async function handler(req, res) {
  const { method } = req;

  try {
    switch (method) {
      case 'GET':
        return await getActionItems(req, res);
      case 'POST':
        return await createActionItem(req, res);
      case 'PUT':
        return await updateActionItem(req, res);
      case 'DELETE':
        return await deleteActionItem(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in action items API:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}

/**
 * GET - Retrieve action items with optional filtering
 */
async function getActionItems(req, res) {
  const { status, priority, includeProgress = 'true' } = req.query;

  try {
    let query = `
      SELECT 
        ai.*,
        CASE 
          WHEN ai.status = 'completed' THEN 100
          ELSE COALESCE(ai.current_progress, 0)
        END as progress_percentage
      FROM user_action_items ai
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      query += ` AND ai.status = $${paramCount}`;
      params.push(status);
    }

    if (priority) {
      paramCount++;
      query += ` AND ai.priority = $${paramCount}`;
      params.push(priority);
    }

    query += ` ORDER BY 
      CASE ai.priority 
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      ai.created_at DESC
    `;

    const result = await pool.query(query, params);
    const items = result.rows;

    // Get progress history if requested
    if (includeProgress === 'true' && items.length > 0) {
      const itemIds = items.map(item => item.id);
      const progressQuery = `
        SELECT * FROM action_item_progress
        WHERE action_item_id = ANY($1)
        ORDER BY month DESC
      `;
      const progressResult = await pool.query(progressQuery, [itemIds]);

      // Attach progress to items
      items.forEach(item => {
        item.progress_history = progressResult.rows.filter(
          p => p.action_item_id === item.id
        );
      });
    }

    // Calculate summary statistics
    const summary = {
      total: items.length,
      pending: items.filter(i => i.status === 'pending').length,
      in_progress: items.filter(i => i.status === 'in_progress').length,
      completed: items.filter(i => i.status === 'completed').length,
      total_potential_savings: items.reduce((sum, i) => sum + parseFloat(i.potential_savings || 0), 0),
      total_achieved_savings: items
        .filter(i => i.status === 'completed')
        .reduce((sum, i) => sum + parseFloat(i.potential_savings || 0), 0),
      avg_progress: items.length > 0
        ? items.reduce((sum, i) => sum + parseFloat(i.progress_percentage || 0), 0) / items.length
        : 0
    };

    return res.status(200).json({
      items,
      summary
    });
  } catch (error) {
    console.error('Error fetching action items:', error);
    return res.status(500).json({ error: 'Failed to fetch action items', details: error.message });
  }
}

/**
 * POST - Create new action item
 */
async function createActionItem(req, res) {
  const {
    action_type,
    title,
    description,
    potential_savings,
    category_name,
    target_amount,
    priority = 'medium',
    metadata = {}
  } = req.body;

  if (!action_type || !title) {
    return res.status(400).json({ error: 'action_type and title are required' });
  }

  try {
    const query = `
      INSERT INTO user_action_items (
        action_type,
        title,
        description,
        potential_savings,
        category_name,
        target_amount,
        priority,
        status,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
      RETURNING *
    `;

    const values = [
      action_type,
      title,
      description,
      potential_savings,
      category_name,
      target_amount,
      priority,
      JSON.stringify(metadata)
    ];

    const result = await pool.query(query, values);

    return res.status(201).json({
      message: 'Action item created successfully',
      item: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating action item:', error);
    return res.status(500).json({ error: 'Failed to create action item', details: error.message });
  }
}

/**
 * PUT - Update action item
 */
async function updateActionItem(req, res) {
  const { id } = req.query;
  const {
    status,
    current_progress,
    actual_amount,
    achieved_savings,
    notes
  } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Action item ID is required' });
  }

  try {
    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 0;

    if (status !== undefined) {
      paramCount++;
      updates.push(`status = $${paramCount}`);
      values.push(status);

      // Set completion/dismissal timestamps
      if (status === 'completed') {
        paramCount++;
        updates.push(`completed_at = $${paramCount}`);
        values.push(new Date());
      } else if (status === 'dismissed') {
        paramCount++;
        updates.push(`dismissed_at = $${paramCount}`);
        values.push(new Date());
      }
    }

    if (current_progress !== undefined) {
      paramCount++;
      updates.push(`current_progress = $${paramCount}`);
      values.push(current_progress);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    paramCount++;
    values.push(id);

    const query = `
      UPDATE user_action_items
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Action item not found' });
    }

    // Record progress if provided
    if (actual_amount !== undefined || achieved_savings !== undefined) {
      const progressQuery = `
        INSERT INTO action_item_progress (
          action_item_id,
          month,
          actual_amount,
          target_amount,
          achieved_savings,
          progress_percentage
        ) VALUES ($1, DATE_TRUNC('month', CURRENT_DATE), $2, $3, $4, $5)
      `;

      const item = result.rows[0];
      await pool.query(progressQuery, [
        id,
        actual_amount,
        item.target_amount,
        achieved_savings,
        current_progress
      ]);
    }

    return res.status(200).json({
      message: 'Action item updated successfully',
      item: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating action item:', error);
    return res.status(500).json({ error: 'Failed to update action item', details: error.message });
  }
}

/**
 * DELETE - Delete action item
 */
async function deleteActionItem(req, res) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Action item ID is required' });
  }

  try {
    const query = 'DELETE FROM user_action_items WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Action item not found' });
    }

    return res.status(200).json({
      message: 'Action item deleted successfully',
      id: result.rows[0].id
    });
  } catch (error) {
    console.error('Error deleting action item:', error);
    return res.status(500).json({ error: 'Failed to delete action item', details: error.message });
  }
}
