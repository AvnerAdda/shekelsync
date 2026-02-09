const database = require('../database.js');
const { createTtlCache } = require('../../../lib/server/ttl-cache.js');

const temporalCache = createTtlCache({ maxEntries: 10, defaultTtlMs: 60 * 1000 });

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
      const earliestResult = await database.query(
        `SELECT MIN(date) as earliest FROM transactions WHERE status = 'completed'`
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

  // Get transactions with time data (filter out transactions with placeholder times - minutes must not be exactly 00)
  const transactionsResult = await database.query(
    `SELECT
      t.date,
      t.price,
      t.category_type,
      strftime('%H', datetime(t.date, 'localtime')) as hour,
      strftime('%M', datetime(t.date, 'localtime')) as minute,
      strftime('%w', datetime(t.date, 'localtime')) as day_of_week,
      strftime('%Y-%W', datetime(t.date, 'localtime')) as year_week,
      cd.name as category_name
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    WHERE t.status = 'completed'
      AND t.category_type = 'expense'
      AND t.date >= $1
      AND t.date <= $2
      AND t.price < 0
      AND strftime('%M', datetime(t.date, 'localtime')) != '00'
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
    hourlyCountResult = await database.query(
      `SELECT
        strftime('%H', datetime(t.date, 'localtime')) as hour,
        COUNT(*) as count
      FROM transactions t
      WHERE t.status = 'completed'
        AND t.category_type = 'expense'
        AND t.price < 0
        AND strftime('%M', datetime(t.date, 'localtime')) != '00'
        AND t.date >= $1
        AND t.date <= $2
      GROUP BY hour
      ORDER BY hour`,
      [startDate.toISOString(), endDate.toISOString()]
    );

    // Get transaction count by day of week
    weekdayCountResult = await database.query(
      `SELECT
        strftime('%w', datetime(t.date, 'localtime')) as day_of_week,
        COUNT(*) as count
      FROM transactions t
      WHERE t.status = 'completed'
        AND t.category_type = 'expense'
        AND t.price < 0
        AND strftime('%M', datetime(t.date, 'localtime')) != '00'
        AND t.date >= $1
        AND t.date <= $2
      GROUP BY day_of_week
      ORDER BY day_of_week`,
      [startDate.toISOString(), endDate.toISOString()]
    );

    // Get daily evolution data
    dailyEvolutionResult = await database.query(
      `SELECT
        DATE(datetime(t.date, 'localtime')) as date,
        SUM(ABS(t.price)) as total_amount,
        COUNT(*) as transaction_count
      FROM transactions t
      WHERE t.status = 'completed'
        AND t.category_type = 'expense'
        AND t.price < 0
        AND t.date >= $1
        AND t.date <= $2
      GROUP BY DATE(datetime(t.date, 'localtime'))
      ORDER BY date`,
      [startDate.toISOString(), endDate.toISOString()]
    );

    // Get weekly evolution data
    weeklyEvolutionResult = await database.query(
      `SELECT
        strftime('%Y-%W', datetime(t.date, 'localtime')) as year_week,
        MIN(DATE(datetime(t.date, 'localtime'))) as week_start_date,
        SUM(ABS(t.price)) as total_amount,
        COUNT(*) as transaction_count
      FROM transactions t
      WHERE t.status = 'completed'
        AND t.category_type = 'expense'
        AND t.price < 0
        AND t.date >= $1
        AND t.date <= $2
      GROUP BY year_week
      ORDER BY year_week`,
      [startDate.toISOString(), endDate.toISOString()]
    );

    // Get monthly evolution data
    monthlyEvolutionResult = await database.query(
      `SELECT
        strftime('%Y-%m', datetime(t.date, 'localtime')) as year_month,
        MIN(DATE(datetime(t.date, 'localtime'))) as month_start_date,
        SUM(ABS(t.price)) as total_amount,
        COUNT(*) as transaction_count
      FROM transactions t
      WHERE t.status = 'completed'
        AND t.category_type = 'expense'
        AND t.price < 0
        AND t.date >= $1
        AND t.date <= $2
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
  transactions.forEach(txn => {
    const amount = Math.abs(txn.price);
    const hour = txn.hour ? parseInt(txn.hour, 10) : null;
    const dayOfWeek = parseInt(txn.day_of_week, 10);
    const yearWeek = txn.year_week;

    // Hourly spending (only if hour is available)
    if (hour !== null && !isNaN(hour)) {
      hourlySpending[hour] += amount;
      preciseTimeCount++;
      if (!isNaN(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek < 7) {
        hourlyByDaySpending[dayOfWeek][hour] += amount;
        hourlyByDayCount[dayOfWeek][hour] += 1;
      }
    }

    // Day of week spending
    weekdaySpending[dayOfWeek] += amount;

    // Weekend vs Weekday
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      weekendTotal += amount;
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
  const totalSpending = weekdayTotal + weekendTotal;
  const weekdayPercentage = totalSpending > 0 ? (weekdayTotal / totalSpending) * 100 : 0;
  const weekendPercentage = totalSpending > 0 ? (weekendTotal / totalSpending) * 100 : 0;
  const preciseTimePercentage = transactions.length > 0 ? (preciseTimeCount / transactions.length) * 100 : 0;
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
    totalTransactions: transactions.length,
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
  getTemporalAnalytics
};
