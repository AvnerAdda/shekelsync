const express = require('express');

const budgetIntelligenceService = require('../services/analytics/budget-intelligence.js');

function handleServiceError(res, error, fallbackMessage) {
  const status = error?.status || error?.statusCode || 500;
  res.status(status).json({
    success: false,
    error: error?.message || fallbackMessage || 'Internal server error',
  });
}

function createBudgetIntelligenceRouter() {
  const router = express.Router();

  /**
   * POST /api/budget-intelligence/generate
   * Generate budget suggestions for all expense categories
   * Query params: months (default: 6), periodType (default: 'monthly')
   */
  router.post('/generate', async (req, res) => {
    try {
      const result = await budgetIntelligenceService.generateBudgetSuggestions(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Generate budget suggestions error:', error);
      handleServiceError(res, error, 'Failed to generate budget suggestions');
    }
  });

  /**
   * GET /api/budget-intelligence/suggestions
   * Get budget suggestions
   * Query params: minConfidence (default: 0.5), periodType (default: 'monthly'), includeActive (default: true)
   */
  router.get('/suggestions', async (req, res) => {
    try {
      const result = await budgetIntelligenceService.getBudgetSuggestions(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Get budget suggestions error:', error);
      handleServiceError(res, error, 'Failed to fetch budget suggestions');
    }
  });

  /**
   * POST /api/budget-intelligence/suggestions/:id/activate
   * Activate a budget suggestion (creates or updates budget)
   */
  router.post('/suggestions/:id/activate', async (req, res) => {
    try {
      const suggestionId = parseInt(req.params.id, 10);
      if (Number.isNaN(suggestionId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid suggestion ID',
        });
      }

      const result = await budgetIntelligenceService.activateBudgetSuggestion(suggestionId);
      res.json(result);
    } catch (error) {
      console.error('Activate budget suggestion error:', error);
      handleServiceError(res, error, 'Failed to activate budget suggestion');
    }
  });

  /**
   * GET /api/budget-intelligence/trajectory
   * Get budget trajectory for a specific budget
   * Query params: budgetId OR categoryDefinitionId
   */
  router.get('/trajectory', async (req, res) => {
    try {
      const result = await budgetIntelligenceService.getBudgetTrajectory(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Get budget trajectory error:', error);
      handleServiceError(res, error, 'Failed to fetch budget trajectory');
    }
  });

  /**
   * GET /api/budget-intelligence/health
   * Get budget health summary for all active budgets
   */
  router.get('/health', async (req, res) => {
    try {
      const result = await budgetIntelligenceService.getBudgetHealth();
      res.json(result);
    } catch (error) {
      console.error('Get budget health error:', error);
      handleServiceError(res, error, 'Failed to fetch budget health');
    }
  });

  return router;
}

module.exports = createBudgetIntelligenceRouter;
