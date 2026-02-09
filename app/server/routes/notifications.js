const express = require('express');

const notificationsService = require('../services/notifications.js');

function createNotificationsRouter() {
  const router = express.Router();

  router.get('/snapshot-progress', async (_req, res) => {
    try {
      const result = await notificationsService.getSnapshotProgress();
      res.json(result);
    } catch (error) {
      console.error('Snapshot progress fetch error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to generate snapshot progress',
      });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const result = await notificationsService.getNotifications(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Notifications fetch error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to generate notifications',
      });
    }
  });

  return router;
}

module.exports = { createNotificationsRouter };
