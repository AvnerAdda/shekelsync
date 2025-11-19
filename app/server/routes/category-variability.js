const express = require('express');

const categoryVariabilityService = require('../services/analytics/category-variability.js');

function handleServiceError(res, error, fallbackMessage) {
  const status = error?.status || error?.statusCode || 500;
  res.status(status).json({
    success: false,
    error: error?.message || fallbackMessage || 'Internal server error',
  });
}

function createCategoryVariabilityRouter() {
  const router = express.Router();

  /**
   * GET /api/category-variability
   * Analyze variability for all expense categories
   * Query params: months (default: 6)
   */
  router.get('/', async (req, res) => {
    try {
      const result = await categoryVariabilityService.analyzeCategoryVariability(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Analyze category variability error:', error);
      handleServiceError(res, error, 'Failed to analyze category variability');
    }
  });

  /**
   * PUT /api/category-variability/:categoryDefinitionId
   * Update variability type for a specific category
   * Body: { variabilityType: 'fixed' | 'variable' | 'seasonal' }
   */
  router.put('/:categoryDefinitionId', async (req, res) => {
    try {
      const categoryDefinitionId = parseInt(req.params.categoryDefinitionId, 10);
      if (Number.isNaN(categoryDefinitionId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid category definition ID',
        });
      }

      const { variabilityType } = req.body || {};

      if (!variabilityType) {
        return res.status(400).json({
          success: false,
          error: 'variabilityType is required',
        });
      }

      const result = await categoryVariabilityService.updateCategoryVariability(
        categoryDefinitionId,
        variabilityType
      );
      res.json(result);
    } catch (error) {
      console.error('Update category variability error:', error);
      handleServiceError(res, error, 'Failed to update category variability');
    }
  });

  /**
   * GET /api/category-variability/insights
   * Get variability insights (anomalies, large changes, etc.)
   * Query params: months (default: 6)
   */
  router.get('/insights', async (req, res) => {
    try {
      const result = await categoryVariabilityService.getCategoryVariabilityInsights(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Get category variability insights error:', error);
      handleServiceError(res, error, 'Failed to fetch category variability insights');
    }
  });

  return router;
}

module.exports = createCategoryVariabilityRouter;
