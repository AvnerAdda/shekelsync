const express = require('express');

const actionItemsService = require('../services/analytics/action-items.js');

function createAnalyticsActionItemsRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const result = await actionItemsService.getActionItems(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Action items get error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to fetch action items',
        details: error?.details || error?.stack,
      });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const result = await actionItemsService.createActionItem(req.body || {});
      res.status(201).json(result);
    } catch (error) {
      console.error('Action items create error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to create action item',
        details: error?.details || error?.stack,
      });
    }
  });

  router.put('/', async (req, res) => {
    try {
      const result = await actionItemsService.updateActionItem(req.query || {}, req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Action items update error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to update action item',
        details: error?.details || error?.stack,
      });
    }
  });

  router.delete('/', async (req, res) => {
    try {
      const result = await actionItemsService.deleteActionItem(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Action items delete error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to delete action item',
        details: error?.details || error?.stack,
      });
    }
  });

  return router;
}

module.exports = { createAnalyticsActionItemsRouter };
