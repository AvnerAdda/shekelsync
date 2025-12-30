const express = require('express');

const breakdownService = require('../services/analytics/breakdown.js');
const dashboardService = require('../services/analytics/dashboard.js');
const unifiedCategoryService = require('../services/analytics/unified-category.js');
const waterfallService = require('../services/analytics/waterfall.js');
const personalIntelligenceService = require('../services/analytics/personal-intelligence.js');
const categoryDetailsService = require('../services/analytics/category-details.js');
const transactionsByDateService = require('../services/analytics/transactions-by-date.js');
const investmentsAnalyticsService = require('../services/analytics/investments.js');
const temporalService = require('../services/analytics/temporal.js');
const behavioralService = require('../services/analytics/behavioral.js');
const extendedForecastService = require('../services/analytics/extended-forecast.js');
const timeValueService = require('../services/analytics/time-value.js');

function createAnalyticsRouter() {
  const router = express.Router();

  router.get('/unified-category', async (req, res) => {
    try {
      const result = await unifiedCategoryService.getUnifiedCategoryAnalytics(req.query);
      res.json(result);
    } catch (error) {
      console.error('Unified category analytics error:', error);
      if (error?.error) {
        const status = error.error.code === 'DATABASE_ERROR' ? 500 : 400;
        res.status(status).json(error);
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to fetch analytics data',
          message: error.message,
        });
      }
    }
  });

  router.get('/dashboard', async (req, res) => {
    try {
      const result = await dashboardService.getDashboardAnalytics(req.query);
      res.json(result);
    } catch (error) {
      console.error('Dashboard analytics error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch dashboard analytics',
        message: error.message,
      });
    }
  });

  router.get('/breakdown', async (req, res) => {
    try {
      const result = await breakdownService.getBreakdownAnalytics({
        ...req.query,
        locale: req.locale,
      });
      res.json(result);
    } catch (error) {
      console.error('Breakdown analytics error:', error);
      const status = error?.status || 500;
      res.status(status).json({
        error: 'Failed to fetch breakdown analytics',
        message: error?.message || 'Internal server error',
      });
    }
  });

  router.get('/personal-intelligence', async (req, res) => {
    try {
      const result = await personalIntelligenceService.getPersonalIntelligence(req.query);
      res.json(result);
    } catch (error) {
      console.error('Personal intelligence error:', error);
      res.status(500).json({
        error: 'Failed to generate personal intelligence',
        message: error.message,
      });
    }
  });

  router.get('/waterfall-flow', async (req, res) => {
    try {
      const result = await waterfallService.getWaterfallAnalytics(req.query);
      res.json(result);
    } catch (error) {
      console.error('Waterfall analytics error:', error);
      const status = error?.status || 500;
      res.status(status).json({
        error: 'Failed to fetch waterfall analytics',
        message: error?.message || 'Internal server error',
      });
    }
  });

  router.get('/category-details', async (req, res) => {
    try {
      const result = await categoryDetailsService.getCategoryDetails({
        ...req.query,
        locale: req.locale,
      });
      res.json(result);
    } catch (error) {
      console.error('Category details error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch category details',
        details: error?.stack,
      });
    }
  });

  router.get('/transactions-by-date', async (req, res) => {
    try {
      const result = await transactionsByDateService.listTransactionsByDate(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Transactions-by-date error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch transactions',
      });
    }
  });

  router.get('/investments', async (req, res) => {
    try {
      const result = await investmentsAnalyticsService.getInvestmentsAnalytics(req.query);
      res.json(result);
    } catch (error) {
      console.error('Analytics investments error:', error);
      res.status(500).json({
        error: 'Failed to fetch investment analytics',
        message: error?.message || 'Internal server error',
      });
    }
  });

  router.get('/temporal', async (req, res) => {
    try {
      const result = await temporalService.getTemporalAnalytics(req.query);
      res.json(result);
    } catch (error) {
      console.error('Temporal analytics error:', error);
      res.status(500).json({
        error: 'Failed to fetch temporal analytics',
        message: error?.message || 'Internal server error',
      });
    }
  });

  router.get('/behavioral-patterns', async (req, res) => {
    try {
      const result = await behavioralService.getBehavioralPatterns();
      res.json(result);
    } catch (error) {
      console.error('Behavioral patterns error:', error);
      res.status(500).json({
        error: 'Failed to fetch behavioral patterns',
        message: error?.message || 'Internal server error',
      });
    }
  });

  router.get('/forecast-extended', async (req, res) => {
    try {
      // Extended forecast always uses 6 months, regardless of other settings
      const result = await extendedForecastService.getExtendedForecast();
      res.json(result);
    } catch (error) {
      console.error('Extended forecast error:', error);
      res.status(500).json({
        error: 'Failed to fetch extended forecast',
        message: error?.message || 'Internal server error',
      });
    }
  });

  router.get('/time-value', async (req, res) => {
    try {
      const result = await timeValueService.getTimeValueAnalytics();
      res.json(result);
    } catch (error) {
      console.error('Time value analytics error:', error);
      res.status(500).json({
        error: 'Failed to fetch time value analytics',
        message: error?.message || 'Internal server error',
      });
    }
  });

  return router;
}

module.exports = { createAnalyticsRouter };
