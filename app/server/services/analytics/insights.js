const { performance } = require('node:perf_hooks');
const actualDatabase = require('../database.js');
const { resolveDateRange } = require('../../../lib/server/query-utils.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');
const { dialect } = require('../../../lib/sql-dialect.js');
const { createTtlCache } = require('../../../lib/server/ttl-cache.js');

let database = actualDatabase;
const insightsCache = createTtlCache({ maxEntries: 25, defaultTtlMs: 60 * 1000 });

let dateFnsPromise = null;

async function loadDateFns() {
  if (!dateFnsPromise) {
    dateFnsPromise = import('date-fns');
  }
  return dateFnsPromise;
}

/**
 * Get daily insights (today's activity)
 */
async function getDailyInsights(todayStart, todayEnd, avgDailyStart) {
  const {
    startOfDay,
    endOfDay,
    subDays,
  } = await loadDateFns();

  const today = new Date();
  const start = todayStart || startOfDay(today);
  const end = todayEnd || endOfDay(today);

  // Get today's spending
  const todayResult = await database.query(
    `SELECT
      COUNT(t.identifier) as transaction_count,
      SUM(CASE WHEN t.price < 0 THEN ABS(t.price) ELSE 0 END) as spent_today
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE t.date >= $1 AND t.date <= $2
      AND t.price < 0
      AND (cd.category_type = 'expense' OR cd.category_type IS NULL)
      AND COALESCE(cd.name, '') != $3
      AND COALESCE(parent.name, '') != $3
      AND tpe.transaction_identifier IS NULL
      AND ${dialect.excludePikadon('t')}`,
    [start, end, BANK_CATEGORY_NAME]
  );

  const spentToday = parseFloat(todayResult.rows[0]?.spent_today || 0);
  const transactionCount = parseInt(todayResult.rows[0]?.transaction_count || 0, 10);

  // Get average daily spending over the last 30 days
  const avgStart = avgDailyStart || subDays(today, 30);
  const avgResult = await database.query(
    `SELECT
      AVG(daily_total) as avg_daily_spend
    FROM (
      SELECT
        ${dialect.dateTrunc('day', 't.date')} as day,
        SUM(CASE WHEN t.price < 0 THEN ABS(t.price) ELSE 0 END) as daily_total
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date < $2
        AND t.price < 0
        AND (cd.category_type = 'expense' OR cd.category_type IS NULL)
        AND COALESCE(cd.name, '') != $3
        AND COALESCE(parent.name, '') != $3
        AND tpe.transaction_identifier IS NULL
        AND ${dialect.excludePikadon('t')}
      GROUP BY ${dialect.dateTrunc('day', 't.date')}
    ) daily_totals`,
    [avgStart, start, BANK_CATEGORY_NAME]
  );

  const avgDailySpend = parseFloat(avgResult.rows[0]?.avg_daily_spend || 0);
  const percentOfAverage = avgDailySpend > 0 ? (spentToday / avgDailySpend) * 100 : 0;

  // Get top category for today
  const topCategoryResult = await database.query(
    `SELECT
      COALESCE(parent.name, cd.name) as category_name,
      SUM(ABS(t.price)) as amount
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE t.date >= $1 AND t.date <= $2
      AND t.price < 0
      AND (cd.category_type = 'expense' OR cd.category_type IS NULL)
      AND COALESCE(cd.name, '') != $3
      AND COALESCE(parent.name, '') != $3
      AND tpe.transaction_identifier IS NULL
      AND ${dialect.excludePikadon('t')}
    GROUP BY COALESCE(parent.name, cd.name)
    ORDER BY amount DESC
    LIMIT 1`,
    [start, end, BANK_CATEGORY_NAME]
  );

  const topCategory = topCategoryResult.rows[0] ? {
    name: topCategoryResult.rows[0].category_name || 'Uncategorized',
    amount: parseFloat(topCategoryResult.rows[0].amount || 0)
  } : null;

  // Determine velocity status
  let velocityStatus = 'normal';
  if (percentOfAverage < 50) {
    velocityStatus = 'low';
  } else if (percentOfAverage > 150) {
    velocityStatus = 'high';
  }

  return {
    spentToday,
    avgDailySpend,
    percentOfAverage: Math.round(percentOfAverage),
    transactionCount,
    topCategory,
    velocityStatus
  };
}

/**
 * Get weekly insights (this week vs last week)
 */
async function getWeeklyInsights() {
  const {
    startOfWeek,
    endOfWeek,
    subWeeks,
  } = await loadDateFns();

  const now = new Date();
  const thisWeekStart = startOfWeek(now, { weekStartsOn: 0 }); // Sunday
  const thisWeekEnd = endOfWeek(now, { weekStartsOn: 0 });
  const lastWeekStart = subWeeks(thisWeekStart, 1);
  const lastWeekEnd = subWeeks(thisWeekEnd, 1);

  // Get this week's spending
  const thisWeekResult = await database.query(
    `SELECT
      SUM(CASE WHEN t.price < 0 THEN ABS(t.price) ELSE 0 END) as spent
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE t.date >= $1 AND t.date <= $2
      AND t.price < 0
      AND (cd.category_type = 'expense' OR cd.category_type IS NULL)
      AND COALESCE(cd.name, '') != $3
      AND COALESCE(parent.name, '') != $3
      AND tpe.transaction_identifier IS NULL
      AND ${dialect.excludePikadon('t')}`,
    [thisWeekStart, thisWeekEnd, BANK_CATEGORY_NAME]
  );

  // Get last week's spending
  const lastWeekResult = await database.query(
    `SELECT
      SUM(CASE WHEN t.price < 0 THEN ABS(t.price) ELSE 0 END) as spent
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE t.date >= $1 AND t.date <= $2
      AND t.price < 0
      AND (cd.category_type = 'expense' OR cd.category_type IS NULL)
      AND COALESCE(cd.name, '') != $3
      AND COALESCE(parent.name, '') != $3
      AND tpe.transaction_identifier IS NULL
      AND ${dialect.excludePikadon('t')}`,
    [lastWeekStart, lastWeekEnd, BANK_CATEGORY_NAME]
  );

  const spentThisWeek = parseFloat(thisWeekResult.rows[0]?.spent || 0);
  const spentLastWeek = parseFloat(lastWeekResult.rows[0]?.spent || 0);
  const weekOverWeekChange = spentLastWeek > 0
    ? ((spentThisWeek - spentLastWeek) / spentLastWeek) * 100
    : 0;

  // Get top 3 categories for this week with change
  const topCategoriesResult = await database.query(
    `SELECT
      COALESCE(parent.name, cd.name) as category_name,
      SUM(ABS(t.price)) as amount
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE t.date >= $1 AND t.date <= $2
      AND t.price < 0
      AND (cd.category_type = 'expense' OR cd.category_type IS NULL)
      AND COALESCE(cd.name, '') != $3
      AND COALESCE(parent.name, '') != $3
      AND tpe.transaction_identifier IS NULL
      AND ${dialect.excludePikadon('t')}
    GROUP BY COALESCE(parent.name, cd.name)
    ORDER BY amount DESC
    LIMIT 3`,
    [thisWeekStart, thisWeekEnd, BANK_CATEGORY_NAME]
  );

  // Get last week's spending per category for comparison
  const lastWeekCategoriesResult = await database.query(
    `SELECT
      COALESCE(parent.name, cd.name) as category_name,
      SUM(ABS(t.price)) as amount
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE t.date >= $1 AND t.date <= $2
      AND t.price < 0
      AND (cd.category_type = 'expense' OR cd.category_type IS NULL)
      AND COALESCE(cd.name, '') != $3
      AND COALESCE(parent.name, '') != $3
      AND tpe.transaction_identifier IS NULL
      AND ${dialect.excludePikadon('t')}
    GROUP BY COALESCE(parent.name, cd.name)`,
    [lastWeekStart, lastWeekEnd, BANK_CATEGORY_NAME]
  );

  // Create a map of last week's category spending
  const lastWeekCategoryMap = new Map();
  lastWeekCategoriesResult.rows.forEach(row => {
    lastWeekCategoryMap.set(row.category_name, parseFloat(row.amount || 0));
  });

  const topCategories = topCategoriesResult.rows.map(row => {
    const categoryName = row.category_name || 'Uncategorized';
    const thisWeekAmount = parseFloat(row.amount || 0);
    const lastWeekAmount = lastWeekCategoryMap.get(categoryName) || 0;

    // Calculate percentage change
    let change = 0;
    if (lastWeekAmount > 0) {
      change = Math.round(((thisWeekAmount - lastWeekAmount) / lastWeekAmount) * 100);
    } else if (thisWeekAmount > 0) {
      change = 100; // New category this week
    }

    return {
      name: categoryName,
      amount: thisWeekAmount,
      change
    };
  });

  // Get weekend vs weekday spending
  const weekdayWeekendResult = await database.query(
    `SELECT
      CASE
        WHEN ${dialect.extract('dow', 't.date')} IN (0, 6) THEN 'weekend'
        ELSE 'weekday'
      END as period_type,
      SUM(CASE WHEN t.price < 0 THEN ABS(t.price) ELSE 0 END) as spent
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE t.date >= $1 AND t.date <= $2
      AND t.price < 0
      AND (cd.category_type = 'expense' OR cd.category_type IS NULL)
      AND COALESCE(cd.name, '') != $3
      AND COALESCE(parent.name, '') != $3
      AND tpe.transaction_identifier IS NULL
      AND ${dialect.excludePikadon('t')}
    GROUP BY period_type`,
    [thisWeekStart, thisWeekEnd, BANK_CATEGORY_NAME]
  );

  let weekendSpend = 0;
  let weekdaySpend = 0;
  weekdayWeekendResult.rows.forEach(row => {
    const amount = parseFloat(row.spent || 0);
    if (row.period_type === 'weekend') {
      weekendSpend = amount;
    } else {
      weekdaySpend = amount;
    }
  });

  return {
    spentThisWeek,
    spentLastWeek,
    weekOverWeekChange: Math.round(weekOverWeekChange),
    topCategories,
    weekendSpend,
    weekdaySpend
  };
}

/**
 * Get monthly insights (this month progress)
 */
async function getMonthlyInsights() {
  const {
    startOfMonth,
    endOfMonth,
    differenceInDays,
    getDaysInMonth,
    subMonths,
  } = await loadDateFns();

  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const thisMonthEnd = endOfMonth(now);
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  const lastMonthEnd = endOfMonth(subMonths(now, 1));

  const daysElapsed = differenceInDays(now, thisMonthStart) + 1;
  const daysInMonth = getDaysInMonth(now);
  const daysRemaining = daysInMonth - daysElapsed;

  // Get this month's spending
  const thisMonthResult = await database.query(
    `SELECT
      SUM(CASE WHEN t.price < 0 THEN ABS(t.price) ELSE 0 END) as spent,
      SUM(CASE WHEN t.price > 0 THEN t.price ELSE 0 END) as income
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE t.date >= $1 AND t.date <= $2
      AND COALESCE(cd.name, '') != $3
      AND COALESCE(parent.name, '') != $3
      AND tpe.transaction_identifier IS NULL
      AND ${dialect.excludePikadon('t')}`,
    [thisMonthStart, now, BANK_CATEGORY_NAME]
  );

  // Get last month's total
  const lastMonthResult = await database.query(
    `SELECT
      SUM(CASE WHEN t.price < 0 THEN ABS(t.price) ELSE 0 END) as spent
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE t.date >= $1 AND t.date <= $2
      AND t.price < 0
      AND (cd.category_type = 'expense' OR cd.category_type IS NULL)
      AND COALESCE(cd.name, '') != $3
      AND COALESCE(parent.name, '') != $3
      AND tpe.transaction_identifier IS NULL
      AND ${dialect.excludePikadon('t')}`,
    [lastMonthStart, lastMonthEnd, BANK_CATEGORY_NAME]
  );

  const spentThisMonth = parseFloat(thisMonthResult.rows[0]?.spent || 0);
  const incomeThisMonth = parseFloat(thisMonthResult.rows[0]?.income || 0);
  const lastMonthTotal = parseFloat(lastMonthResult.rows[0]?.spent || 0);

  // Project month-end spending
  const dailyAvg = daysElapsed > 0 ? spentThisMonth / daysElapsed : 0;
  const projectedMonthEnd = dailyAvg * daysInMonth;

  // Calculate savings rate
  const savingsRate = incomeThisMonth > 0
    ? ((incomeThisMonth - spentThisMonth) / incomeThisMonth) * 100
    : 0;

  // Get budget health (budgets on track vs at risk)
  let budgetsOnTrack = 0;
  let budgetsAtRisk = 0;

  try {
    const monthProgress = daysInMonth > 0 ? daysElapsed / daysInMonth : 0;
    const budgetHealthResult = await database.query(
      `SELECT
        COUNT(CASE WHEN spent <= (budget_amount * $3) THEN 1 END) as budgets_on_track,
        COUNT(CASE WHEN spent > (budget_amount * $3) THEN 1 END) as budgets_at_risk
      FROM (
        SELECT
          b.category_definition_id,
          b.amount as budget_amount,
          COALESCE(SUM(ABS(t.price)), 0) as spent
        FROM budgets b
        LEFT JOIN category_definitions cd ON b.category_definition_id = cd.id
        LEFT JOIN transactions t ON t.category_definition_id = cd.id
          AND t.date >= $1 AND t.date <= $2
          AND t.price < 0
        LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
          ON t.identifier = tpe.transaction_identifier
          AND t.vendor = tpe.transaction_vendor
        WHERE b.is_active = true
          AND tpe.transaction_identifier IS NULL
        GROUP BY b.category_definition_id, b.amount
      ) budget_status`,
      [thisMonthStart, now, monthProgress]
    );

    budgetsOnTrack = parseInt(budgetHealthResult.rows[0]?.budgets_on_track || 0, 10);
    budgetsAtRisk = parseInt(budgetHealthResult.rows[0]?.budgets_at_risk || 0, 10);
  } catch (error) {
    // Budgets table might not exist, that's okay - just set to 0
    console.log('Budget health query failed (table may not exist):', error.message);
  }

  return {
    daysElapsed,
    daysRemaining,
    spentThisMonth,
    projectedMonthEnd,
    lastMonthTotal,
    savingsRate: Math.round(savingsRate),
    budgetsOnTrack,
    budgetsAtRisk
  };
}

/**
 * Get lifetime insights (since installation)
 */
async function getLifetimeInsights() {
  const { differenceInMonths, subMonths, startOfMonth, endOfMonth, format } = await loadDateFns();

  const now = new Date();

  // Get first transaction date and total stats
  const lifetimeResult = await database.query(
    `SELECT
      MIN(t.date) as first_transaction_date,
      COUNT(t.identifier) as total_transactions,
      SUM(CASE WHEN t.price < 0 THEN ABS(t.price) ELSE 0 END) as total_spending
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE tpe.transaction_identifier IS NULL
      AND COALESCE(cd.name, '') != $1
      AND COALESCE(parent.name, '') != $1
      AND ${dialect.excludePikadon('t')}`,
    [BANK_CATEGORY_NAME]
  );

  const firstTransactionDate = lifetimeResult.rows[0]?.first_transaction_date
    ? format(new Date(lifetimeResult.rows[0].first_transaction_date), 'yyyy-MM-dd')
    : null;
  const totalTransactions = parseInt(lifetimeResult.rows[0]?.total_transactions || 0, 10);
  const totalSpending = parseFloat(lifetimeResult.rows[0]?.total_spending || 0);

  // Calculate average monthly spend
  const monthsTracking = firstTransactionDate
    ? Math.max(differenceInMonths(now, new Date(firstTransactionDate)), 1)
    : 1;
  const avgMonthlySpend = totalSpending / monthsTracking;

  // Get health score trend (compare last 3 months vs previous 3 months)
  let healthScoreTrend = 'stable';

  try {
    // Recent period: last 3 months
    const recentEnd = endOfMonth(now);
    const recentStart = startOfMonth(subMonths(now, 2));

    // Previous period: 3 months before that
    const previousEnd = endOfMonth(subMonths(now, 3));
    const previousStart = startOfMonth(subMonths(now, 5));

    // Get average savings rate for recent period
    const recentResult = await database.query(
      `SELECT
        SUM(CASE WHEN t.price > 0 THEN t.price ELSE 0 END) as income,
        SUM(CASE WHEN t.price < 0 THEN ABS(t.price) ELSE 0 END) as expenses
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND tpe.transaction_identifier IS NULL
        AND COALESCE(cd.name, '') != $3
        AND COALESCE(parent.name, '') != $3
        AND ${dialect.excludePikadon('t')}`,
      [recentStart, recentEnd, BANK_CATEGORY_NAME]
    );

    // Get average savings rate for previous period
    const previousResult = await database.query(
      `SELECT
        SUM(CASE WHEN t.price > 0 THEN t.price ELSE 0 END) as income,
        SUM(CASE WHEN t.price < 0 THEN ABS(t.price) ELSE 0 END) as expenses
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND tpe.transaction_identifier IS NULL
        AND COALESCE(cd.name, '') != $3
        AND COALESCE(parent.name, '') != $3
        AND ${dialect.excludePikadon('t')}`,
      [previousStart, previousEnd, BANK_CATEGORY_NAME]
    );

    const recentIncome = parseFloat(recentResult.rows[0]?.income || 0);
    const recentExpenses = parseFloat(recentResult.rows[0]?.expenses || 0);
    const previousIncome = parseFloat(previousResult.rows[0]?.income || 0);
    const previousExpenses = parseFloat(previousResult.rows[0]?.expenses || 0);

    const recentSavingsRate = recentIncome > 0 ? ((recentIncome - recentExpenses) / recentIncome) * 100 : 0;
    const previousSavingsRate = previousIncome > 0 ? ((previousIncome - previousExpenses) / previousIncome) * 100 : 0;

    // Determine trend based on savings rate change
    const savingsDiff = recentSavingsRate - previousSavingsRate;
    if (savingsDiff > 5) {
      healthScoreTrend = 'improving';
    } else if (savingsDiff < -5) {
      healthScoreTrend = 'declining';
    }
  } catch (error) {
    console.error('Error calculating health score trend:', error);
    // Keep default 'stable' value
  }

  return {
    firstTransactionDate,
    totalTransactions,
    totalSpending,
    avgMonthlySpend,
    healthScoreTrend
  };
}

/**
 * Main insights function - aggregates all insights
 */
async function getInsights(query = {}) {
  const timerStart = performance.now();
  const { period = 'all' } = query;

  const skipCache =
    process.env.NODE_ENV === 'test' ||
    query.noCache === true ||
    query.noCache === 'true' ||
    query.noCache === '1';

  const cacheKey = JSON.stringify({ period });

  if (!skipCache) {
    const cached = insightsCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    daily: null,
    weekly: null,
    monthly: null,
    lifetime: null
  };

  try {
    // Fetch insights based on requested period
    if (period === 'all' || period === 'daily') {
      result.daily = await getDailyInsights();
    }

    if (period === 'all' || period === 'weekly') {
      result.weekly = await getWeeklyInsights();
    }

    if (period === 'all' || period === 'monthly') {
      result.monthly = await getMonthlyInsights();
    }

    if (period === 'all' || period === 'lifetime') {
      result.lifetime = await getLifetimeInsights();
    }

    const timerEnd = performance.now();
    result.executionTimeMs = Math.round(timerEnd - timerStart);

    if (!skipCache) {
      insightsCache.set(cacheKey, result);
    }

    return result;
  } catch (error) {
    console.error('Error generating insights:', error);
    throw error;
  }
}

module.exports = {
  getInsights,
  getDailyInsights,
  getWeeklyInsights,
  getMonthlyInsights,
  getLifetimeInsights,
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  }
};
