/**
 * Budget Alerts API Routes
 */

const budgetAlertsService = require('../services/notifications/budget-alerts.js');

async function getBudgetAlerts(req, res) {
  try {
    const { startDate, endDate } = req.query;
    const result = await budgetAlertsService.checkBudgetAlerts({ startDate, endDate });
    res.json(result);
  } catch (error) {
    console.error('Get budget alerts error:', error);
    res.status(500).json({ error: 'Failed to get budget alerts' });
  }
}

async function checkAndStoreAlerts(req, res) {
  try {
    const result = await budgetAlertsService.checkAndStoreBudgetAlerts();
    res.json(result);
  } catch (error) {
    console.error('Check and store alerts error:', error);
    res.status(500).json({ error: 'Failed to check budget alerts' });
  }
}

module.exports = { getBudgetAlerts, checkAndStoreAlerts };
