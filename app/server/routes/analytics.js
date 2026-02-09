const express = require('express');
const { resolveLocaleFromRequest } = require('../../lib/server/locale-utils.js');

const breakdownService = require('../services/analytics/breakdown.js');
const dashboardService = require('../services/analytics/dashboard.js');
const unifiedCategoryService = require('../services/analytics/unified-category.js');
const waterfallService = require('../services/analytics/waterfall.js');
const personalIntelligenceService = require('../services/analytics/personal-intelligence.js');
const healthScoreHistoryService = require('../services/analytics/health-score-history.js');
const categoryDetailsService = require('../services/analytics/category-details.js');
const transactionsByDateService = require('../services/analytics/transactions-by-date.js');
const investmentsAnalyticsService = require('../services/analytics/investments.js');
const temporalService = require('../services/analytics/temporal.js');
const behavioralService = require('../services/analytics/behavioral.js');
const extendedForecastService = require('../services/analytics/extended-forecast.js');
const timeValueService = require('../services/analytics/time-value.js');
const questsService = require('../services/analytics/quests.js');
const subscriptionsService = require('../services/analytics/subscriptions.js');

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

  router.get('/health-score-history', async (req, res) => {
    try {
      const result = await healthScoreHistoryService.getHealthScoreHistory(req.query);
      res.json(result);
    } catch (error) {
      console.error('Health score history error:', error);
      res.status(500).json({
        error: 'Failed to generate health score history',
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
      const locale = req.locale || 'he';
      const result = await behavioralService.getBehavioralPatterns(locale, req.query);
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
      const result = await extendedForecastService.getExtendedForecast(req.query);
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
      const result = await timeValueService.getTimeValueAnalytics(req.query);
      res.json(result);
    } catch (error) {
      console.error('Time value analytics error:', error);
      res.status(500).json({
        error: 'Failed to fetch time value analytics',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // ============================================================================
  // QUEST SYSTEM ROUTES
  // ============================================================================

  // Generate new quests based on forecast patterns
  router.post('/quests/generate', async (req, res) => {
    try {
      const { force } = req.body || {};
      const locale = resolveLocaleFromRequest(req);
      const result = await questsService.generateQuests({
        locale,
        force: Boolean(force),
      });
      res.json(result);
    } catch (error) {
      console.error('Quest generation error:', error);
      res.status(500).json({
        error: 'Failed to generate quests',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // Get active quests with progress
  router.get('/quests/active', async (req, res) => {
    try {
      const locale = resolveLocaleFromRequest(req);
      const result = await questsService.getActiveQuests({
        locale,
      });
      res.json(result);
    } catch (error) {
      console.error('Get active quests error:', error);
      res.status(500).json({
        error: 'Failed to fetch active quests',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // Get user quest stats (points, level, streak)
  router.get('/quests/stats', async (req, res) => {
    try {
      const result = await questsService.getUserQuestStats();
      res.json(result);
    } catch (error) {
      console.error('Get quest stats error:', error);
      res.status(500).json({
        error: 'Failed to fetch quest stats',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // Accept a quest
  router.post('/quests/:id/accept', async (req, res) => {
    try {
      const questId = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(questId)) {
        return res.status(400).json({ error: 'Invalid quest ID' });
      }
      const result = await questsService.acceptQuest(questId);
      res.json(result);
    } catch (error) {
      console.error('Accept quest error:', error);
      let status = 500;
      if (error.message.includes('not found')) status = 404;
      else if (error.message.includes('cannot be accepted')) status = 400;
      res.status(status).json({
        error: 'Failed to accept quest',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // Decline a quest
  router.post('/quests/:id/decline', async (req, res) => {
    try {
      const questId = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(questId)) {
        return res.status(400).json({ error: 'Invalid quest ID' });
      }
      const result = await questsService.declineQuest(questId);
      res.json(result);
    } catch (error) {
      console.error('Decline quest error:', error);
      const status = error.message.includes('not found') ? 404 : 500;
      res.status(status).json({
        error: 'Failed to decline quest',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // Verify quest completion (manual or auto)
  router.post('/quests/:id/verify', async (req, res) => {
    try {
      const questId = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(questId)) {
        return res.status(400).json({ error: 'Invalid quest ID' });
      }
      const manualResult = req.body?.result || null;
      const result = await questsService.verifyQuestCompletion(questId, manualResult);
      res.json(result);
    } catch (error) {
      console.error('Verify quest error:', error);
      let status = 500;
      if (error.message.includes('not found')) status = 404;
      else if (error.message.includes('cannot be verified')) status = 400;
      res.status(status).json({
        error: 'Failed to verify quest',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // Check quest deadlines (cron job trigger or manual)
  router.post('/quests/check-deadlines', async (req, res) => {
    try {
      const result = await questsService.checkQuestDeadlines();
      res.json(result);
    } catch (error) {
      console.error('Check quest deadlines error:', error);
      res.status(500).json({
        error: 'Failed to check quest deadlines',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // ============================================================================
  // SUBSCRIPTION MANAGEMENT ROUTES
  // ============================================================================

  // Get all subscriptions with optional filters
  router.get('/subscriptions', async (req, res) => {
    try {
      const locale = resolveLocaleFromRequest(req);
      const { status, frequency } = req.query;
      const result = await subscriptionsService.getSubscriptions({
        status,
        frequency,
        locale,
      });
      res.json(result);
    } catch (error) {
      console.error('Get subscriptions error:', error);
      res.status(500).json({
        error: 'Failed to fetch subscriptions',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // Get subscription cost summary
  router.get('/subscriptions/summary', async (req, res) => {
    try {
      const locale = resolveLocaleFromRequest(req);
      const result = await subscriptionsService.getSubscriptionSummary({ locale });
      res.json(result);
    } catch (error) {
      console.error('Get subscription summary error:', error);
      res.status(500).json({
        error: 'Failed to fetch subscription summary',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // Get subscription creep (historical cost growth)
  router.get('/subscriptions/creep', async (req, res) => {
    try {
      const months = parseInt(req.query.months, 10) || 12;
      const result = await subscriptionsService.getSubscriptionCreep({ months });
      res.json(result);
    } catch (error) {
      console.error('Get subscription creep error:', error);
      res.status(500).json({
        error: 'Failed to fetch subscription creep data',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // Get subscription alerts
  router.get('/subscriptions/alerts', async (req, res) => {
    try {
      const locale = resolveLocaleFromRequest(req);
      const includeDismissed = req.query.include_dismissed === 'true';
      const result = await subscriptionsService.getSubscriptionAlerts({
        locale,
        include_dismissed: includeDismissed,
      });
      res.json(result);
    } catch (error) {
      console.error('Get subscription alerts error:', error);
      res.status(500).json({
        error: 'Failed to fetch subscription alerts',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // Get upcoming renewals
  router.get('/subscriptions/renewals', async (req, res) => {
    try {
      const locale = resolveLocaleFromRequest(req);
      const days = parseInt(req.query.days, 10) || 30;
      const result = await subscriptionsService.getUpcomingRenewals({ days, locale });
      res.json(result);
    } catch (error) {
      console.error('Get upcoming renewals error:', error);
      res.status(500).json({
        error: 'Failed to fetch upcoming renewals',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // Update a subscription
  router.put('/subscriptions/:id', async (req, res) => {
    try {
      const subscriptionId = parseInt(req.params.id, 10);
      if (isNaN(subscriptionId)) {
        return res.status(400).json({ error: 'Invalid subscription ID' });
      }
      const result = await subscriptionsService.updateSubscription(subscriptionId, req.body);
      res.json(result);
    } catch (error) {
      console.error('Update subscription error:', error);
      const status = error.message.includes('not found') ? 404 : 500;
      res.status(status).json({
        error: 'Failed to update subscription',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // Add a manual subscription
  router.post('/subscriptions', async (req, res) => {
    try {
      const result = await subscriptionsService.addManualSubscription(req.body);
      res.status(201).json(result);
    } catch (error) {
      console.error('Add subscription error:', error);
      const status = error.message.includes('already exists') ? 409 : 500;
      res.status(status).json({
        error: 'Failed to add subscription',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // Delete a subscription
  router.delete('/subscriptions/:id', async (req, res) => {
    try {
      const subscriptionId = parseInt(req.params.id, 10);
      if (isNaN(subscriptionId)) {
        return res.status(400).json({ error: 'Invalid subscription ID' });
      }
      const result = await subscriptionsService.deleteSubscription(subscriptionId);
      res.json(result);
    } catch (error) {
      console.error('Delete subscription error:', error);
      const status = error.message.includes('not found') ? 404 : 500;
      res.status(status).json({
        error: 'Failed to delete subscription',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // Dismiss an alert
  router.post('/subscriptions/alerts/:id/dismiss', async (req, res) => {
    try {
      const alertId = parseInt(req.params.id, 10);
      if (isNaN(alertId)) {
        return res.status(400).json({ error: 'Invalid alert ID' });
      }
      const result = await subscriptionsService.dismissAlert(alertId);
      res.json(result);
    } catch (error) {
      console.error('Dismiss alert error:', error);
      res.status(500).json({
        error: 'Failed to dismiss alert',
        message: error?.message || 'Internal server error',
      });
    }
  });

  // Refresh subscription detection
  router.post('/subscriptions/detect', async (req, res) => {
    try {
      const locale = resolveLocaleFromRequest(req);
      const result = await subscriptionsService.refreshDetection(locale);
      res.json(result);
    } catch (error) {
      console.error('Refresh detection error:', error);
      res.status(500).json({
        error: 'Failed to refresh subscription detection',
        message: error?.message || 'Internal server error',
      });
    }
  });

  return router;
}

module.exports = { createAnalyticsRouter };
