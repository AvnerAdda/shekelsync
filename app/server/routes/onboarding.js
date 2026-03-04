const express = require('express');

function createOnboardingRouter({ services = {} } = {}) {
  const onboardingService = services.onboardingService || require('../services/onboarding.js');
  const router = express.Router();

  router.get('/status', async (_req, res) => {
    try {
      const status = await onboardingService.getOnboardingStatus();
      res.json(status);
    } catch (error) {
      console.error('Onboarding status error:', error);
      res.status(500).json({
        error: 'Failed to fetch onboarding status',
        message: error?.message,
      });
    }
  });

  router.post('/dismiss', async (_req, res) => {
    try {
      const result = await onboardingService.dismissOnboarding();
      res.json(result);
    } catch (error) {
      console.error('Onboarding dismiss error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to dismiss onboarding',
        message: error?.message,
      });
    }
  });

  return router;
}

module.exports = { createOnboardingRouter };
