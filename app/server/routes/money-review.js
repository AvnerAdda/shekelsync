const express = require('express');
const moneyReviewService = require('../services/money-review.js');

function sendError(res, error, fallbackMessage) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  res.status(status).json({
    success: false,
    error: status < 500 && error?.message ? error.message : fallbackMessage,
    ...(error?.code ? { code: error.code } : {}),
  });
}

function createMoneyReviewRouter({ service = moneyReviewService } = {}) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      res.json(await service.getMoneyReview({ locale: req.locale }));
    } catch (error) {
      console.error('Money Review fetch error:', error);
      sendError(res, error, 'Failed to load Money Review');
    }
  });

  router.put('/items/:id/status', async (req, res) => {
    try {
      res.json(await service.updateMoneyReviewItem(req.params.id, req.body || {}));
    } catch (error) {
      console.error('Money Review update error:', error);
      sendError(res, error, 'Failed to update Money Review item');
    }
  });

  return router;
}

module.exports = { createMoneyReviewRouter };
