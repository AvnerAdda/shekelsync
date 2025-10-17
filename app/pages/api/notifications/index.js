import { getDB } from '../db.js';
import { buildDuplicateFilter, standardizeResponse, standardizeError } from '../utils/queryUtils.js';
import { subDays, startOfMonth, endOfMonth, format } from 'date-fns';

/**
 * Smart Notifications API
 * Generates intelligent alerts based on spending patterns, budgets, and anomalies
 */

const NOTIFICATION_TYPES = {
  BUDGET_WARNING: 'budget_warning',
  BUDGET_EXCEEDED: 'budget_exceeded',
  UNUSUAL_SPENDING: 'unusual_spending',
  HIGH_TRANSACTION: 'high_transaction',
  RECURRING_DUE: 'recurring_due',
  GOAL_MILESTONE: 'goal_milestone',
  CASH_FLOW_ALERT: 'cash_flow_alert',
  NEW_VENDOR: 'new_vendor'
};

const SEVERITY_LEVELS = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical'
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json(standardizeError('Method not allowed', 'METHOD_NOT_ALLOWED'));
  }

  const client = await getDB();

  try {
    const {
      type = 'all',
      severity = 'all',
      limit = 50,
      include_dismissed = 'false'
    } = req.query;

    const notifications = [];
    const now = new Date();
    const currentMonth = {
      start: startOfMonth(now),
      end: endOfMonth(now)
    };

    // Get duplicate filter for accurate calculations
    const duplicateFilter = await buildDuplicateFilter(client, 't');

    // 1. Budget Warnings & Exceeded Alerts
    if (type === 'all' || type === NOTIFICATION_TYPES.BUDGET_WARNING || type === NOTIFICATION_TYPES.BUDGET_EXCEEDED) {
      const budgetAlertsResult = await client.query(`
        WITH monthly_spending AS (
          SELECT
            COALESCE(t.parent_category, t.category) as category,
            SUM(ABS(t.price)) as spent
          FROM transactions t
          WHERE t.date >= $1
          AND t.date <= $2
          AND t.price < 0
          ${duplicateFilter}
          GROUP BY COALESCE(t.parent_category, t.category)
        ),
        budget_usage AS (
          SELECT
            cb.category,
            cb.budget_limit,
            COALESCE(ms.spent, 0) as spent,
            (COALESCE(ms.spent, 0) / cb.budget_limit * 100) as usage_percentage
          FROM category_budgets cb
          LEFT JOIN monthly_spending ms ON cb.category = ms.category
          WHERE cb.is_active = true
          AND cb.period_type = 'monthly'
        )
        SELECT * FROM budget_usage
        WHERE usage_percentage >= 75
        ORDER BY usage_percentage DESC
      `, [currentMonth.start, currentMonth.end]);

      budgetAlertsResult.rows.forEach(budget => {
        const isExceeded = budget.usage_percentage >= 100;
        notifications.push({
          id: `budget_${budget.category}`,
          type: isExceeded ? NOTIFICATION_TYPES.BUDGET_EXCEEDED : NOTIFICATION_TYPES.BUDGET_WARNING,
          severity: isExceeded ? SEVERITY_LEVELS.CRITICAL : SEVERITY_LEVELS.WARNING,
          title: isExceeded ? 'Budget Exceeded!' : 'Budget Warning',
          message: `${budget.category}: ${budget.usage_percentage.toFixed(1)}% of budget used (₪${budget.spent.toLocaleString()} / ₪${budget.budget_limit.toLocaleString()})`,
          data: {
            category: budget.category,
            spent: budget.spent,
            budget: budget.budget_limit,
            percentage: budget.usage_percentage
          },
          timestamp: now.toISOString(),
          actionable: true,
          actions: [
            { label: 'View Details', action: 'view_category', params: { category: budget.category } },
            { label: 'Adjust Budget', action: 'edit_budget', params: { category: budget.category } }
          ]
        });
      });
    }

    // 2. Unusual Spending Detection
    if (type === 'all' || type === NOTIFICATION_TYPES.UNUSUAL_SPENDING) {
      const recentTransactionsResult = await client.query(`
        WITH category_averages AS (
          SELECT
            COALESCE(t.parent_category, t.category) as category,
            AVG(ABS(t.price)) as avg_amount,
            STDDEV(ABS(t.price)) as std_amount
          FROM transactions t
          WHERE t.date >= $1
          AND t.price < 0
          ${duplicateFilter}
          GROUP BY COALESCE(t.parent_category, t.category)
          HAVING COUNT(*) >= 5
        ),
        recent_transactions AS (
          SELECT
            t.identifier,
            t.vendor,
            t.name,
            t.date,
            ABS(t.price) as amount,
            COALESCE(t.parent_category, t.category) as category
          FROM transactions t
          WHERE t.date >= $2
          AND t.price < 0
          ${duplicateFilter}
        )
        SELECT
          rt.*,
          ca.avg_amount,
          ca.std_amount,
          (rt.amount - ca.avg_amount) / NULLIF(ca.std_amount, 0) as z_score
        FROM recent_transactions rt
        JOIN category_averages ca ON rt.category = ca.category
        WHERE (rt.amount - ca.avg_amount) / NULLIF(ca.std_amount, 0) > 2.5
        ORDER BY z_score DESC
        LIMIT 10
      `, [subDays(now, 90), subDays(now, 7)]);

      recentTransactionsResult.rows.forEach(txn => {
        notifications.push({
          id: `unusual_${txn.identifier}`,
          type: NOTIFICATION_TYPES.UNUSUAL_SPENDING,
          severity: SEVERITY_LEVELS.WARNING,
          title: 'Unusual Spending Detected',
          message: `₪${txn.amount.toLocaleString()} spent at ${txn.vendor} (${txn.category}) - ${(txn.z_score * 100).toFixed(0)}% above average`,
          data: {
            transaction_id: txn.identifier,
            vendor: txn.vendor,
            amount: txn.amount,
            category: txn.category,
            date: txn.date,
            deviation: txn.z_score
          },
          timestamp: txn.date,
          actionable: true,
          actions: [
            { label: 'View Transaction', action: 'view_transaction', params: { id: txn.identifier } },
            { label: 'Categorize', action: 'categorize_transaction', params: { id: txn.identifier } }
          ]
        });
      });
    }

    // 3. High Value Transactions
    if (type === 'all' || type === NOTIFICATION_TYPES.HIGH_TRANSACTION) {
      const highTransactionsResult = await client.query(`
        WITH spending_threshold AS (
          SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ABS(price)) as threshold
          FROM transactions t
          WHERE t.date >= $1
          AND t.price < 0
          ${duplicateFilter}
        )
        SELECT
          t.identifier,
          t.vendor,
          t.name,
          t.date,
          ABS(t.price) as amount,
          COALESCE(t.parent_category, t.category) as category
        FROM transactions t, spending_threshold st
        WHERE t.date >= $2
        AND t.price < 0
        AND ABS(t.price) >= st.threshold
        ${duplicateFilter}
        ORDER BY t.date DESC
        LIMIT 5
      `, [subDays(now, 30), subDays(now, 3)]);

      highTransactionsResult.rows.forEach(txn => {
        notifications.push({
          id: `high_${txn.identifier}`,
          type: NOTIFICATION_TYPES.HIGH_TRANSACTION,
          severity: SEVERITY_LEVELS.INFO,
          title: 'Large Transaction',
          message: `₪${txn.amount.toLocaleString()} transaction at ${txn.vendor} on ${format(new Date(txn.date), 'MMM dd')}`,
          data: {
            transaction_id: txn.identifier,
            vendor: txn.vendor,
            amount: txn.amount,
            category: txn.category,
            date: txn.date
          },
          timestamp: txn.date,
          actionable: true,
          actions: [
            { label: 'View Details', action: 'view_transaction', params: { id: txn.identifier } }
          ]
        });
      });
    }

    // 4. New Vendor Detection
    if (type === 'all' || type === NOTIFICATION_TYPES.NEW_VENDOR) {
      const newVendorsResult = await client.query(`
        WITH vendor_first_seen AS (
          SELECT
            vendor,
            MIN(date) as first_transaction,
            COUNT(*) as transaction_count,
            SUM(ABS(price)) as total_amount
          FROM transactions t
          WHERE ${duplicateFilter.replace('AND', 'WHERE').substring(5)}
          GROUP BY vendor
        )
        SELECT *
        FROM vendor_first_seen
        WHERE first_transaction >= $1
        AND transaction_count >= 2
        ORDER BY first_transaction DESC
        LIMIT 5
      `, [subDays(now, 7)]);

      newVendorsResult.rows.forEach(vendor => {
        notifications.push({
          id: `vendor_${vendor.vendor}`,
          type: NOTIFICATION_TYPES.NEW_VENDOR,
          severity: SEVERITY_LEVELS.INFO,
          title: 'New Vendor',
          message: `First transaction with ${vendor.vendor} - ₪${vendor.total_amount.toLocaleString()} across ${vendor.transaction_count} transactions`,
          data: {
            vendor: vendor.vendor,
            first_seen: vendor.first_transaction,
            transaction_count: vendor.transaction_count,
            total_amount: vendor.total_amount
          },
          timestamp: vendor.first_transaction,
          actionable: true,
          actions: [
            { label: 'View Vendor', action: 'view_vendor', params: { vendor: vendor.vendor } },
            { label: 'Set Category Rule', action: 'create_rule', params: { vendor: vendor.vendor } }
          ]
        });
      });
    }

    // 5. Cash Flow Alert (if spending rate suggests running low)
    if (type === 'all' || type === NOTIFICATION_TYPES.CASH_FLOW_ALERT) {
      const cashFlowResult = await client.query(`
        WITH monthly_flow AS (
          SELECT
            SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as income,
            SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as expenses
          FROM transactions t
          WHERE t.date >= $1
          AND t.date <= $2
          ${duplicateFilter}
        ),
        recent_daily_spending AS (
          SELECT AVG(daily_spending) as avg_daily_spending
          FROM (
            SELECT
              DATE(date) as day,
              SUM(ABS(price)) as daily_spending
            FROM transactions t
            WHERE t.date >= $3
            AND t.price < 0
            ${duplicateFilter}
            GROUP BY DATE(date)
          ) daily_totals
        )
        SELECT
          mf.income,
          mf.expenses,
          mf.income - mf.expenses as net_flow,
          rds.avg_daily_spending,
          (mf.income - mf.expenses) / NULLIF(rds.avg_daily_spending, 0) as days_remaining
        FROM monthly_flow mf, recent_daily_spending rds
      `, [currentMonth.start, currentMonth.end, subDays(now, 7)]);

      const cashFlow = cashFlowResult.rows[0];
      if (cashFlow && cashFlow.days_remaining < 10 && cashFlow.net_flow > 0) {
        notifications.push({
          id: 'cash_flow_warning',
          type: NOTIFICATION_TYPES.CASH_FLOW_ALERT,
          severity: SEVERITY_LEVELS.WARNING,
          title: 'Cash Flow Alert',
          message: `At current spending rate, remaining budget will last ${Math.round(cashFlow.days_remaining)} days`,
          data: {
            net_flow: cashFlow.net_flow,
            daily_spending: cashFlow.avg_daily_spending,
            days_remaining: cashFlow.days_remaining,
            income: cashFlow.income,
            expenses: cashFlow.expenses
          },
          timestamp: now.toISOString(),
          actionable: true,
          actions: [
            { label: 'View Budget', action: 'view_budgets' },
            { label: 'Analyze Spending', action: 'view_analytics' }
          ]
        });
      }
    }

    // Filter by severity if specified
    let filteredNotifications = notifications;
    if (severity !== 'all') {
      filteredNotifications = notifications.filter(n => n.severity === severity);
    }

    // Sort by severity (critical first), then by timestamp (newest first)
    const severityOrder = { critical: 3, warning: 2, info: 1 };
    filteredNotifications.sort((a, b) => {
      const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
      if (severityDiff !== 0) return severityDiff;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    // Apply limit
    const limitedNotifications = filteredNotifications.slice(0, parseInt(limit));

    const response = standardizeResponse({
      notifications: limitedNotifications,
      summary: {
        total: limitedNotifications.length,
        by_type: Object.values(NOTIFICATION_TYPES).reduce((acc, type) => {
          acc[type] = limitedNotifications.filter(n => n.type === type).length;
          return acc;
        }, {}),
        by_severity: Object.values(SEVERITY_LEVELS).reduce((acc, sev) => {
          acc[sev] = limitedNotifications.filter(n => n.severity === sev).length;
          return acc;
        }, {})
      }
    }, {
      generated_at: now.toISOString(),
      filters: { type, severity, limit: parseInt(limit) }
    });

    res.status(200).json(response);

  } catch (error) {
    console.error('Error generating notifications:', error);
    res.status(500).json(
      standardizeError('Failed to generate notifications', 'NOTIFICATION_ERROR', {
        message: error.message
      })
    );
  } finally {
    client.release();
  }
}