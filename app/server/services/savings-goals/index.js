/**
 * Savings Goals Service
 * Manages user savings goals and tracks progress
 */

const database = require('../database.js');

/**
 * Get all savings goals for the user
 * @param {Object} params - Query parameters
 * @param {string} [params.status] - Filter by status (active, completed, paused, cancelled)
 * @param {boolean} [params.includeContributions] - Include contribution history
 * @returns {Promise<Object>} Goals list with progress info
 */
async function getSavingsGoals(params = {}) {
  const { status, includeContributions = false } = params;
  
  const conditions = [];
  const values = [];
  
  if (status) {
    values.push(status);
    conditions.push(`sg.status = $${values.length}`);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const result = await database.query(`
    SELECT
      sg.id,
      sg.name,
      sg.description,
      sg.target_amount,
      sg.current_amount,
      sg.currency,
      sg.target_date,
      sg.start_date,
      sg.category_definition_id,
      cd.name AS category_name,
      sg.icon,
      sg.color,
      sg.status,
      sg.priority,
      sg.is_recurring,
      sg.recurring_amount,
      sg.completed_at,
      sg.created_at,
      sg.updated_at,
      CASE 
        WHEN sg.target_amount > 0 THEN ROUND((sg.current_amount / sg.target_amount) * 100, 1)
        ELSE 0
      END AS progress_percent,
      CASE
        WHEN sg.target_date IS NOT NULL THEN 
          julianday(sg.target_date) - julianday('now')
        ELSE NULL
      END AS days_remaining
    FROM savings_goals sg
    LEFT JOIN category_definitions cd ON cd.id = sg.category_definition_id
    ${whereClause}
    ORDER BY sg.priority DESC, sg.created_at DESC
  `, values);
  
  const goals = result.rows || [];
  
  // Optionally include recent contributions
  if (includeContributions && goals.length > 0) {
    const goalIds = goals.map(g => g.id);
    const placeholders = goalIds.map((_, i) => `$${i + 1}`).join(',');
    
    const contributionsResult = await database.query(`
      SELECT
        sgc.id,
        sgc.goal_id,
        sgc.amount,
        sgc.contribution_type,
        sgc.note,
        sgc.date,
        sgc.transaction_identifier,
        sgc.transaction_vendor
      FROM savings_goal_contributions sgc
      WHERE sgc.goal_id IN (${placeholders})
      ORDER BY sgc.date DESC
      LIMIT 100
    `, goalIds);
    
    const contributionsByGoal = {};
    for (const contrib of (contributionsResult.rows || [])) {
      if (!contributionsByGoal[contrib.goal_id]) {
        contributionsByGoal[contrib.goal_id] = [];
      }
      contributionsByGoal[contrib.goal_id].push(contrib);
    }
    
    for (const goal of goals) {
      goal.contributions = contributionsByGoal[goal.id] || [];
    }
  }
  
  return {
    goals,
    count: goals.length,
    summary: {
      totalTargetAmount: goals.reduce((sum, g) => sum + (g.target_amount || 0), 0),
      totalCurrentAmount: goals.reduce((sum, g) => sum + (g.current_amount || 0), 0),
      activeGoals: goals.filter(g => g.status === 'active').length,
      completedGoals: goals.filter(g => g.status === 'completed').length,
    },
  };
}

/**
 * Get a single savings goal by ID
 * @param {number} goalId - The goal ID
 * @returns {Promise<Object|null>} The goal or null if not found
 */
async function getSavingsGoalById(goalId) {
  const result = await database.query(`
    SELECT
      sg.*,
      cd.name AS category_name,
      CASE 
        WHEN sg.target_amount > 0 THEN ROUND((sg.current_amount / sg.target_amount) * 100, 1)
        ELSE 0
      END AS progress_percent,
      CASE
        WHEN sg.target_date IS NOT NULL THEN 
          julianday(sg.target_date) - julianday('now')
        ELSE NULL
      END AS days_remaining
    FROM savings_goals sg
    LEFT JOIN category_definitions cd ON cd.id = sg.category_definition_id
    WHERE sg.id = $1
  `, [goalId]);
  
  const goal = result.rows?.[0];
  
  if (goal) {
    // Get contributions
    const contributionsResult = await database.query(`
      SELECT * FROM savings_goal_contributions
      WHERE goal_id = $1
      ORDER BY date DESC
    `, [goalId]);
    goal.contributions = contributionsResult.rows || [];
  }
  
  return goal || null;
}

/**
 * Create a new savings goal
 * @param {Object} goalData - The goal data
 * @returns {Promise<Object>} The created goal
 */
async function createSavingsGoal(goalData) {
  const {
    name,
    description,
    target_amount,
    target_date,
    category_definition_id,
    icon,
    color,
    priority,
    is_recurring,
    recurring_amount,
  } = goalData;
  
  if (!name || !target_amount || target_amount <= 0) {
    const error = new Error('Name and positive target amount are required');
    error.status = 400;
    throw error;
  }
  
  const result = await database.query(`
    INSERT INTO savings_goals (
      name,
      description,
      target_amount,
      target_date,
      category_definition_id,
      icon,
      color,
      priority,
      is_recurring,
      recurring_amount
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `, [
    name,
    description || null,
    target_amount,
    target_date || null,
    category_definition_id || null,
    icon || 'savings',
    color || '#4CAF50',
    priority || 0,
    is_recurring ? 1 : 0,
    recurring_amount || null,
  ]);
  
  return result.rows?.[0];
}

/**
 * Update an existing savings goal
 * @param {number} goalId - The goal ID
 * @param {Object} updates - The fields to update
 * @returns {Promise<Object>} The updated goal
 */
async function updateSavingsGoal(goalId, updates) {
  const allowedFields = [
    'name', 'description', 'target_amount', 'target_date',
    'category_definition_id', 'icon', 'color', 'status',
    'priority', 'is_recurring', 'recurring_amount'
  ];
  
  const setClauses = [];
  const values = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      values.push(value);
      setClauses.push(`${key} = $${values.length}`);
    }
  }
  
  if (setClauses.length === 0) {
    const error = new Error('No valid fields to update');
    error.status = 400;
    throw error;
  }
  
  values.push(goalId);
  setClauses.push('updated_at = datetime(\'now\')');
  
  // Handle status change to completed
  if (updates.status === 'completed') {
    setClauses.push('completed_at = datetime(\'now\')');
  } else if (updates.status && updates.status !== 'completed') {
    setClauses.push('completed_at = NULL');
  }
  
  const result = await database.query(`
    UPDATE savings_goals
    SET ${setClauses.join(', ')}
    WHERE id = $${values.length}
    RETURNING *
  `, values);
  
  if (!result.rows?.length) {
    const error = new Error('Goal not found');
    error.status = 404;
    throw error;
  }
  
  return result.rows[0];
}

/**
 * Delete a savings goal
 * @param {number} goalId - The goal ID
 * @returns {Promise<Object>} Success status
 */
async function deleteSavingsGoal(goalId) {
  const result = await database.query(`
    DELETE FROM savings_goals WHERE id = $1 RETURNING id
  `, [goalId]);
  
  if (!result.rows?.length) {
    const error = new Error('Goal not found');
    error.status = 404;
    throw error;
  }
  
  return { success: true, deletedId: goalId };
}

/**
 * Add a contribution to a savings goal
 * @param {number} goalId - The goal ID
 * @param {Object} contributionData - The contribution data
 * @returns {Promise<Object>} The created contribution and updated goal
 */
async function addContribution(goalId, contributionData) {
  const {
    amount,
    contribution_type,
    note,
    date,
    transaction_identifier,
    transaction_vendor,
  } = contributionData;
  
  if (!amount) {
    const error = new Error('Amount is required');
    error.status = 400;
    throw error;
  }
  
  // Verify goal exists
  const goalCheck = await database.query(
    'SELECT id, status FROM savings_goals WHERE id = $1',
    [goalId]
  );
  
  if (!goalCheck.rows?.length) {
    const error = new Error('Goal not found');
    error.status = 404;
    throw error;
  }
  
  const result = await database.query(`
    INSERT INTO savings_goal_contributions (
      goal_id,
      amount,
      contribution_type,
      note,
      date,
      transaction_identifier,
      transaction_vendor
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [
    goalId,
    amount,
    contribution_type || 'manual',
    note || null,
    date || new Date().toISOString().split('T')[0],
    transaction_identifier || null,
    transaction_vendor || null,
  ]);
  
  // Get updated goal
  const updatedGoal = await getSavingsGoalById(goalId);
  
  return {
    contribution: result.rows?.[0],
    goal: updatedGoal,
  };
}

/**
 * Delete a contribution
 * @param {number} contributionId - The contribution ID
 * @returns {Promise<Object>} Success status and updated goal
 */
async function deleteContribution(contributionId) {
  // Get the goal ID first
  const contribResult = await database.query(
    'SELECT goal_id FROM savings_goal_contributions WHERE id = $1',
    [contributionId]
  );
  
  if (!contribResult.rows?.length) {
    const error = new Error('Contribution not found');
    error.status = 404;
    throw error;
  }
  
  const goalId = contribResult.rows[0].goal_id;
  
  await database.query(
    'DELETE FROM savings_goal_contributions WHERE id = $1',
    [contributionId]
  );
  
  // Get updated goal
  const updatedGoal = await getSavingsGoalById(goalId);
  
  return {
    success: true,
    deletedId: contributionId,
    goal: updatedGoal,
  };
}

module.exports = {
  getSavingsGoals,
  getSavingsGoalById,
  createSavingsGoal,
  updateSavingsGoal,
  deleteSavingsGoal,
  addContribution,
  deleteContribution,
};

module.exports.default = module.exports;
