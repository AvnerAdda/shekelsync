const express = require('express');

const spendingCategoriesService = require('../services/analytics/spending-categories.js');

function handleServiceError(res, error, fallbackMessage) {
  const status = error?.status || error?.statusCode || 500;
  res.status(status).json({
    success: false,
    error: error?.message || fallbackMessage || 'Internal server error',
  });
}

function createSpendingCategoriesRouter() {
  const router = express.Router();

  /**
   * POST /api/spending-categories/initialize
   * Initialize spending category mappings for all categories
   */
  router.post('/initialize', async (req, res) => {
    try {
      const result = await spendingCategoriesService.initializeSpendingCategories();
      res.json(result);
    } catch (error) {
      console.error('Initialize spending categories error:', error);
      handleServiceError(res, error, 'Failed to initialize spending categories');
    }
  });

  /**
   * GET /api/spending-categories/mappings
   * Get all spending category mappings
   * Query params: spendingCategory, categoryDefinitionId
   */
  router.get('/mappings', async (req, res) => {
    try {
      const result = await spendingCategoriesService.getSpendingCategoryMappings(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Get spending category mappings error:', error);
      handleServiceError(res, error, 'Failed to fetch spending category mappings');
    }
  });

  /**
   * PUT /api/spending-categories/mapping/:categoryDefinitionId
   * Update spending category mapping for a specific category
   * Body: { spendingCategory, variabilityType, targetPercentage, notes }
   */
  router.put('/mapping/:categoryDefinitionId', async (req, res) => {
    try {
      const categoryDefinitionId = parseInt(req.params.categoryDefinitionId, 10);
      if (Number.isNaN(categoryDefinitionId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid category definition ID',
        });
      }

      const result = await spendingCategoriesService.updateSpendingCategoryMapping(
        categoryDefinitionId,
        req.body || {}
      );
      res.json(result);
    } catch (error) {
      console.error('Update spending category mapping error:', error);
      handleServiceError(res, error, 'Failed to update spending category mapping');
    }
  });

  /**
   * GET /api/spending-categories/breakdown
   * Get spending breakdown by spending category
   * Query params: startDate, endDate, months
   */
  router.get('/breakdown', async (req, res) => {
    try {
      const result = await spendingCategoriesService.getSpendingCategoryBreakdown(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Get spending category breakdown error:', error);
      handleServiceError(res, error, 'Failed to fetch spending category breakdown');
    }
  });

  /**
   * PUT /api/spending-categories/targets
   * Update spending category allocation targets
   * Body: { growth: 20, stability: 10, essential: 50, reward: 15, other: 5 }
   */
  router.put('/targets', async (req, res) => {
    try {
      const result = await spendingCategoriesService.updateSpendingCategoryTargets(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Update spending category targets error:', error);
      handleServiceError(res, error, 'Failed to update spending category targets');
    }
  });

  return router;
}

module.exports = createSpendingCategoriesRouter;
