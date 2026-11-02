'use strict';

/**
 * Mortgage payments in the cash-flow forecast, computed from the detailed
 * tracks (prime / CPI paths from cached BoI and CBS data) instead of being
 * inferred from past debits.
 *
 * Runs on the forecast's synchronous better-sqlite3 handle. To avoid double
 * counting, the context also tells the forecast which historical debits and
 * which inferred / user-confirmed predictions belong to a modelled mortgage.
 */

const engine = require('../investments/mortgage/engine.js');
const ratePaths = require('../investments/mortgage/rate-paths.js');
const { mortgageFromRows, toEngineInput } = require('../investments/mortgage/store.js');
const { RATE_PATH_KEYS, assembleRatePathSeries } = require('../investments/market-data.js');
const {
  deriveMatcher,
  isMortgagePayment,
  matcherFromLoan,
  matchesDebit,
  matchesForecastSource,
  transactionDate,
} = require('../investments/mortgage/debit-matcher.js');

const PAID_TOLERANCE_DAYS = 10;

function tableExists(db, name) {
  try {
    return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(name));
  } catch (_error) {
    return false;
  }
}

function localDate(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dayDistance(left, right) {
  return Math.abs((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000);
}

const EMPTY_CONTEXT = Object.freeze({
  loans: [],
  hasLoans: false,
  matchesTransaction: () => false,
  matchesSource: () => false,
});

function loadRatePathSeriesSync(db) {
  if (!tableExists(db, 'market_series_points')) return assembleRatePathSeries({});
  const placeholders = RATE_PATH_KEYS.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT series_key, period, value FROM market_series_points WHERE series_key IN (${placeholders}) ORDER BY series_key, period`,
  ).all(...RATE_PATH_KEYS);
  const byKey = {};
  for (const row of rows) {
    (byKey[row.series_key] = byKey[row.series_key] || []).push({ period: row.period, value: Number(row.value) });
  }
  return assembleRatePathSeries(byKey);
}

// Replays run with a past `now`: never read debits after it.
function linkedTransactions(db, accountId, cutoffIso) {
  if (!tableExists(db, 'transaction_account_links')) return [];
  return db.prepare(`
    SELECT t.name, t.vendor, t.account_number, t.price, t.date,
           t.category_definition_id, cd.name AS category_name, cd.name_en AS category_name_en,
           COALESCE(cd.category_type, t.category_type) AS category_type
      FROM transaction_account_links tal
      JOIN transactions t ON t.identifier = tal.transaction_identifier AND t.vendor = tal.transaction_vendor
      LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
     WHERE tal.account_id = ? AND t.date <= ?
     ORDER BY t.date DESC
  `).all(accountId, cutoffIso);
}

function recentMortgageDebits(db, now) {
  const since = new Date(now.getTime());
  since.setMonth(since.getMonth() - 13);
  return db.prepare(`
    SELECT t.name, t.vendor, t.account_number, t.price, t.date,
           t.category_definition_id, cd.name AS category_name, cd.name_en AS category_name_en,
           COALESCE(cd.category_type, t.category_type) AS category_type
      FROM transactions t
      LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
     WHERE t.price < 0 AND t.date >= ? AND t.date <= ?
     ORDER BY t.date DESC
  `).all(since.toISOString(), now.toISOString()).filter((row) => isMortgagePayment(row.name));
}

/**
 * Load every active loan with detailed tracks, its engine input and debit
 * matcher. Never throws: a forecast must not fail because of mortgage data.
 */
function loadMortgageForecastContext(db, now = new Date()) {
  try {
    if (!db || !tableExists(db, 'mortgage_loans') || !tableExists(db, 'mortgage_tracks')) return EMPTY_CONTEXT;
    const loanRows = db.prepare("SELECT * FROM mortgage_loans WHERE COALESCE(status, 'active') = 'active' ORDER BY id").all();
    if (loanRows.length === 0) return EMPTY_CONTEXT;
    const asOf = localDate(now);
    const paths = ratePaths.buildPaths({ series: loadRatePathSeriesSync(db), asOf });
    let fallbackDebits = null;

    const loans = [];
    for (const loanRow of loanRows) {
      const trackRows = db.prepare('SELECT * FROM mortgage_tracks WHERE loan_id = ? ORDER BY sort_order, id').all(loanRow.id);
      if (trackRows.length === 0) continue;
      const trancheRows = db.prepare(`
        SELECT d.* FROM mortgage_track_drawdowns d JOIN mortgage_tracks t ON t.id = d.track_id
         WHERE t.loan_id = ? ORDER BY d.draw_date, d.id
      `).all(loanRow.id);
      const eventRows = tableExists(db, 'mortgage_events')
        ? db.prepare('SELECT * FROM mortgage_events WHERE loan_id = ? ORDER BY event_date, id').all(loanRow.id)
        : [];
      const mortgage = mortgageFromRows(loanRow, trackRows, trancheRows, eventRows);
      const linked = linkedTransactions(db, mortgage.accountId, now.toISOString());
      let matcher = matcherFromLoan(mortgage) || deriveMatcher(linked);
      let evidence = linked;
      if (!matcher && loanRows.length === 1) {
        // Single mortgage: any recurring mortgage-named debit is its payment.
        fallbackDebits = fallbackDebits || recentMortgageDebits(db, now);
        matcher = deriveMatcher(fallbackDebits);
        evidence = fallbackDebits;
      }
      const matched = matcher ? evidence.filter((row) => matchesDebit(matcher, row)) : [];
      const reference = matched[0] || null;
      const input = toEngineInput(mortgage);
      const schedule = engine.buildMortgageSchedule({ ...input, paths, asOf });
      loans.push({
        loanId: mortgage.id,
        accountId: mortgage.accountId,
        matcher,
        schedule,
        evidenceCount: matched.length,
        category: {
          id: reference?.category_definition_id ?? null,
          name: reference?.category_name_en || reference?.category_name || 'Mortgage',
          type: reference?.category_type === 'expense' ? 'expense' : 'investment',
        },
        transactionName: reference?.name || 'Mortgage',
        vendor: reference?.vendor || matcher?.vendor || null,
        accountNumber: reference?.account_number || matcher?.accountNumber || null,
      });
    }
    if (loans.length === 0) return EMPTY_CONTEXT;
    const matchers = loans.map((loan) => loan.matcher).filter(Boolean);
    const unmatched = loans.some((loan) => !loan.matcher);
    return {
      loans,
      hasLoans: true,
      matchesTransaction: (row) => matchers.some((matcher) => matchesDebit(matcher, row)),
      // Without a matcher for some loan, any mortgage-named source is assumed
      // to be covered by the modelled schedule.
      matchesSource: (item) => matchers.some((matcher) => matchesForecastSource(matcher, item))
        || (unmatched && isMortgagePayment(item?.transactionName || item?.displayName || '')),
    };
  } catch (error) {
    return { ...EMPTY_CONTEXT, error: error.message };
  }
}

/**
 * One forecast event per payment date (tracks paid on the same day are
 * summed). Payments already made (a matched debit within 10 days) are skipped.
 */
function buildMortgageScheduleEvents(context, dates, historicalTransactions = []) {
  if (!context?.hasLoans || !dates?.length) return [];
  const dateSet = new Set(dates);
  const events = [];
  for (const loan of context.loans) {
    const paidDates = (historicalTransactions || [])
      .filter((row) => loan.matcher && matchesDebit(loan.matcher, row))
      .map((row) => transactionDate(row.date))
      .filter(Boolean);
    const byDate = new Map();
    for (const track of loan.schedule.tracks) {
      for (const row of track.rows) {
        if (!dateSet.has(row.date) || !(row.payment > 0)) continue;
        byDate.set(row.date, (byDate.get(row.date) || 0) + row.payment);
      }
    }
    for (const [date, amount] of [...byDate.entries()].sort()) {
      if (paidDates.some((paid) => dayDistance(paid, date) <= PAID_TOLERANCE_DAYS)) continue;
      const rounded = Math.round(amount * 100) / 100;
      events.push({
        sourceKey: `mortgage:${loan.loanId}`,
        date,
        amount: rounded,
        // Payment is computed, not estimated: only rate / CPI surprises move it.
        stdDev: rounded * 0.01,
        categoryDefinitionId: loan.category.id,
        category: loan.category.name,
        categoryType: loan.category.type,
        transactionName: loan.transactionName,
        vendor: loan.vendor,
        accountNumber: loan.accountNumber,
        evidenceCount: loan.evidenceCount,
        inference: 'mortgage_schedule',
      });
    }
  }
  return events.sort((left, right) => left.date.localeCompare(right.date));
}

/** Expense-categorized mortgages (e.g. "Rent & Mortgage") as scheduled expenses. */
function applyMortgageExpenseSchedule(dailyForecasts, simulationEntriesByDay, events, forecastEngine) {
  if (!events.length) return;
  const dayMap = new Map(dailyForecasts.map((day) => [day.date, day]));
  const simulationMap = new Map(simulationEntriesByDay.map((day) => [day.date, day]));
  for (const event of events) {
    const day = dayMap.get(event.date);
    if (!day) continue;
    const patternKey = `mortgage_schedule:${event.sourceKey}`;
    day.predictions.push({
      patternKey, monthlyKey: patternKey, categoryType: 'expense', category: event.category,
      categoryDefinitionId: event.categoryDefinitionId, transactionName: event.transactionName,
      vendor: event.vendor, expenseType: 'operating',
      probability: 1, expectedAmount: event.amount, probabilityWeightedAmount: event.amount,
      amountRange: { low: event.amount - event.stdDev, high: event.amount + event.stdDev },
      predictionKind: 'mortgage_payment', timingBasis: 'scheduled', forecastBasis: 'mortgage_schedule',
      inference: 'mortgage_schedule',
      explanation: 'Computed from your mortgage tracks (prime and CPI from Bank of Israel / CBS data)',
    });
    simulationMap.get(event.date)?.entries.push({
      patternKey, monthlyKey: patternKey, categoryType: 'expense', expenseType: 'operating',
      patternType: 'mortgage_schedule', probability: 1, avgAmount: event.amount, stdDev: event.stdDev,
    });
  }
  dailyForecasts.forEach(forecastEngine.refreshForecastDayPredictions);
}

/**
 * Remove predictions for a modelled mortgage that came from other sources
 * (user-confirmed recurring patterns), keeping the schedule's own events.
 */
function dropDuplicateMortgagePredictions(dailyForecasts, simulationEntriesByDay, context, forecastEngine) {
  if (!context?.hasLoans) return 0;
  const dropped = new Set();
  for (const day of dailyForecasts) {
    day.predictions = (day.predictions || []).filter((prediction) => {
      const key = String(prediction.patternKey || '');
      if (key.includes('mortgage:') || prediction.inference === 'mortgage_schedule') return true;
      if (!(prediction.categoryType === 'investment' || prediction.categoryType === 'expense')) return true;
      if (!context.matchesSource(prediction)) return true;
      dropped.add(key);
      return false;
    });
  }
  if (dropped.size === 0) return 0;
  for (const day of simulationEntriesByDay) {
    day.entries = day.entries.filter((entry) => !dropped.has(String(entry.patternKey || '')));
  }
  dailyForecasts.forEach(forecastEngine.refreshForecastDayPredictions);
  return dropped.size;
}

module.exports = {
  EMPTY_CONTEXT,
  applyMortgageExpenseSchedule,
  buildMortgageScheduleEvents,
  dropDuplicateMortgagePredictions,
  loadMortgageForecastContext,
};
