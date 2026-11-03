const express = require('express');

const duplicatePatternsService = require('../services/patterns/duplicate-patterns.js');
const { sanitizeError } = require('../../lib/server/error-sanitizer.js');

function sendPatternError(res, error, defaultMessage) {
  const status = error?.status || 500;
  const sanitized = sanitizeError(error, {
    statusCode: status,
    defaultMessage,
    exposeMessage: status >= 400 && status < 500,
    includeStack: false,
  });
  res.status(status).json({ error: sanitized.error });
}

function createPatternsRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const result = await duplicatePatternsService.listPatterns(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Duplicate patterns list error:', error);
      sendPatternError(res, error, 'Failed to fetch duplicate patterns');
    }
  });

  router.post('/', async (req, res) => {
    try {
      const result = await duplicatePatternsService.createPattern(req.body || {});
      res.status(201).json(result);
    } catch (error) {
      console.error('Duplicate pattern create error:', error);
      sendPatternError(res, error, 'Failed to create duplicate pattern');
    }
  });

  router.put('/', async (req, res) => {
    try {
      const result = await duplicatePatternsService.updatePattern(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Duplicate pattern update error:', error);
      sendPatternError(res, error, 'Failed to update duplicate pattern');
    }
  });

  router.delete('/', async (req, res) => {
    try {
      const result = await duplicatePatternsService.deletePattern(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Duplicate pattern delete error:', error);
      sendPatternError(res, error, 'Failed to delete duplicate pattern');
    }
  });

  return router;
}

module.exports = { createPatternsRouter };
