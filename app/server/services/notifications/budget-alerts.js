/**
 * Budget Alerts Service
 * Monitors budget utilization and generates alerts when thresholds are exceeded
 */

const database = require('../database.js');

const ALERT_THRESHOLDS = {
  WARNING: 0.8,
  CRITICAL: 0.95,
  EXCEEDED: 1.0,
};

async function checkBudgetAlerts(options = {}) {
  const now = new Date();
  const startDate = options.startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const endDate = options.endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  const budgetsResult = await database.query(`
    SELECT
      cb.id AS budget_id,
      cb.category_definition_id,
      cd.name AS category_name,
      cd.name_en AS category_name_en,
      cb.budget_amount,
      COALESCE(spending.total_spent, 0) AS total_spent,
      CASE 
        WHEN cb.budget_amount > 0 
        THEN ROUND(COALESCE(spending.total_spent, 0) / cb.budget_amount, 3)
        ELSE 0
      END AS utilization_ratio
    FROM category_budgets cb
    JOIN category_definitions cd ON cd.id = cb.category_definition_id
    LEFT JOIN (
      SELECT t.category_definition_id, SUM(ABS(t.price)) AS total_spent
      FROM transactions t
      WHERE t.date >= $1 AND t.date <= $2 AND t.price < 0
      GROUP BY t.category_definition_id
    ) spending ON spending.category_definition_id = cb.category_definition_id
    WHERE cb.is_active = 1
    ORDER BY utilization_ratio DESC
  `, [startDate, endDate]);

  const budgets = budgetsResult.rows || [];
  const alerts = [];
  const statusCounts = { on_track: 0, warning: 0, critical: 0, exceeded: 0 };

  for (const budget of budgets) {
    const ratio = budget.utilization_ratio || 0;
    let alertType = null;
    let severity = 'info';

    if (ratio >= ALERT_THRESHOLDS.EXCEEDED) {
      alertType = 'budget_exceeded';
      severity = 'critical';
      statusCounts.exceeded++;
    } else if (ratio >= ALERT_THRESHOLDS.CRITICAL) {
      alertType = 'budget_critical';
      severity = 'warning';
      statusCounts.critical++;
    } else if (ratio >= ALERT_THRESHOLDS.WARNING) {
      alertType = 'budget_warning';
      severity = 'info';
      statusCounts.warning++;
    } else {
      statusCounts.on_track++;
    }

    if (alertType) {
      const categoryName = budget.category_name_en || budget.category_name;
      const percentUsed = Math.round(ratio * 100);
      
      alerts.push({
        type: alertType,
        severity,
        budget_id: budget.budget_id,
        category_id: budget.category_definition_id,
        category_name: categoryName,
        budget_amount: budget.budget_amount,
        spent_amount: budget.total_spent,
        utilization_ratio: ratio,
        percent_used: percentUsed,
        remaining: Math.max(0, budget.budget_amount - budget.total_spent),
      });
    }
  }

  return {
    alerts,
    summary: { totalBudgets: budgets.length, ...statusCounts, alertCount: alerts.length },
    period: { startDate, endDate },
  };
}

async function storeBudgetAlerts(alerts) {
  if (!alerts || alerts.length === 0) return { stored: 0 };
  
  let storedCount = 0;
  const now = new Date().toISOString();

  for (const alert of alerts) {
    try {
      await database.query(`
        INSERT INTO smart_action_items (
          action_type, trigger_category_id, title, description, severity,
          detected_at, metadata, user_status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $6, $6)
        ON CONFLICT DO NOTHING
      `, [
        'budget_alert',
        alert.category_id,
        alert.category_name + ': ' + alert.percent_used + '% used',
        'Budget ' + (alert.type === 'budget_exceeded' ? 'exceeded' : 'warning'),
        alert.severity,
        now,
        JSON.stringify({ budget_id: alert.budget_id, spent: alert.spent_amount }),
      ]);
      storedCount++;
    } catch (error) {
      console.error('Failed to store budget alert:', error);
    }
  }
  return { stored: storedCount };
}

async function checkAndStoreBudgetAlerts() {
  const result = await checkBudgetAlerts();
  if (result.alerts.length > 0) {
    const storageResult = await storeBudgetAlerts(result.alerts);
    return { ...result, storage: storageResult };
  }
  return result;
}

module.exports = {
  checkBudgetAlerts,
  storeBudgetAlerts,
  checkAndStoreBudgetAlerts,
  ALERT_THRESHOLDS,
};
