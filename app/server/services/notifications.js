const database = require('./database.js');
const { standardizeResponse, standardizeError } = require('../../lib/server/query-utils.js');

const NOTIFICATION_TYPES = {
  BUDGET_WARNING: 'budget_warning',
  BUDGET_EXCEEDED: 'budget_exceeded',
  UNUSUAL_SPENDING: 'unusual_spending',
  HIGH_TRANSACTION: 'high_transaction',
  RECURRING_DUE: 'recurring_due',
  GOAL_MILESTONE: 'goal_milestone',
  CASH_FLOW_ALERT: 'cash_flow_alert',
  NEW_VENDOR: 'new_vendor',
};

const SEVERITY_LEVELS = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
};

function toISODate(date) {
  return date.toISOString().split('T')[0];
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function subDays(date, days) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() - days);
  return result;
}

function formatShortMonthDay(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
  }).format(date);
}

function isMissingCategoryIdColumnError(error) {
  if (!error || !error.message) return false;
  return error.message.includes('category_definition_id');
}

async function calculateSpentForCategory(client, { categoryDefinitionId, categoryName }, startDate, endDate) {
  if (categoryDefinitionId) {
    const result = await client.query(
      `WITH RECURSIVE category_tree(id) AS (
          SELECT id FROM category_definitions WHERE id = $1
          UNION ALL
          SELECT cd.id
          FROM category_definitions cd
          JOIN category_tree ct ON cd.parent_id = ct.id
        )
       SELECT COALESCE(SUM(ABS(price)), 0) AS spent
       FROM transactions t
       WHERE t.category_definition_id IN (SELECT id FROM category_tree)
         AND t.price < 0
         AND t.date >= $2
         AND t.date <= $3`,
      [categoryDefinitionId, startDate, endDate],
    );

    return Number.parseFloat(result.rows[0].spent || 0);
  }

  if (!categoryName) {
    return 0;
  }

  const fallbackResult = await client.query(
    `WITH RECURSIVE category_tree AS (
        SELECT id
        FROM category_definitions
        WHERE LOWER(name) = LOWER($1) OR LOWER(name_en) = LOWER($1)
      UNION ALL
        SELECT cd.id
        FROM category_definitions cd
        JOIN category_tree ct ON cd.parent_id = ct.id
      )
     SELECT COALESCE(SUM(ABS(t.price)), 0) AS spent
     FROM transactions t
     WHERE t.category_definition_id IN (SELECT id FROM category_tree)
       AND t.price < 0
       AND t.date >= $2
       AND t.date <= $3`,
    [categoryName, startDate, endDate],
  );

  return Number.parseFloat(fallbackResult.rows[0].spent || 0);
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function computeCategoryStatsForNotifications(transactions, minCount) {
  const stats = new Map();

  transactions.forEach((txn) => {
    const categoryName = txn.categoryName || 'Uncategorized';
    const categoryDefinitionId =
      typeof txn.categoryDefinitionId === 'number' && !Number.isNaN(txn.categoryDefinitionId)
        ? txn.categoryDefinitionId
        : null;
    const categoryKey = categoryDefinitionId !== null ? `id:${categoryDefinitionId}` : `legacy:${categoryName}`;

    if (!stats.has(categoryKey)) {
      stats.set(categoryKey, {
        sum: 0,
        sumSquares: 0,
        count: 0,
        categoryName,
        categoryDefinitionId,
      });
    }
    const entry = stats.get(categoryKey);
    entry.sum += txn.amount;
    entry.sumSquares += txn.amount * txn.amount;
    entry.count += 1;
  });

  const result = new Map();
  stats.forEach((entry, key) => {
    if (entry.count < (minCount || 1)) return;
    const mean = entry.sum / entry.count;
    const variance = entry.count > 1 ? entry.sumSquares / entry.count - mean * mean : 0;
    const stdDev = variance > 0 ? Math.sqrt(variance) : 0;
    result.set(key, {
      mean,
      stdDev,
      count: entry.count,
      categoryName: entry.categoryName,
      categoryDefinitionId: entry.categoryDefinitionId,
    });
  });

  return result;
}

async function getNotifications(query = {}) {
  const {
    type = 'all',
    severity = 'all',
    limit = 50,
    include_dismissed = 'false', // Placeholder for future use
  } = query;

  const limitInt = Number.parseInt(limit, 10) || 50;
  const notifications = [];
  const now = new Date();
  const currentMonth = {
    start: startOfMonth(now),
    end: endOfMonth(now),
  };
  const currentMonthStartStr = toISODate(currentMonth.start);
  const currentMonthEndStr = toISODate(currentMonth.end);

  const client = await database.getClient();

  try {
    // 1. Budget warnings/exceeded alerts
    if (
      type === 'all' ||
      type === NOTIFICATION_TYPES.BUDGET_WARNING ||
      type === NOTIFICATION_TYPES.BUDGET_EXCEEDED
    ) {
      let budgetsResult;
      let legacyBudgetSchema = false;
      let categoryLookupByName = null;
      let categoryLookupById = null;

      try {
        budgetsResult = await client.query(
          `SELECT
             cb.id,
             cb.category_definition_id,
             cb.budget_limit,
             cd.name AS category_name,
             parent.name AS parent_category_name
           FROM category_budgets cb
           JOIN category_definitions cd ON cd.id = cb.category_definition_id
           LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
           WHERE cb.is_active = true
             AND cb.period_type = 'monthly'`,
        );
      } catch (error) {
        if (!isMissingCategoryIdColumnError(error)) {
          throw error;
        }

        legacyBudgetSchema = true;
        budgetsResult = await client.query(
          `SELECT
             cb.id,
             cb.category AS legacy_category,
             cb.budget_limit
           FROM category_budgets cb
           WHERE cb.is_active = true
             AND cb.period_type = 'monthly'`,
        );

        const categoryRows = await client.query(
          `SELECT id, name, name_en, parent_id FROM category_definitions`,
        );
        categoryLookupByName = new Map();
        categoryLookupById = new Map();
        categoryRows.rows.forEach((row) => {
          categoryLookupByName.set(row.name, row);
          categoryLookupById.set(row.id, row);
        });
      }

      for (const budget of budgetsResult.rows) {
        const budgetLimit = Number.parseFloat(budget.budget_limit || 0);
        if (budgetLimit <= 0) continue;

        let categoryId = budget.category_definition_id || null;
        let categoryName = budget.category_name || null;
        let parentCategoryName = budget.parent_category_name || null;

        if (legacyBudgetSchema) {
          const legacyCategory = budget.legacy_category;
          const mappedCategory = legacyCategory ? categoryLookupByName.get(legacyCategory) : null;
          categoryId = mappedCategory?.id || null;
          categoryName = legacyCategory || mappedCategory?.name || null;
          const parentRow = mappedCategory?.parent_id ? categoryLookupById.get(mappedCategory.parent_id) : null;
          parentCategoryName = parentRow?.name || null;
        }

        const spent = await calculateSpentForCategory(
          client,
          { categoryDefinitionId: categoryId, categoryName },
          currentMonthStartStr,
          currentMonthEndStr,
        );

        const usagePercentage = (spent / budgetLimit) * 100;
        if (usagePercentage < 75) continue;

        const isExceeded = usagePercentage >= 100;
        notifications.push({
          id: `budget_${categoryId || budget.id}`,
          type: isExceeded ? NOTIFICATION_TYPES.BUDGET_EXCEEDED : NOTIFICATION_TYPES.BUDGET_WARNING,
          severity: isExceeded ? SEVERITY_LEVELS.CRITICAL : SEVERITY_LEVELS.WARNING,
          title: isExceeded ? 'Budget Exceeded!' : 'Budget Warning',
          message: `${categoryName || 'Unknown Category'}: ${usagePercentage.toFixed(1)}% of budget used (₪${spent.toLocaleString()} / ₪${budgetLimit.toLocaleString()})`,
          data: {
            category_definition_id: categoryId,
            category_name: categoryName,
            spent,
            budget: budgetLimit,
            percentage: usagePercentage,
            parent_category_name: parentCategoryName,
          },
          timestamp: now.toISOString(),
          actionable: true,
          actions: categoryId
            ? [
                { label: 'View Details', action: 'view_category', params: { category_definition_id: categoryId } },
                { label: 'Adjust Budget', action: 'edit_budget', params: { category_definition_id: categoryId } },
              ]
            : [{ label: 'Adjust Budget', action: 'edit_budget', params: { category: categoryName } }],
        });
      }
    }

    // 2. Unusual spending detection
    if (type === 'all' || type === NOTIFICATION_TYPES.UNUSUAL_SPENDING) {
      const ninetyDaysStr = toISODate(subDays(now, 90));
      const sevenDaysAgo = subDays(now, 7);

      const transactionsResult = await client.query(
        `SELECT
          t.identifier,
          t.vendor,
          t.name,
          t.date,
          ABS(t.price) AS amount,
          COALESCE(parent.id, cd.id) AS resolved_category_id,
          COALESCE(parent.name, cd.name, 'Uncategorized') AS resolved_category_name
        FROM transactions t
        LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
        LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
        WHERE t.date >= $1
          AND t.price < 0
        ORDER BY t.date DESC
        LIMIT 1000`,
        [ninetyDaysStr],
      );

      const transactions = transactionsResult.rows.map((row) => {
        const date = new Date(row.date);
        const amount = Number.parseFloat(row.amount);
        const resolvedId = row.resolved_category_id;
        const categoryDefinitionId =
          resolvedId === null || resolvedId === undefined ? null : Number(resolvedId);
        const normalizedCategoryId =
          categoryDefinitionId !== null && !Number.isNaN(categoryDefinitionId) ? categoryDefinitionId : null;
        const categoryName = row.resolved_category_name || 'Uncategorized';

        return {
          identifier: row.identifier,
          vendor: row.vendor,
          name: row.name,
          date,
          amount,
          categoryDefinitionId: normalizedCategoryId,
          categoryName,
        };
      });

      const categoryStats = computeCategoryStatsForNotifications(transactions, 5);

      transactions
        .filter((txn) => txn.date >= sevenDaysAgo)
        .forEach((txn) => {
          const categoryKey =
            typeof txn.categoryDefinitionId === 'number' && !Number.isNaN(txn.categoryDefinitionId)
              ? `id:${txn.categoryDefinitionId}`
              : `legacy:${txn.categoryName || 'Uncategorized'}`;
          const stats = categoryStats.get(categoryKey);
          if (!stats || stats.stdDev <= 0) return;
          const zScore = (txn.amount - stats.mean) / stats.stdDev;
          if (zScore <= 2.5) return;

          const categoryName = txn.categoryName || 'Uncategorized';

          notifications.push({
            id: `unusual_${txn.identifier}`,
            type: NOTIFICATION_TYPES.UNUSUAL_SPENDING,
            severity: SEVERITY_LEVELS.WARNING,
            title: 'Unusual Spending Detected',
            message: `₪${txn.amount.toLocaleString()} spent at ${txn.vendor} (${categoryName}) - ${(zScore * 100).toFixed(0)}% above average`,
            data: {
              transaction_id: txn.identifier,
              vendor: txn.vendor,
              amount: txn.amount,
              category_definition_id: txn.categoryDefinitionId,
              category_name: categoryName,
              date: txn.date,
              deviation: zScore,
            },
            timestamp: txn.date.toISOString(),
            actionable: true,
            actions: [
              { label: 'View Transaction', action: 'view_transaction', params: { id: txn.identifier } },
              { label: 'Categorize', action: 'categorize_transaction', params: { id: txn.identifier } },
            ],
          });
        });
    }

    // 3. High-value transactions
    if (type === 'all' || type === NOTIFICATION_TYPES.HIGH_TRANSACTION) {
      const thirtyDaysStr = toISODate(subDays(now, 30));
      const threeDaysAgo = subDays(now, 3);

      const highTxResult = await client.query(
        `SELECT
          t.identifier,
          t.vendor,
          t.name,
          t.date,
          ABS(t.price) AS amount,
          COALESCE(parent.id, cd.id) AS resolved_category_id,
          COALESCE(parent.name, cd.name, 'Uncategorized') AS resolved_category_name
        FROM transactions t
        LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
        LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
        WHERE t.date >= $1
          AND t.price < 0
        ORDER BY t.date DESC
        LIMIT 1000`,
        [thirtyDaysStr],
      );

      const highTransactions = highTxResult.rows.map((row) => {
        const date = new Date(row.date);
        const amount = Number.parseFloat(row.amount);
        const resolvedId = row.resolved_category_id;
        const categoryDefinitionId =
          resolvedId === null || resolvedId === undefined ? null : Number(resolvedId);
        const normalizedCategoryId =
          categoryDefinitionId !== null && !Number.isNaN(categoryDefinitionId) ? categoryDefinitionId : null;
        const categoryName = row.resolved_category_name || 'Uncategorized';

        return {
          identifier: row.identifier,
          vendor: row.vendor,
          name: row.name,
          date,
          amount,
          categoryDefinitionId: normalizedCategoryId,
          categoryName,
        };
      });

      const amountList = highTransactions.map((txn) => txn.amount);
      if (amountList.length > 0) {
        const threshold = percentile(amountList, 0.95);
        highTransactions
          .filter((txn) => txn.date >= threeDaysAgo && txn.amount >= threshold)
          .slice(0, 5)
          .forEach((txn) => {
            notifications.push({
              id: `high_${txn.identifier}`,
              type: NOTIFICATION_TYPES.HIGH_TRANSACTION,
              severity: SEVERITY_LEVELS.INFO,
              title: 'Large Transaction',
              message: `₪${txn.amount.toLocaleString()} transaction at ${txn.vendor} on ${formatShortMonthDay(txn.date)}`,
              data: {
                transaction_id: txn.identifier,
                vendor: txn.vendor,
                amount: txn.amount,
                category_definition_id: txn.categoryDefinitionId,
                category_name: txn.categoryName,
                date: txn.date,
              },
              timestamp: txn.date.toISOString(),
              actionable: true,
              actions: [{ label: 'View Details', action: 'view_transaction', params: { id: txn.identifier } }],
            });
          });
      }
    }

    // 4. New vendor detection
    if (type === 'all' || type === NOTIFICATION_TYPES.NEW_VENDOR) {
      const newVendorThreshold = toISODate(subDays(now, 7));
      const newVendorsResult = await client.query(
        `SELECT
          t.vendor,
          MIN(t.date) as first_transaction,
          COUNT(*) as transaction_count,
          SUM(ABS(t.price)) as total_amount
        FROM transactions t
        WHERE t.price < 0
        GROUP BY t.vendor
        HAVING MIN(t.date) >= $1 AND COUNT(*) >= 2
        ORDER BY first_transaction DESC
        LIMIT 5`,
        [newVendorThreshold],
      );

      newVendorsResult.rows.forEach((vendor) => {
        const totalAmount = Number.parseFloat(vendor.total_amount || 0);
        const transactionCount = Number.parseInt(vendor.transaction_count || 0, 10) || 0;
        const firstTransactionDate = new Date(vendor.first_transaction);
        notifications.push({
          id: `vendor_${vendor.vendor}`,
          type: NOTIFICATION_TYPES.NEW_VENDOR,
          severity: SEVERITY_LEVELS.INFO,
          title: 'New Vendor',
          message: `First transaction with ${vendor.vendor} - ₪${totalAmount.toLocaleString()} across ${transactionCount} transactions`,
          data: {
            vendor: vendor.vendor,
            first_seen: firstTransactionDate,
            transaction_count: transactionCount,
            total_amount: totalAmount,
          },
          timestamp: firstTransactionDate.toISOString(),
          actionable: true,
          actions: [
            { label: 'View Vendor', action: 'view_vendor', params: { vendor: vendor.vendor } },
            { label: 'Set Category Rule', action: 'create_rule', params: { vendor: vendor.vendor } },
          ],
        });
      });
    }

    // 5. Cash flow alert
    if (type === 'all' || type === NOTIFICATION_TYPES.CASH_FLOW_ALERT) {
      const thirtyDaysAgoStr = toISODate(subDays(now, 30));
      const fifteenDaysAgoStr = toISODate(subDays(now, 15));

      const cashFlowResult = await client.query(
        `
        WITH monthly_flow AS (
          SELECT
            SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as income,
            SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as expenses
          FROM transactions t
          WHERE t.date >= $1
          AND t.date <= $2
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
            GROUP BY DATE(date)
          ) daily_totals
        )
        SELECT
          income,
          expenses,
          (income - expenses) as net_flow,
          avg_daily_spending
        FROM monthly_flow, recent_daily_spending`,
        [currentMonthStartStr, currentMonthEndStr, fifteenDaysAgoStr],
      );

      const cashFlow = cashFlowResult.rows[0];
      if (cashFlow) {
        const income = Number.parseFloat(cashFlow.income || 0);
        const expenses = Number.parseFloat(cashFlow.expenses || 0);
        const netFlow = income - expenses;
        const avgDailySpending = Number.parseFloat(cashFlow.avg_daily_spending || 0);
        const daysRemaining = avgDailySpending > 0 ? (income - expenses) / avgDailySpending : Number.POSITIVE_INFINITY;

        if (daysRemaining < 10 && netFlow > 0) {
          notifications.push({
            id: 'cash_flow_warning',
            type: NOTIFICATION_TYPES.CASH_FLOW_ALERT,
            severity: SEVERITY_LEVELS.WARNING,
            title: 'Cash Flow Alert',
            message: `At current spending rate, remaining budget will last ${Math.round(daysRemaining)} days`,
            data: {
              net_flow: netFlow,
              daily_spending: avgDailySpending,
              days_remaining: daysRemaining,
              income,
              expenses,
            },
            timestamp: now.toISOString(),
            actionable: true,
            actions: [
              { label: 'View Budget', action: 'view_budgets' },
              { label: 'Analyze Spending', action: 'view_analytics' },
            ],
          });
        }
      }
    }

    let filteredNotifications = notifications;
    if (severity !== 'all') {
      filteredNotifications = notifications.filter((n) => n.severity === severity);
    }

    const severityOrder = { critical: 3, warning: 2, info: 1 };
    filteredNotifications.sort((a, b) => {
      const severityDiff = (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
      if (severityDiff !== 0) return severityDiff;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    const limitedNotifications = filteredNotifications.slice(0, limitInt);

    return standardizeResponse(
      {
        notifications: limitedNotifications,
        summary: {
          total: limitedNotifications.length,
          by_type: Object.values(NOTIFICATION_TYPES).reduce((acc, notificationType) => {
            acc[notificationType] = limitedNotifications.filter((n) => n.type === notificationType).length;
            return acc;
          }, {}),
          by_severity: Object.values(SEVERITY_LEVELS).reduce((acc, sev) => {
            acc[sev] = limitedNotifications.filter((n) => n.severity === sev).length;
            return acc;
          }, {}),
        },
      },
      {
        generated_at: now.toISOString(),
        filters: { type, severity, limit: limitInt, include_dismissed },
      },
    );
  } catch (error) {
    throw standardizeError('Failed to generate notifications', 'NOTIFICATION_ERROR', {
      message: error.message,
    });
  } finally {
    if (typeof client.release === 'function') {
      client.release();
    }
  }
}

module.exports = {
  getNotifications,
};
module.exports.default = module.exports;
