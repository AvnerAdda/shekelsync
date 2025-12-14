const express = require('express');
const { generateDailyForecast } = require('../services/forecast.js');

function createForecastRouter() {
  const router = express.Router();

  router.get('/daily', async (req, res) => {
    try {
      console.log('[Forecast] Generating daily forecast...');
      const result = await generateDailyForecast();
      console.log('[Forecast] Successfully generated forecast with', result.dailyForecasts?.length || 0, 'days');

      res.json(result);
    } catch (error) {
      console.error('[Forecast] Generation error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to generate forecast',
        details: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      });
    }
  });

  return router;
}

module.exports = { createForecastRouter };
