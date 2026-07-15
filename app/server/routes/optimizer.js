const express = require('express');

const optimizerService = require('../services/optimizer.js');

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

function sendError(res, error, fallbackMessage) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const message = Number.isInteger(error?.status) && error?.message
    ? error.message
    : fallbackMessage;
  res.status(status).json({
    success: false,
    error: message,
    ...(error?.code ? { code: error.code } : {}),
    ...(status < 500 && error?.details ? { details: error.details } : {}),
  });
}

function createOptimizerRouter() {
  const router = express.Router();

  router.get('/status', async (_req, res) => {
    try {
      const result = await optimizerService.getOptimizerStatus();
      res.json(result);
    } catch (error) {
      console.error('Optimizer status error:', error);
      sendError(res, error, 'Failed to fetch optimizer status');
    }
  });

  router.put('/facts', async (req, res) => {
    try {
      const result = await optimizerService.saveOptimizerFacts(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Optimizer facts save error:', error);
      sendError(res, error, 'Failed to save optimizer facts');
    }
  });

  router.post('/generate', async (req, res) => {
    try {
      const result = await optimizerService.generateOptimizerPlan({
        ...withResolvedOpenAiApiKey(req),
        ...(req.locale ? { locale: req.locale } : {}),
      });
      res.json(result);
    } catch (error) {
      console.error('Optimizer generation error:', error);
      sendError(res, error, 'Failed to generate optimizer plan');
    }
  });

  router.put('/recommendations/:id/status', async (req, res) => {
    try {
      const result = await optimizerService.updateRecommendationStatus(req.params.id, req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Optimizer recommendation status error:', error);
      sendError(res, error, 'Failed to update optimizer recommendation');
    }
  });

  return router;
}

module.exports = {
  createOptimizerRouter,
  withResolvedOpenAiApiKey,
};
