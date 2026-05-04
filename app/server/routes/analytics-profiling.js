const express = require('express');
const { resolveLocaleFromRequest } = require('../../lib/server/locale-utils.js');

const profilingService = require('../services/analytics/profiling.js');

function getHeaderValue(headers, key) {
  const value = headers?.[key];
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null;
  }
  return typeof value === 'string' ? value : null;
}

function withResolvedOpenAiApiKey(req) {
  const payload = req.body && typeof req.body === 'object' ? { ...req.body } : {};
  const headerApiKey = getHeaderValue(req.headers, 'x-openai-api-key');
  const bodyApiKey = typeof payload.openaiApiKey === 'string' ? payload.openaiApiKey.trim() : '';
  const resolvedApiKey = typeof headerApiKey === 'string' && headerApiKey.trim().length > 0
    ? headerApiKey.trim()
    : bodyApiKey;

  if (resolvedApiKey) {
    payload.openaiApiKey = resolvedApiKey;
  }

  return payload;
}

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
      const result = await profilingService.generateProfilingAssessment(withResolvedOpenAiApiKey(req), { locale });
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
