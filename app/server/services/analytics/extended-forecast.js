const defaultDatabase = require('../database.js');
let database = defaultDatabase;
const defaultForecastService = require('../forecast.js');
let forecastService = defaultForecastService;
const defaultFinancialTruthService = require('../financial-truth.js');
let financialTruthService = defaultFinancialTruthService;
const defaultFxService = require('../investments/fx.js');
let fxService = defaultFxService;
const { normalizePlanningCurrency } = require('../planning-currency.js');
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

async function resolveCurrentBalance(accounts, today) {
  if (!accounts.length) return { amount: 0, status: 'missing' };
  // Keep every active account in the check: a known subtotal is not the full balance.
  if (accounts.some(account => account.current_value == null
    || String(account.current_value).trim() === '' || !Number.isFinite(Number(account.current_value))
    || !/^[A-Z]{3}$/.test(normalizePlanningCurrency(account.currency, '')))) {
    return { amount: 0, status: 'incomplete' };
  }
  const amounts = await Promise.all(accounts.map(async account => {
    const amount = Number(account.current_value);
    const currency = normalizePlanningCurrency(account.currency, '');
    if (currency === 'ILS' || amount === 0) return amount;
    const conversion = await fxService.convertAmount({ amount, currency, baseCurrency: 'ILS', date: today });
    return conversion.complete && Number.isFinite(conversion.baseAmount) ? conversion.baseAmount : null;
  }));
  if (amounts.some(amount => amount === null)) return { amount: 0, status: 'missing_exchange_rate' };
  return { amount: amounts.reduce((sum, amount) => sum + Math.round(amount * 100), 0) / 100, status: 'ready' };
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
  let revision = null;
  try { revision = financialTruthService.getProjectionSnapshot({ materialize: false }).truthRevision; } catch {}
  const cacheKey = `${formatLocalDate(new Date())}:${revision ?? 'unknown'}`;
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
    verbose: false,
    noCache: skipCache
  });

  // Whole history: positions are anchored backwards from today's balance, so
  // clients can trim the window without changing any value.
  const historyResult = await database.query(
    `SELECT
      DATE(t.date) as date,
      SUM(CASE WHEN COALESCE(cd.category_type, t.category_type) = 'income' THEN t.price ELSE 0 END) as income,
      SUM(CASE WHEN COALESCE(cd.category_type, t.category_type) = 'expense' THEN -t.price ELSE 0 END) as expenses,
      SUM(CASE WHEN COALESCE(cd.category_type, t.category_type) = 'investment' THEN -t.price ELSE 0 END) as investments
    FROM transactions t
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    WHERE t.status IN ('completed', 'pending')
      AND tpe.transaction_identifier IS NULL
      AND COALESCE(cd.name, '') NOT IN ('החזר קרן', 'ריבית מהשקעות', 'פיקדונות')
      AND substr(t.date, 1, 10) <= $1
    GROUP BY DATE(t.date)
    ORDER BY date`,
    [formatLocalDate(new Date())]
  );

  const history = historyResult.rows || [];

  // Load each active account before converting; an inner join would hide missing balances.
  const balanceResult = await database.query(
    `SELECT
      ia.id AS account_id, ia.currency, ih.current_value
    FROM investment_accounts ia
    LEFT JOIN investment_holdings ih ON ih.id = (
      SELECT h.id FROM investment_holdings h
      WHERE h.account_id = ia.id AND COALESCE(h.holding_type, 'standard') <> 'pikadon'
      ORDER BY h.as_of_date DESC, h.id DESC LIMIT 1
    )
    WHERE ia.account_type = 'bank_balance'
      AND ia.is_active = 1`
  );

  const balance = await resolveCurrentBalance(balanceResult.rows || [], formatLocalDate(new Date()));
  const currentBalance = balance.amount;

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
          expenses: 0,
          investments: 0
        });
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  // The bank balance already reflects money moved to investments, so both
  // bases meet at today's balance and differ only in which flows they count.
  const normalizedCurrentBalance = Number(currentBalance) || 0;
  const bases = Object.fromEntries(['before', 'after'].map(basis => {
    const includeInvestments = basis === 'after';
    const historicalData = buildHistoricalPositions(filledHistory, normalizedCurrentBalance, includeInvestments);
    const startingBalance = historicalData.length
      ? historicalData[historicalData.length - 1].historicalCumulative
      : normalizedCurrentBalance;
    return [basis, buildExtendedForecastPayload(forecastData, historicalData, startingBalance, { includeInvestments })];
  }));

  // Top-level fields stay the default (after investing): the real bank path.
  const response = {
    ...bases.after,
    hasInvestments: filledHistory.some(day => (Number(day.investments) || 0) !== 0)
      || (forecastData.dailyForecasts || []).some(day => (Number(day.expectedInvestments) || 0) !== 0),
    investmentBases: Object.fromEntries(Object.entries(bases).map(([basis, payload]) => [basis, {
      combinedData: payload.combinedData, scenarios: payload.scenarios, summaries: payload.summaries,
    }])),
  };
  response.hasCurrentBalance = balance.status === 'ready';
  response.balanceStatus = balance.status;
  let currentTruthRevision = response.truthRevision;
  try {
    currentTruthRevision = financialTruthService.getProjectionSnapshot({ materialize: false }).truthRevision;
  } catch {
    // Compatibility for pre-migration databases and isolated test fixtures.
  }
  if (Number(response.truthRevision) !== Number(currentTruthRevision)) {
    if (!params.__revisionRetry) {
      return getExtendedForecast({ ...params, noCache: true, __revisionRetry: true });
    }
    throw new Error('Financial truth changed while the extended forecast was updating');
  }
  if (!skipCache) {
    extendedForecastCache.set(cacheKey, response);
  }
  return response;
}

// Anchor the historical series so it ends at the current balance (today).
function buildHistoricalPositions(filledHistory, currentBalance, includeInvestments) {
  const number = value => Number(value) || 0;
  const flow = day => number(day.income) - number(day.expenses) - (includeInvestments ? number(day.investments) : 0);
  let historicalCumulative = currentBalance - filledHistory.reduce((sum, day) => sum + flow(day), 0);
  return filledHistory.map(day => {
    const netFlow = flow(day);
    historicalCumulative += netFlow;
    return {
      date: day.date,
      income: number(day.income),
      expenses: number(day.expenses),
      investments: number(day.investments),
      netFlow,
      historicalCumulative,
      forecastCumulative: null
    };
  });
}

function buildExtendedForecastPayload(forecastData, history, startingBalance, { includeInvestments = false } = {}) {
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const intervals = new Map((forecastData.predictionIntervals?.daily || []).map(day => [day.date, day]));
  const days = forecastData.dailyForecasts || [];
  let expected = startingBalance;
  let income = 0;
  let expenses = 0;
  let investments = 0;
  const combinedData = history.map(day => ({ ...day, expectedCumulative: null,
    p10Cumulative: null, p50Cumulative: null, p90Cumulative: null }));
  if (!combinedData.length) combinedData.push({ date: formatLocalDate(new Date()),
    historicalCumulative: startingBalance, income: 0, expenses: 0, netFlow: 0,
    expectedCumulative: null, p10Cumulative: null, p50Cumulative: null, p90Cumulative: null });
  Object.assign(combinedData.at(-1), { expectedCumulative: startingBalance,
    p10Cumulative: startingBalance, p50Cumulative: startingBalance, p90Cumulative: startingBalance });
  const scenarios = { p10: [], p50: [], p90: [] };
  for (const day of days) {
    const dayIncome = number(day.expectedIncome);
    const dayExpenses = number(day.expectedExpenses);
    // Intervals cover income and expenses only; planned investments shift every path equally.
    const dayInvestments = includeInvestments ? number(day.expectedInvestments) : 0;
    income += dayIncome;
    expenses += dayExpenses;
    investments += dayInvestments;
    expected += dayIncome - dayExpenses - dayInvestments;
    const range = intervals.get(day.date)?.cumulativeCashFlow;
    const validRange = range && ['p10', 'p50', 'p90'].every(key => Number.isFinite(range[key]))
      && range.p10 <= range.p50 && range.p50 <= range.p90;
    const rangeBase = startingBalance - investments;
    const entry = { date: day.date, income: dayIncome, expenses: dayExpenses,
      ...(includeInvestments ? { investments: dayInvestments } : {}),
      netFlow: dayIncome - dayExpenses - dayInvestments, historicalCumulative: null, expectedCumulative: expected,
      p10Cumulative: validRange ? rangeBase + range.p10 : null,
      p50Cumulative: validRange ? rangeBase + range.p50 : null,
      p90Cumulative: validRange ? rangeBase + range.p90 : null };
    combinedData.push(entry);
    for (const key of ['p10', 'p50', 'p90']) scenarios[key].push({
      date: day.date, forecastCumulative: entry[`${key}Cumulative`], historicalCumulative: null,
    });
  }
  const last = combinedData.at(-1);
  const tailSummary = key => ({
    netCashFlow: Number.isFinite(last?.[key]) ? last[key] - startingBalance : null,
    endingBalance: Number.isFinite(last?.[key]) ? last[key] : null,
  });
  const categoryNames = new Map((forecastData.categoryPatterns || []).map(pattern => [
    pattern.categoryDefinitionId, pattern.categoryNameEn || pattern.category,
  ]));
  const drivers = new Map();
  const incomeDrivers = new Map();
  for (const day of days) for (const prediction of day.predictions || []) {
    if (prediction.categoryType === 'income') {
      const source = prediction.transactionName || prediction.displayName || prediction.category || 'Income';
      const key = JSON.stringify([prediction.categoryDefinitionId ?? null, prediction.vendor || '', source]);
      if (!incomeDrivers.has(key)) incomeDrivers.set(key, {
        source, amount: 0, nextDate: day.date,
        expectedPaymentDate: prediction.expectedPaymentDate || day.date,
        awaitingReceipt: Boolean(prediction.awaitingReceipt),
      });
      incomeDrivers.get(key).amount += number(prediction.probabilityWeightedAmount);
      continue;
    }
    if (prediction.categoryType !== 'expense') continue;
    const id = prediction.categoryDefinitionId ?? null;
    const key = id == null ? prediction.category || 'Uncategorized' : String(id);
    if (!drivers.has(key)) drivers.set(key, { categoryDefinitionId: id,
      category: prediction.category || 'Uncategorized', categoryNameEn: categoryNames.get(id) || prediction.category,
      amount: 0, scheduled: 0, typical: 0, occasional: 0 });
    const driver = drivers.get(key);
    const amount = number(prediction.probabilityWeightedAmount);
    driver.amount += amount;
    const basis = prediction.forecastBasis === 'irregular_allowance' ? 'occasional'
      : prediction.predictionKind === 'recurring_expense' || prediction.isUserResolvedPattern ? 'scheduled' : 'typical';
    driver[basis] += amount;
  }
  return {
    modelId: forecastData.modelId, truthRevision: forecastData.truthRevision || 0, refreshState: 'ready',
    startingBalance, forecastPeriod: forecastData.forecastPeriod, combinedData, scenarios,
    expenseDrivers: [...drivers.values()].sort((left, right) => right.amount - left.amount),
    incomeDrivers: [...incomeDrivers.values()].sort((left, right) => right.amount - left.amount),
    summaries: {
      pessimistic: tailSummary('p10Cumulative'),
      base: { income, expenses, ...(includeInvestments ? { investments } : {}),
        netCashFlow: income - expenses - investments, endingBalance: expected },
      optimistic: tailSummary('p90Cumulative'),
    },
  };
}

module.exports = {
  getExtendedForecast,
  _internal: { buildExtendedForecastPayload, buildHistoricalPositions },
  __setDependencies(dependencies) {
    database = dependencies.database || defaultDatabase;
    forecastService = dependencies.forecast || defaultForecastService;
    financialTruthService = dependencies.financialTruth || defaultFinancialTruthService;
    fxService = dependencies.fx || defaultFxService;
    extendedForecastCache.clear();
  },
  __resetDependencies() {
    database = defaultDatabase; forecastService = defaultForecastService; financialTruthService = defaultFinancialTruthService;
    fxService = defaultFxService;
    extendedForecastCache.clear();
  },
  clearCache() {
    extendedForecastCache.clear();
  },
};
