const express = require('express');

const breakdownService = require('../services/analytics/breakdown.js');
const dashboardService = require('../services/analytics/dashboard.js');
const unifiedCategoryService = require('../services/analytics/unified-category.js');
const waterfallService = require('../services/analytics/waterfall.js');
const categoryOpportunitiesService = require('../services/analytics/category-opportunities.js');
const personalIntelligenceService = require('../services/analytics/personal-intelligence.js');
const recurringAnalysisService = require('../services/analytics/recurring-analysis.js');
const healthScoreService = require('../services/analytics/health-score-roadmap.js');
const actionabilitySettingsService = require('../services/analytics/actionability-settings.js');
const categoryDetailsService = require('../services/analytics/category-details.js');
const categorySpendingService = require('../services/analytics/category-spending-summary.js');
const recurringManagementService = require('../services/analytics/recurring-management.js');
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

  router.get('/category-opportunities', async (req, res) => {
    try {
      const result = await categoryOpportunitiesService.getCategoryOpportunities(req.query);
      res.json(result);
    } catch (error) {
      console.error('Category opportunities analytics error:', error);
      const status = error?.status || 500;
      res.status(status).json({
        error: 'Failed to fetch category opportunities',
        message: error?.message || 'Internal server error',
      });
    }
  });

  router.get('/recurring-analysis', async (req, res) => {
    try {
      const result = await recurringAnalysisService.getRecurringAnalysis(req.query);
      res.json(result);
    } catch (error) {
      console.error('Recurring analysis error:', error);
      const status = error?.status || 500;
      res.status(status).json({
        error: 'Failed to analyze recurring transactions',
        message: error?.message || 'Internal server error',
      });
    }
  });

  router.get('/health-score-roadmap', async (req, res) => {
    try {
      const result = await healthScoreService.getHealthScoreRoadmap(req.query);
      res.json(result);
    } catch (error) {
      console.error('Health score roadmap error:', error);
      const status = error?.status || 500;
      res.status(status).json({
        error: 'Failed to generate health score roadmap',
        message: error?.message || 'Internal server error',
      });
    }
  });

  router.get('/actionability-settings', async (req, res) => {
    try {
      const result = await actionabilitySettingsService.listSettings();
      res.json(result);
    } catch (error) {
      console.error('Actionability settings fetch error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch actionability settings',
      });
    }
  });

  router.post('/actionability-settings', async (req, res) => {
    try {
      const result = await actionabilitySettingsService.bulkUpsertSettings(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Actionability settings bulk update error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to update actionability settings',
        details: error?.details || error?.stack,
      });
    }
  });

  router.put('/actionability-settings', async (req, res) => {
    try {
      const result = await actionabilitySettingsService.updateSetting(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Actionability setting update error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to update actionability setting',
      });
    }
  });

  router.delete('/actionability-settings', async (req, res) => {
    try {
      const result = await actionabilitySettingsService.resetSettings();
      res.json(result);
    } catch (error) {
      console.error('Actionability settings reset error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to reset actionability settings',
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

  router.get('/category-spending-summary', async (req, res) => {
    try {
      const result = await categorySpendingService.getCategorySpendingSummary(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Category spending summary error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch category spending summary',
      });
    }
  });

  router.post('/recurring-management', async (req, res) => {
    try {
      const result = await recurringManagementService.updateRecurringStatus(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Recurring management update error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to update recurring transaction status',
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
