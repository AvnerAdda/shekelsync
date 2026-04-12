const express = require('express');
const { resolveLocaleFromRequest } = require('../../lib/server/locale-utils.js');

const profilingService = require('../services/analytics/profiling.js');

function createAnalyticsProfilingRouter() {
  const router = express.Router();

  router.get('/profiling', async (_req, res) => {
    try {
      const result = await profilingService.getProfilingStatus();
      res.json(result);
    } catch (error) {
      console.error('Profiling status error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch profiling status',
      });
    }
  });

  router.post('/profiling/generate', async (req, res) => {
    try {
      const locale = req.locale || resolveLocaleFromRequest(req);
      const result = await profilingService.generateProfilingAssessment(req.body || {}, { locale });
      res.json(result);
    } catch (error) {
      console.error('Profiling generation error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to generate profiling',
        ...(Array.isArray(error?.missingFields) ? { missingFields: error.missingFields } : {}),
        ...(error?.code ? { code: error.code } : {}),
      });
    }
  });

  return router;
}

module.exports = { createAnalyticsProfilingRouter };
