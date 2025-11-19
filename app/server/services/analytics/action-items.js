const database = require('../database.js');
const { getInstitutionById, getInstitutionByVendorCode } = require('../institutions.js');

async function getActionItems(params = {}) {
  const { status, priority, includeProgress = 'true' } = params;

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

  const values = [];
  let paramCount = 0;

  if (status) {
    paramCount += 1;
    query += ` AND ai.status = $${paramCount}`;
    values.push(status);
  }

  if (priority) {
    paramCount += 1;
    query += ` AND ai.priority = $${paramCount}`;
    values.push(priority);
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

  const result = await database.query(query, values);
  const items = result.rows;

  for (const item of items) {
    if (item.metadata && typeof item.metadata === 'string') {
      try {
        item.metadata = JSON.parse(item.metadata);
      } catch {
        item.metadata = null;
      }
    }
    if (item.metadata && typeof item.metadata === 'object') {
      if (item.metadata.institution_id && !item.metadata.institution) {
        item.metadata.institution = await getInstitutionById(database, item.metadata.institution_id);
      } else if (item.metadata.vendor && !item.metadata.institution) {
        item.metadata.institution = await getInstitutionByVendorCode(database, item.metadata.vendor);
      }

      if (!item.metadata.institution && (item.metadata.institution_id || item.metadata.vendor)) {
        console.warn('[ActionItems] Missing institution metadata', {
          id: item.id,
          vendor: item.metadata.vendor,
          institution_id: item.metadata.institution_id,
        });
      }
    }
  }

  if (includeProgress === 'true' && items.length > 0) {
    const itemIds = items.map((item) => item.id);
    const placeholders = itemIds.map((_, idx) => `$${idx + 1}`).join(', ');
    const progressQuery = `
        SELECT * FROM action_item_progress
        WHERE action_item_id IN (${placeholders})
        ORDER BY month DESC
      `;
    const progressResult = await database.query(progressQuery, itemIds);

    items.forEach((item) => {
      item.progress_history = progressResult.rows.filter((p) => p.action_item_id === item.id);
    });
  }

  const summary = {
    total: items.length,
    pending: items.filter((i) => i.status === 'pending').length,
    in_progress: items.filter((i) => i.status === 'in_progress').length,
    completed: items.filter((i) => i.status === 'completed').length,
    total_potential_savings: items.reduce(
      (sum, i) => sum + Number.parseFloat(i.potential_savings || 0),
      0,
    ),
    total_achieved_savings: items
      .filter((i) => i.status === 'completed')
      .reduce((sum, i) => sum + Number.parseFloat(i.potential_savings || 0), 0),
    avg_progress:
      items.length > 0
        ? items.reduce((sum, i) => sum + Number.parseFloat(i.progress_percentage || 0), 0) /
          items.length
        : 0,
  };

  return { items, summary };
}

async function createActionItem(payload = {}) {
  const {
    action_type,
    title,
    description,
    potential_savings,
    category_name,
    target_amount,
    priority = 'medium',
    metadata = {},
  } = payload;

  if (!action_type || !title) {
    const error = new Error('action_type and title are required');
    error.statusCode = 400;
    throw error;
  }

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
    JSON.stringify(metadata),
  ];

  const result = await database.query(query, values);

  return {
    message: 'Action item created successfully',
    item: result.rows[0],
  };
}

async function updateActionItem(params = {}, payload = {}) {
  const { id } = params;
  const { status, current_progress, actual_amount, achieved_savings } = payload;

  if (!id) {
    const error = new Error('Action item ID is required');
    error.statusCode = 400;
    throw error;
  }

  const updates = [];
  const values = [];
  let paramCount = 0;

  if (status !== undefined) {
    paramCount += 1;
    updates.push(`status = $${paramCount}`);
    values.push(status);

    if (status === 'completed') {
      paramCount += 1;
      updates.push(`completed_at = $${paramCount}`);
      values.push(new Date());
    } else if (status === 'dismissed') {
      paramCount += 1;
      updates.push(`dismissed_at = $${paramCount}`);
      values.push(new Date());
    }
  }

  if (current_progress !== undefined) {
    paramCount += 1;
    updates.push(`current_progress = $${paramCount}`);
    values.push(current_progress);
  }

  if (updates.length === 0) {
    const error = new Error('No fields to update');
    error.statusCode = 400;
    throw error;
  }

  paramCount += 1;
  values.push(id);

  const updateQuery = `
      UPDATE user_action_items
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

  const result = await database.query(updateQuery, values);

  if (result.rows.length === 0) {
    const error = new Error('Action item not found');
    error.statusCode = 404;
    throw error;
  }

  const item = result.rows[0];

  if (actual_amount !== undefined || achieved_savings !== undefined) {
    const progressQuery = `
        INSERT INTO action_item_progress (
          action_item_id,
          month,
          actual_amount,
          target_amount,
          achieved_savings,
          progress_percentage
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `;
    const currentMonth = new Date();
    currentMonth.setDate(1);
    const monthValue = currentMonth.toISOString().split('T')[0];

    await database.query(progressQuery, [
      id,
      monthValue,
      actual_amount,
      item.target_amount,
      achieved_savings,
      current_progress,
    ]);
  }

  return {
    message: 'Action item updated successfully',
    item,
  };
}

async function deleteActionItem(params = {}) {
  const { id } = params;

  if (!id) {
    const error = new Error('Action item ID is required');
    error.statusCode = 400;
    throw error;
  }

  const query = 'DELETE FROM user_action_items WHERE id = $1 RETURNING id';
  const result = await database.query(query, [id]);

  if (result.rows.length === 0) {
    const error = new Error('Action item not found');
    error.statusCode = 404;
    throw error;
  }

  return {
    message: 'Action item deleted successfully',
    id: result.rows[0].id,
  };
}

module.exports = {
  getActionItems,
  createActionItem,
  updateActionItem,
  deleteActionItem,
};
module.exports.default = module.exports;
