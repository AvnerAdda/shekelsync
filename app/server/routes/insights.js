const express = require('express');

const insightsService = require('../services/analytics/insights.js');

function createInsightsRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const result = await insightsService.getInsights(req.query || {});
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Insights fetch error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to generate insights',
      });
    }
  });

  return router;
}

module.exports = { createInsightsRouter };
