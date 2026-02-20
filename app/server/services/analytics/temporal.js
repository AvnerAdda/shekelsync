const database = require('../database.js');
const { createTtlCache } = require('../../../lib/server/ttl-cache.js');

const temporalCache = createTtlCache({ maxEntries: 10, defaultTtlMs: 60 * 1000 });
const STATUS_FILTER_SQL = "t.status IN ('completed', 'pending')";
const EFFECTIVE_DATETIME_SQL = "COALESCE(t.transaction_datetime, t.date)";
const LOCAL_EFFECTIVE_DATETIME_SQL = `datetime(${EFFECTIVE_DATETIME_SQL}, 'localtime')`;
const HAS_PRECISE_TIME_SQL = `strftime('%M', ${LOCAL_EFFECTIVE_DATETIME_SQL}) != '00'`;
let databaseAdapter = database;

function __setDatabase(nextDatabase) {
  if (nextDatabase && typeof nextDatabase.query === 'function') {
    databaseAdapter = nextDatabase;
  }
}

function __resetDependencies() {
  databaseAdapter = database;
  temporalCache.clear();
}

/**
 * Get temporal spending patterns
 * Analyzes spending by hour, day of week, and over time
 */
async function getTemporalAnalytics(params = {}) {
  const { timeRange = '6months' } = params;
  const skipCache =
    process.env.NODE_ENV === 'test' ||
    params.noCache === true ||
    params.noCache === 'true' ||
    params.noCache === '1';
  const summaryOnly =
    params.summary === true ||
    params.summary === 'true' ||
    params.summary === '1' ||
    params.mode === 'summary';
  
  // Calculate date range
  const endDate = new Date();
  let startDate = new Date();
  
  switch (timeRange) {
    case '3months':
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case '6months':
      startDate.setMonth(startDate.getMonth() - 6);
      break;
    case 'all':
      // Get the earliest transaction date
      const earliestResult = await databaseAdapter.query(
        `SELECT MIN(COALESCE(transaction_datetime, date)) as earliest
         FROM transactions
         WHERE status IN ('completed', 'pending')`
      );
      if (earliestResult.rows[0]?.earliest) {
        startDate = new Date(earliestResult.rows[0].earliest);
      } else {
        startDate.setFullYear(startDate.getFullYear() - 2); // Fallback to 2 years
      }
      break;
    default:
      startDate.setMonth(startDate.getMonth() - 6);
  }

  const cacheKey = JSON.stringify({
    timeRange,
    summary: summaryOnly,
    start: startDate.toISOString().split('T')[0],
    end: endDate.toISOString().split('T')[0],
  });
  if (!skipCache) {
    const cached = temporalCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // Get all candidate transactions. Precise-time heuristics are applied in-memory.
  const transactionsResult = await databaseAdapter.query(
    `SELECT
      t.date,
      t.transaction_datetime,
      t.price,
      t.category_type,
      strftime('%H', ${LOCAL_EFFECTIVE_DATETIME_SQL}) as hour,
      strftime('%M', ${LOCAL_EFFECTIVE_DATETIME_SQL}) as minute,
      strftime('%w', ${LOCAL_EFFECTIVE_DATETIME_SQL}) as day_of_week,
      strftime('%Y-%W', ${LOCAL_EFFECTIVE_DATETIME_SQL}) as year_week,
      CASE WHEN ${HAS_PRECISE_TIME_SQL} THEN 1 ELSE 0 END as has_precise_time,
      cd.name as category_name
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    WHERE ${STATUS_FILTER_SQL}
      AND t.category_type = 'expense'
      AND ${EFFECTIVE_DATETIME_SQL} >= $1
      AND ${EFFECTIVE_DATETIME_SQL} <= $2
      AND t.price < 0
    `,
    [startDate.toISOString(), endDate.toISOString()]
  );

  const transactions = transactionsResult.rows || [];

  let hourlyCountResult = { rows: [] };
  let weekdayCountResult = { rows: [] };
  let dailyEvolutionResult = { rows: [] };
  let weeklyEvolutionResult = { rows: [] };
  let monthlyEvolutionResult = { rows: [] };

  if (!summaryOnly) {
    // Get transaction count by hour
    hourlyCountResult = await databaseAdapter.query(
      `SELECT
        strftime('%H', ${LOCAL_EFFECTIVE_DATETIME_SQL}) as hour,
        COUNT(*) as count
      FROM transactions t
      WHERE ${STATUS_FILTER_SQL}
        AND t.category_type = 'expense'
        AND t.price < 0
        AND ${HAS_PRECISE_TIME_SQL}
        AND ${EFFECTIVE_DATETIME_SQL} >= $1
        AND ${EFFECTIVE_DATETIME_SQL} <= $2
      GROUP BY hour
      ORDER BY hour`,
      [startDate.toISOString(), endDate.toISOString()]
    );

    // Get transaction count by day of week
    weekdayCountResult = await databaseAdapter.query(
      `SELECT
        strftime('%w', ${LOCAL_EFFECTIVE_DATETIME_SQL}) as day_of_week,
        COUNT(*) as count
      FROM transactions t
      WHERE ${STATUS_FILTER_SQL}
        AND t.category_type = 'expense'
        AND t.price < 0
        AND ${EFFECTIVE_DATETIME_SQL} >= $1
        AND ${EFFECTIVE_DATETIME_SQL} <= $2
      GROUP BY day_of_week
      ORDER BY day_of_week`,
      [startDate.toISOString(), endDate.toISOString()]
    );

    // Get daily evolution data
    dailyEvolutionResult = await databaseAdapter.query(
      `SELECT
        DATE(${LOCAL_EFFECTIVE_DATETIME_SQL}) as date,
        SUM(ABS(t.price)) as total_amount,
        COUNT(*) as transaction_count
      FROM transactions t
      WHERE ${STATUS_FILTER_SQL}
        AND t.category_type = 'expense'
        AND t.price < 0
        AND ${EFFECTIVE_DATETIME_SQL} >= $1
        AND ${EFFECTIVE_DATETIME_SQL} <= $2
      GROUP BY DATE(${LOCAL_EFFECTIVE_DATETIME_SQL})
      ORDER BY date`,
      [startDate.toISOString(), endDate.toISOString()]
    );

    // Get weekly evolution data
    weeklyEvolutionResult = await databaseAdapter.query(
      `SELECT
        strftime('%Y-%W', ${LOCAL_EFFECTIVE_DATETIME_SQL}) as year_week,
        MIN(DATE(${LOCAL_EFFECTIVE_DATETIME_SQL})) as week_start_date,
        SUM(ABS(t.price)) as total_amount,
        COUNT(*) as transaction_count
      FROM transactions t
      WHERE ${STATUS_FILTER_SQL}
        AND t.category_type = 'expense'
        AND t.price < 0
        AND ${EFFECTIVE_DATETIME_SQL} >= $1
        AND ${EFFECTIVE_DATETIME_SQL} <= $2
      GROUP BY year_week
      ORDER BY year_week`,
      [startDate.toISOString(), endDate.toISOString()]
    );

    // Get monthly evolution data
    monthlyEvolutionResult = await databaseAdapter.query(
      `SELECT
        strftime('%Y-%m', ${LOCAL_EFFECTIVE_DATETIME_SQL}) as year_month,
        MIN(DATE(${LOCAL_EFFECTIVE_DATETIME_SQL})) as month_start_date,
        SUM(ABS(t.price)) as total_amount,
        COUNT(*) as transaction_count
      FROM transactions t
      WHERE ${STATUS_FILTER_SQL}
        AND t.category_type = 'expense'
        AND t.price < 0
        AND ${EFFECTIVE_DATETIME_SQL} >= $1
        AND ${EFFECTIVE_DATETIME_SQL} <= $2
      GROUP BY year_month
      ORDER BY year_month`,
      [startDate.toISOString(), endDate.toISOString()]
    );
  }

  // Initialize arrays
  const hourlySpending = Array(24).fill(0);
  const weekdaySpending = Array(7).fill(0);
  const hourlyByDaySpending = Array.from({ length: 7 }, () => Array(24).fill(0));
  const hourlyByDayCount = Array.from({ length: 7 }, () => Array(24).fill(0));
  const weeklyData = new Map();
  let weekdayTotal = 0;
  let weekendTotal = 0;
  let preciseTimeCount = 0;

  // Process transactions
  transactions.forEach((txn) => {
    const amount = Math.abs(txn.price);
    const hour = txn.hour ? parseInt(txn.hour, 10) : null;
    const dayOfWeek = parseInt(txn.day_of_week, 10);
    const yearWeek = txn.year_week;
    const hasPreciseTime = txn.has_precise_time === 1 || txn.has_precise_time === '1';

    if (hasPreciseTime) {
      preciseTimeCount++;
    }

    // Hourly spending (only for precise-time transactions)
    if (hasPreciseTime && hour !== null && !isNaN(hour)) {
      hourlySpending[hour] += amount;
      if (!isNaN(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek < 7) {
        hourlyByDaySpending[dayOfWeek][hour] += amount;
        hourlyByDayCount[dayOfWeek][hour] += 1;
      }
    }

    // Day of week spending and weekend split (available from date even without precise time)
    if (!isNaN(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek < 7) {
      weekdaySpending[dayOfWeek] += amount;
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        weekendTotal += amount;
      } else {
        weekdayTotal += amount;
      }
    } else {
      weekdayTotal += amount;
    }

    // Weekly aggregation
    if (yearWeek) {
      if (!weeklyData.has(yearWeek)) {
        weeklyData.set(yearWeek, 0);
      }
      weeklyData.set(yearWeek, weeklyData.get(yearWeek) + amount);
    }
  });

  // Calculate percentages
  const totalTransactions = transactions.length;
  const totalSpending = weekdayTotal + weekendTotal;
  const weekdayPercentage = totalSpending > 0 ? (weekdayTotal / totalSpending) * 100 : 0;
  const weekendPercentage = totalSpending > 0 ? (weekendTotal / totalSpending) * 100 : 0;
  const preciseTimePercentage = totalTransactions > 0 ? (preciseTimeCount / totalTransactions) * 100 : 0;
  const dayCount = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  const avgDailySpend = dayCount > 0 ? totalSpending / dayCount : 0;

  if (summaryOnly) {
    const response = {
      hourlySpending: hourlySpending.map(v => Math.round(v)),
      weekendPercentage,
      preciseTimePercentage,
      avgDailySpend: Math.round(avgDailySpend),
      dateRange: {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
      },
    };
    if (!skipCache) {
      temporalCache.set(cacheKey, response);
    }
    return response;
  }

  // Format weekly trend data
  const weeklyTrend = Array.from(weeklyData.entries())
    .map(([week, total]) => ({
      week,
      total: Math.round(total)
    }))
    .sort((a, b) => a.week.localeCompare(b.week));

  // Process hourly transaction counts
  const hourlyTransactionCount = Array(24).fill(0);
  (hourlyCountResult.rows || []).forEach(row => {
    const hour = parseInt(row.hour, 10);
    if (!isNaN(hour) && hour >= 0 && hour < 24) {
      hourlyTransactionCount[hour] = parseInt(row.count, 10);
    }
  });

  // Process weekday transaction counts
  const weekdayTransactionCount = Array(7).fill(0);
  (weekdayCountResult.rows || []).forEach(row => {
    const dayOfWeek = parseInt(row.day_of_week, 10);
    if (!isNaN(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek < 7) {
      weekdayTransactionCount[dayOfWeek] = parseInt(row.count, 10);
    }
  });

  // Process evolution data
  const now = Date.now();
  const dailyEvolution = (dailyEvolutionResult.rows || []).map(row => ({
    date: row.date,
    amount: parseFloat(row.total_amount),
    count: parseInt(row.transaction_count, 10),
    daysAgo: Math.floor((now - new Date(row.date).getTime()) / (1000 * 60 * 60 * 24))
  }));

  const weeklyEvolution = (weeklyEvolutionResult.rows || []).map(row => ({
    week: row.year_week,
    date: row.week_start_date,
    amount: parseFloat(row.total_amount),
    count: parseInt(row.transaction_count, 10),
    daysAgo: Math.floor((now - new Date(row.week_start_date).getTime()) / (1000 * 60 * 60 * 24))
  }));

  const monthlyEvolution = (monthlyEvolutionResult.rows || []).map(row => ({
    month: row.year_month,
    date: row.month_start_date,
    amount: parseFloat(row.total_amount),
    count: parseInt(row.transaction_count, 10),
    daysAgo: Math.floor((now - new Date(row.month_start_date).getTime()) / (1000 * 60 * 60 * 24))
  }));

  const response = {
    hourlySpending: hourlySpending.map(v => Math.round(v)),
    weekdaySpending: weekdaySpending.map(v => Math.round(v)),
    hourlyByDaySpending: hourlyByDaySpending.map(row => row.map(v => Math.round(v))),
    hourlyByDayCount,
    weekdayTotal: Math.round(weekdayTotal),
    weekendTotal: Math.round(weekendTotal),
    weekdayPercentage,
    weekendPercentage,
    weeklyTrend,
    preciseTimePercentage,
    totalTransactions,
    dateRange: {
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0]
    },
    // New transaction count data
    hourlyTransactionCount,
    weekdayTransactionCount,
    // New evolution data
    dailyEvolution,
    weeklyEvolution,
    monthlyEvolution
  };
  if (!skipCache) {
    temporalCache.set(cacheKey, response);
  }
  return response;
}

module.exports = {
  getTemporalAnalytics,
  __setDatabase,
  __resetDependencies,
};
