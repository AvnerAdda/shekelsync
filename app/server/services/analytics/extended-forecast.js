const database = require('../database.js');
const forecastService = require('../forecast.js');
const { createTtlCache } = require('../../../lib/server/ttl-cache.js');

const extendedForecastCache = createTtlCache({ maxEntries: 5, defaultTtlMs: 60 * 1000 });

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateStr) {
  if (typeof dateStr !== 'string') return new Date(dateStr);
  if (dateStr.includes('T')) return new Date(dateStr);
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return new Date(dateStr);
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}

/**
 * Generate extended forecast with net position history + future scenarios
 * IMPORTANT: Always generates 6 months, regardless of other forecast settings
 */
async function getExtendedForecast(params = {}) {
  const skipCache =
    process.env.NODE_ENV === 'test' ||
    params.noCache === true ||
    params.noCache === 'true' ||
    params.noCache === '1';
  const cacheKey = formatLocalDate(new Date());
  if (!skipCache) {
    const cached = extendedForecastCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }
  // Get daily forecast data (6 months, start tomorrow to avoid overlapping with historical actuals)
  const forecastData = await forecastService.generateDailyForecast({
    includeToday: false,
    forecastMonths: 6,
    verbose: false
  });

  // Get historical net position data (last 6 months)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const historyResult = await database.query(
    `SELECT
      DATE(t.date) as date,
      SUM(CASE WHEN t.category_type = 'income' THEN t.price ELSE 0 END) as income,
      SUM(CASE WHEN t.category_type = 'expense' THEN ABS(t.price) ELSE 0 END) as expenses
    FROM transactions t
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    WHERE t.status IN ('completed', 'pending')
      AND tpe.transaction_identifier IS NULL
      AND cd.name NOT IN ('החזר קרן', 'ריבית מהשקעות', 'פיקדונות')
      AND t.date >= $1
    GROUP BY DATE(t.date)
    ORDER BY date`,
    [sixMonthsAgo.toISOString()]
  );

  const history = historyResult.rows || [];

  // Get current account balance as the starting point
  const balanceResult = await database.query(
    `SELECT
      SUM(ih.current_value) as total_balance
    FROM investment_holdings ih
    JOIN investment_accounts ia ON ih.account_id = ia.id
    WHERE ia.account_type = 'bank_balance'
      AND ia.is_active = 1
      AND ih.as_of_date = (
        SELECT MAX(as_of_date)
        FROM investment_holdings
        WHERE account_id = ia.id
      )`
  );

  const currentBalance = (balanceResult.rows?.[0]?.total_balance) || 0;

  // Fill missing dates in history (days with no transactions)
  // Fill from first transaction through today
  const filledHistory = [];
  if (history.length > 0) {
    const startDate = parseLocalDate(history[0].date);
    const now = new Date();

    // Set endDate to today (fills through today with missing dates as zeros)
    const endDate = new Date(now);
    endDate.setHours(0, 0, 0, 0); // Normalize to midnight

    const historyMap = new Map(history.map(h => [h.date, h]));

    let currentDate = new Date(startDate);
    currentDate.setHours(0, 0, 0, 0); // Normalize to midnight

    while (currentDate <= endDate) {
      const dateStr = formatLocalDate(currentDate);
      const dayData = historyMap.get(dateStr);

      if (dayData) {
        filledHistory.push(dayData);
      } else {
        // Fill missing date with zero income/expenses
        filledHistory.push({
          date: dateStr,
          income: 0,
          expenses: 0
        });
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  // Calculate cumulative net position for history
  const normalizedCurrentBalance = Number(currentBalance) || 0;
  const totalHistoricalNetFlow = filledHistory.reduce((sum, day) => {
    const income = Number(day.income) || 0;
    const expenses = Number(day.expenses) || 0;
    return sum + (income - expenses);
  }, 0);

  // Anchor historical series so it ends at the current balance (today).
  let historicalCumulative = normalizedCurrentBalance - totalHistoricalNetFlow;
  const historicalData = filledHistory.map(day => {
    const income = Number(day.income) || 0;
    const expenses = Number(day.expenses) || 0;
    const netFlow = income - expenses;
    historicalCumulative += netFlow;
    return {
      date: day.date,
      income,
      expenses,
      netFlow,
      historicalCumulative,
      forecastCumulative: null
    };
  });

  // Get starting balance for forecast (last historical cumulative)
  // Track cumulative separately for each scenario
  const lastHistoricalCumulative = historicalData.length
    ? historicalData[historicalData.length - 1].historicalCumulative
    : normalizedCurrentBalance;

  let cumulativeP10 = lastHistoricalCumulative;
  let cumulativeP50 = lastHistoricalCumulative;
  let cumulativeP90 = lastHistoricalCumulative;

  const mc = forecastData.monteCarloResults || {};
  const scenarioMap = {
    p10: mc.worstCase || {},
    p50: mc.baseCase || {},
    p90: mc.bestCase || {}
  };

  const p10Data = [];
  const p50Data = [];
  const p90Data = [];

  (scenarioMap.p10.dailyResults || []).forEach(day => {
    const netFlow = (day.income || 0) - (day.expenses || 0);
    cumulativeP10 += netFlow;
    p10Data.push({
      date: day.date,
      income: day.income || 0,
      expenses: day.expenses || 0,
      netFlow,
      forecastCumulative: cumulativeP10,
      historicalCumulative: null
    });
  });

  (scenarioMap.p50.dailyResults || []).forEach(day => {
    const netFlow = (day.income || 0) - (day.expenses || 0);
    cumulativeP50 += netFlow;
    p50Data.push({
      date: day.date,
      income: day.income || 0,
      expenses: day.expenses || 0,
      netFlow,
      forecastCumulative: cumulativeP50,
      historicalCumulative: null
    });
  });

  (scenarioMap.p90.dailyResults || []).forEach(day => {
    const netFlow = (day.income || 0) - (day.expenses || 0);
    cumulativeP90 += netFlow;
    p90Data.push({
      date: day.date,
      income: day.income || 0,
      expenses: day.expenses || 0,
      netFlow,
      forecastCumulative: cumulativeP90,
      historicalCumulative: null
    });
  });

  // Merge historical and all three scenarios into one array for charting
  // Start with historical data, then merge in scenario forecasts
  const combinedData = historicalData.map(item => ({
    ...item,
    p10Cumulative: null,
    p50Cumulative: null,
    p90Cumulative: null
  }));

  // Bridge point: start scenario curves from the last historical value.
  if (combinedData.length > 0) {
    const lastIndex = combinedData.length - 1;
    const bridgeValue = combinedData[lastIndex].historicalCumulative;
    combinedData[lastIndex] = {
      ...combinedData[lastIndex],
      p10Cumulative: bridgeValue,
      p50Cumulative: bridgeValue,
      p90Cumulative: bridgeValue,
    };
  } else {
    const todayStr = formatLocalDate(new Date());
    combinedData.push({
      date: todayStr,
      historicalCumulative: lastHistoricalCumulative,
      income: 0,
      expenses: 0,
      netFlow: 0,
      p10Cumulative: lastHistoricalCumulative,
      p50Cumulative: lastHistoricalCumulative,
      p90Cumulative: lastHistoricalCumulative,
    });
  }

  // Add p10 scenario forecast
  p10Data.forEach(day => {
    combinedData.push({
      date: day.date,
      historicalCumulative: null,
      income: null,
      expenses: null,
      netFlow: null,
      p10Cumulative: day.forecastCumulative,
      p50Cumulative: null,
      p90Cumulative: null
    });
  });

  // Merge p50 into existing forecast entries
  p50Data.forEach((day, index) => {
    const existingIndex = combinedData.findIndex(item => item.date === day.date && item.p50Cumulative === null);
    if (existingIndex >= 0) {
      combinedData[existingIndex].p50Cumulative = day.forecastCumulative;
      combinedData[existingIndex].income = day.income;
      combinedData[existingIndex].expenses = day.expenses;
    } else {
      combinedData.push({
        date: day.date,
        historicalCumulative: null,
        income: day.income,
        expenses: day.expenses,
        netFlow: null,
        p10Cumulative: null,
        p50Cumulative: day.forecastCumulative,
        p90Cumulative: null
      });
    }
  });

  // Merge p90 into existing forecast entries
  p90Data.forEach(day => {
    const existingIndex = combinedData.findIndex(item => item.date === day.date && item.p90Cumulative === null);
    if (existingIndex >= 0) {
      combinedData[existingIndex].p90Cumulative = day.forecastCumulative;
    } else {
      combinedData.push({
        date: day.date,
        historicalCumulative: null,
        income: null,
        expenses: null,
        netFlow: null,
        p10Cumulative: null,
        p50Cumulative: null,
        p90Cumulative: day.forecastCumulative
      });
    }
  });

  // Sort by date
  combinedData.sort((a, b) => a.date.localeCompare(b.date));

  const response = {
    combinedData,
    scenarios: {
      p10: p10Data,
      p50: p50Data,
      p90: p90Data
    },
    summaries: {
      pessimistic: {
        netCashFlow: Math.round(scenarioMap.p10.totalCashFlow || 0),
        income: Math.round(scenarioMap.p10.totalIncome || 0),
        expenses: Math.round(scenarioMap.p10.totalExpenses || 0)
      },
      base: {
        netCashFlow: Math.round(scenarioMap.p50.totalCashFlow || 0),
        income: Math.round(scenarioMap.p50.totalIncome || 0),
        expenses: Math.round(scenarioMap.p50.totalExpenses || 0)
      },
      optimistic: {
        netCashFlow: Math.round(scenarioMap.p90.totalCashFlow || 0),
        income: Math.round(scenarioMap.p90.totalIncome || 0),
        expenses: Math.round(scenarioMap.p90.totalExpenses || 0)
      }
    }
  };
  if (!skipCache) {
    extendedForecastCache.set(cacheKey, response);
  }
  return response;
}

module.exports = {
  getExtendedForecast
};
