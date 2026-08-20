const express = require('express');

const optimizerService = require('../services/optimizer.js');
const optimizerV2Service = require('../services/optimizer-v2.js');

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

  router.get('/v2/status', async (_req, res) => {
    try {
      const result = await optimizerV2Service.getOptimizerV2Status();
      res.json(result);
    } catch (error) {
      console.error('Optimizer v2 status error:', error);
      sendError(res, error, 'Failed to fetch optimizer v2 status');
    }
  });

  router.put('/v2/review-groups/:groupKey', async (req, res) => {
    try {
      const result = await optimizerV2Service.updateReviewGroup(req.params.groupKey, req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Optimizer v2 review error:', error);
      sendError(res, error, 'Failed to update optimizer v2 review group');
    }
  });

  router.post('/v2/generate', async (req, res) => {
    try {
      const result = await optimizerV2Service.generateOptimizerV2({
        ...withResolvedOpenAiApiKey(req),
        ...(req.locale ? { locale: req.locale } : {}),
      });
      res.json(result);
    } catch (error) {
      console.error('Optimizer v2 generation error:', error);
      sendError(res, error, 'Failed to generate optimizer v2 actions');
    }
  });

  router.put('/v2/recommendations/:id/status', async (req, res) => {
    try {
      const result = await optimizerV2Service.updateCandidateStatus(req.params.id, req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Optimizer v2 candidate status error:', error);
      sendError(res, error, 'Failed to update optimizer v2 candidate');
    }
  });

  router.get('/status', async (_req, res) => {
    try {
      const result = await optimizerService.getOptimizerStatus();
      res.json(result);
    } catch (error) {
      console.error('Optimizer status error:', error);
      sendError(res, error, 'Failed to fetch optimizer status');
    }
  });

  router.get('/history', async (req, res) => {
    try {
      const result = await optimizerService.getOptimizerHistory({ limit: req.query.limit });
      res.json(result);
    } catch (error) {
      console.error('Optimizer history error:', error);
      sendError(res, error, 'Failed to fetch optimizer history');
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
