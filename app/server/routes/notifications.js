const express = require('express');

const notificationsService = require('../services/notifications.js');

function createNotificationsRouter() {
  const router = express.Router();

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
