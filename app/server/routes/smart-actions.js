const express = require('express');

const smartActionsService = require('../services/analytics/smart-actions.js');

function handleServiceError(res, error, fallbackMessage) {
  const status = error?.status || error?.statusCode || 500;
  res.status(status).json({
    success: false,
    error: error?.message || fallbackMessage || 'Internal server error',
  });
}

function createSmartActionsRouter() {
  const router = express.Router();

  /**
   * POST /api/smart-actions/generate
   * Generate smart action items by running all detection algorithms
   * Query params: months (default: 1), force (default: false)
   */
  router.post('/generate', async (req, res) => {
    try {
      const result = await smartActionsService.generateSmartActions({
        ...req.query,
        locale: req.locale,
      });
      res.json(result);
    } catch (error) {
      console.error('Generate smart actions error:', error);
      handleServiceError(res, error, 'Failed to generate smart actions');
    }
  });

  /**
   * GET /api/smart-actions
   * Get smart action items
   * Query params: status (active/dismissed/resolved/snoozed), severity, actionType
   */
  router.get('/', async (req, res) => {
    try {
      const result = await smartActionsService.getSmartActions({
        ...req.query,
        locale: req.locale,
      });
      res.json(result);
    } catch (error) {
      console.error('Get smart actions error:', error);
      handleServiceError(res, error, 'Failed to fetch smart actions');
    }
  });

  /**
   * PUT /api/smart-actions/:id/status
   * Update smart action status
   * Body: { status: 'resolved' | 'dismissed' | 'snoozed' | 'active', userNote?: string }
   */
  router.put('/:id/status', async (req, res) => {
    try {
      const actionId = parseInt(req.params.id, 10);
      if (Number.isNaN(actionId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid action ID',
        });
      }

      const { status, userNote } = req.body || {};

      if (!status) {
        return res.status(400).json({
          success: false,
          error: 'Status is required',
        });
      }

      const result = await smartActionsService.updateSmartActionStatus(actionId, status, userNote);
      res.json(result);
    } catch (error) {
      console.error('Update smart action status error:', error);
      handleServiceError(res, error, 'Failed to update smart action status');
    }
  });

  /**
   * POST /api/smart-actions/:id/resolve
   * Convenience endpoint to resolve an action
   */
  router.post('/:id/resolve', async (req, res) => {
    try {
      const actionId = parseInt(req.params.id, 10);
      if (Number.isNaN(actionId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid action ID',
        });
      }

      const { userNote } = req.body || {};
      const result = await smartActionsService.updateSmartActionStatus(actionId, 'resolved', userNote);
      res.json(result);
    } catch (error) {
      console.error('Resolve smart action error:', error);
      handleServiceError(res, error, 'Failed to resolve smart action');
    }
  });

  /**
   * POST /api/smart-actions/:id/dismiss
   * Convenience endpoint to dismiss an action
   */
  router.post('/:id/dismiss', async (req, res) => {
    try {
      const actionId = parseInt(req.params.id, 10);
      if (Number.isNaN(actionId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid action ID',
        });
      }

      const { userNote } = req.body || {};
      const result = await smartActionsService.updateSmartActionStatus(actionId, 'dismissed', userNote);
      res.json(result);
    } catch (error) {
      console.error('Dismiss smart action error:', error);
      handleServiceError(res, error, 'Failed to dismiss smart action');
    }
  });

  /**
   * POST /api/smart-actions/:id/snooze
   * Convenience endpoint to snooze an action
   */
  router.post('/:id/snooze', async (req, res) => {
    try {
      const actionId = parseInt(req.params.id, 10);
      if (Number.isNaN(actionId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid action ID',
        });
      }

      const { userNote } = req.body || {};
      const result = await smartActionsService.updateSmartActionStatus(actionId, 'snoozed', userNote);
      res.json(result);
    } catch (error) {
      console.error('Snooze smart action error:', error);
      handleServiceError(res, error, 'Failed to snooze smart action');
    }
  });

  return router;
}

module.exports = createSmartActionsRouter;
