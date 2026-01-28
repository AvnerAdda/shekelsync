/**
 * Savings Goals API Routes
 */

const savingsGoalsService = require('../services/savings-goals/index.js');

/**
 * GET /api/savings-goals
 * Get all savings goals
 */
async function getSavingsGoals(req, res) {
  try {
    const { status, includeContributions } = req.query;
    const result = await savingsGoalsService.getSavingsGoals({
      status,
      includeContributions: includeContributions === 'true',
    });
    res.json(result);
  } catch (error) {
    console.error('Get savings goals error:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Failed to get savings goals',
    });
  }
}

/**
 * GET /api/savings-goals/:id
 * Get a single savings goal by ID
 */
async function getSavingsGoalById(req, res) {
  try {
    const goalId = parseInt(req.params.id, 10);
    if (isNaN(goalId)) {
      return res.status(400).json({ error: 'Invalid goal ID' });
    }
    
    const goal = await savingsGoalsService.getSavingsGoalById(goalId);
    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    
    res.json(goal);
  } catch (error) {
    console.error('Get savings goal error:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Failed to get savings goal',
    });
  }
}

/**
 * POST /api/savings-goals
 * Create a new savings goal
 */
async function createSavingsGoal(req, res) {
  try {
    const goal = await savingsGoalsService.createSavingsGoal(req.body);
    res.status(201).json(goal);
  } catch (error) {
    console.error('Create savings goal error:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Failed to create savings goal',
    });
  }
}

/**
 * PATCH /api/savings-goals/:id
 * Update a savings goal
 */
async function updateSavingsGoal(req, res) {
  try {
    const goalId = parseInt(req.params.id, 10);
    if (isNaN(goalId)) {
      return res.status(400).json({ error: 'Invalid goal ID' });
    }
    
    const goal = await savingsGoalsService.updateSavingsGoal(goalId, req.body);
    res.json(goal);
  } catch (error) {
    console.error('Update savings goal error:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Failed to update savings goal',
    });
  }
}

/**
 * DELETE /api/savings-goals/:id
 * Delete a savings goal
 */
async function deleteSavingsGoal(req, res) {
  try {
    const goalId = parseInt(req.params.id, 10);
    if (isNaN(goalId)) {
      return res.status(400).json({ error: 'Invalid goal ID' });
    }
    
    const result = await savingsGoalsService.deleteSavingsGoal(goalId);
    res.json(result);
  } catch (error) {
    console.error('Delete savings goal error:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Failed to delete savings goal',
    });
  }
}

/**
 * POST /api/savings-goals/:id/contributions
 * Add a contribution to a savings goal
 */
async function addContribution(req, res) {
  try {
    const goalId = parseInt(req.params.id, 10);
    if (isNaN(goalId)) {
      return res.status(400).json({ error: 'Invalid goal ID' });
    }
    
    const result = await savingsGoalsService.addContribution(goalId, req.body);
    res.status(201).json(result);
  } catch (error) {
    console.error('Add contribution error:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Failed to add contribution',
    });
  }
}

/**
 * DELETE /api/savings-goals/contributions/:id
 * Delete a contribution
 */
async function deleteContribution(req, res) {
  try {
    const contributionId = parseInt(req.params.id, 10);
    if (isNaN(contributionId)) {
      return res.status(400).json({ error: 'Invalid contribution ID' });
    }
    
    const result = await savingsGoalsService.deleteContribution(contributionId);
    res.json(result);
  } catch (error) {
    console.error('Delete contribution error:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Failed to delete contribution',
    });
  }
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
