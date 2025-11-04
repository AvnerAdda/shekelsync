const express = require('express');

const duplicatePatternsService = require('../services/patterns/duplicate-patterns.js');

function createPatternsRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const result = await duplicatePatternsService.listPatterns(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Duplicate patterns list error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch duplicate patterns',
        details: error?.stack,
      });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const result = await duplicatePatternsService.createPattern(req.body || {});
      res.status(201).json(result);
    } catch (error) {
      console.error('Duplicate pattern create error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to create duplicate pattern',
        details: error?.stack,
      });
    }
  });

  router.put('/', async (req, res) => {
    try {
      const result = await duplicatePatternsService.updatePattern(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Duplicate pattern update error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to update duplicate pattern',
        details: error?.stack,
      });
    }
  });

  router.delete('/', async (req, res) => {
    try {
      const result = await duplicatePatternsService.deletePattern(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Duplicate pattern delete error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to delete duplicate pattern',
        details: error?.stack,
      });
    }
  });

  return router;
}

module.exports = { createPatternsRouter };
