const express = require('express');
const donationsService = require('../services/donations.js');

function normalizePayload(body = {}) {
  if (body && typeof body === 'object' && body.payload && typeof body.payload === 'object') {
    return body.payload;
  }
  return body || {};
}

function getHeaderValue(headers, key) {
  const value = headers?.[key];
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null;
  }
  return typeof value === 'string' ? value : null;
}

function getSupporterContext(req) {
  return {
    accessToken: getHeaderValue(req.headers, 'x-auth-access-token'),
    userId: getHeaderValue(req.headers, 'x-auth-user-id'),
    email: getHeaderValue(req.headers, 'x-auth-user-email'),
    name: getHeaderValue(req.headers, 'x-auth-user-name'),
  };
}

function createDonationsRouter() {
  const router = express.Router();

  router.get('/status', async (req, res) => {
    try {
      const status = await donationsService.getDonationStatus(getSupporterContext(req));
      res.json({ success: true, data: status });
    } catch (error) {
      console.error('Donation status error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to fetch donation status',
        ...(error?.code ? { code: error.code } : {}),
      });
    }
  });

  router.post('/intent', async (req, res) => {
    try {
      const payload = normalizePayload(req.body);
      const status = await donationsService.createSupportIntent(payload, getSupporterContext(req));
      res.json({ success: true, data: status });
    } catch (error) {
      console.error('Donation intent error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to record support intent',
        ...(error?.code ? { code: error.code } : {}),
      });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const payload = normalizePayload(req.body);
      let status;
      if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'planKey')) {
        status = await donationsService.createSupportIntent(payload, getSupporterContext(req));
      } else {
        status = await donationsService.addDonationEvent(payload, getSupporterContext(req));
      }
      res.json({ success: true, data: status });
    } catch (error) {
      console.error('Donation create error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to record donation',
        ...(error?.code ? { code: error.code } : {}),
      });
    }
  });

  router.post('/reminder-shown', async (req, res) => {
    try {
      const payload = normalizePayload(req.body);
      const status = await donationsService.markMonthlyReminderShown(payload, getSupporterContext(req));
      res.json({ success: true, data: status });
    } catch (error) {
      console.error('Donation reminder update error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to update monthly reminder status',
        ...(error?.code ? { code: error.code } : {}),
      });
    }
  });

  return router;
}

module.exports = { createDonationsRouter };
