'use strict';

/**
 * Mortgage orchestration: stored tracks (or the legacy single-mortgage
 * columns) + cached market data → engine schedule. Also keeps the legacy
 * real_estate_properties mortgage columns in sync with the computed balance so
 * valuation, net equity and the optimizer keep working unchanged.
 */

const actualDatabase = require('../../database.js');
const store = require('./store.js');
const engine = require('./engine.js');
const ratePaths = require('./rate-paths.js');
const { legacyProfileToTrack } = require('./legacy-adapter.js');
const { isIsoDate, todayIso } = require('./dates.js');
const marketData = require('../market-data.js');
const analysis = require('./analysis.js');
const health = require('./health.js');
const income = require('./income.js');
const reconciliation = require('./reconciliation.js');
const refinance = require('./refinance.js');
const debitMatcher = require('./debit-matcher.js');

let database = actualDatabase;
let dependencies = { store, marketData, income, now: () => new Date() };

const SCENARIO_FIELDS = ['primeShiftPct', 'primeOverridePct', 'cpiAnnualOverridePct', 'cpiShiftPct', 'anchorShiftPct'];

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseAccountId(value) {
  const accountId = Number(value);
  if (!Number.isInteger(accountId) || accountId <= 0) throw serviceError(400, 'accountId must be a positive integer');
  return accountId;
}

function normalizeScenario(raw = {}) {
  const scenario = {};
  for (const field of SCENARIO_FIELDS) {
    const value = raw[field];
    if (value === undefined || value === null || value === '') continue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < -20 || parsed > 30) throw serviceError(400, `${field} must be a number between -20 and 30`);
    scenario[field] = parsed;
  }
  return scenario;
}

function resolveAsOf(value) {
  if (value && isIsoDate(String(value).slice(0, 10))) return String(value).slice(0, 10);
  return todayIso(dependencies.now());
}

async function buildRatePaths(asOf, scenario) {
  const series = await dependencies.marketData.loadRatePathSeries();
  return ratePaths.buildPaths({ series, scenario, asOf });
}

function summarizeSchedule(schedule, source) {
  const { current, totals } = schedule;
  return {
    source,
    balance: current.balance,
    nextPayment: current.nextPayment,
    nextPaymentDate: current.nextPaymentDate,
    weightedRate: current.weightedRate,
    maturityDate: totals.maturityDate,
    drawn: totals.drawn,
    undrawn: engine.round2(current.byTrack.reduce((sum, track) => sum + (track.planned || 0), 0)),
    interestPaid: totals.paidToDate.interest,
    interestRemaining: totals.remaining.interest,
    indexationToDate: totals.paidToDate.indexation,
    totalCost: totals.totalCost,
    tracks: current.byTrack,
    warnings: schedule.warnings.filter((warning) => warning.code !== 'anchor_applied'),
  };
}

async function loadProfileRow(accountId) {
  const result = await database.query(
    `SELECT account_id, mortgage_balance, monthly_mortgage_payment, mortgage_interest_rate,
            mortgage_term_years, purchase_date, last_valuation_date, ownership_percentage,
            estimated_value
       FROM real_estate_properties WHERE account_id = $1`,
    [accountId],
  );
  return result.rows?.[0] || null;
}

/**
 * Resolve engine input for an account: detailed tracks when present, else the
 * legacy adapter.
 */
async function resolveMortgageInput(accountId, { asOf, profileRow } = {}) {
  const stored = await dependencies.store.getMortgageForAccount(accountId);
  if (stored && stored.tracks.length > 0) {
    return { source: 'tracks', stored, input: dependencies.store.toEngineInput(stored) };
  }
  const profile = profileRow === undefined ? await loadProfileRow(accountId) : profileRow;
  const legacy = legacyProfileToTrack(profile || {}, { asOf });
  if (legacy.mode === 'amortizing') {
    return { source: 'legacy', stored: null, legacy, input: { tracks: [legacy.track], events: [], options: {} } };
  }
  return { source: legacy.mode === 'static' ? 'static' : 'none', stored: null, legacy, input: null };
}

function staticSummary(legacy) {
  return {
    source: 'static',
    balance: legacy.balance,
    nextPayment: legacy.payment,
    nextPaymentDate: null,
    weightedRate: null,
    maturityDate: null,
    drawn: legacy.balance,
    undrawn: 0,
    interestPaid: null,
    interestRemaining: null,
    indexationToDate: null,
    totalCost: null,
    tracks: [],
    warnings: [{ code: 'legacy_static', message: 'Add a rate and payment (or detailed tracks) to project this mortgage' }],
  };
}

/** Full mortgage view for one property: structure, schedule and market context. */
async function getMortgageView(accountIdInput, options = {}) {
  const accountId = parseAccountId(accountIdInput);
  const asOf = resolveAsOf(options.asOf);
  const scenario = normalizeScenario(options.scenario);
  const resolved = await resolveMortgageInput(accountId, { asOf });
  if (!resolved.input) {
    return {
      accountId,
      asOf,
      source: resolved.source,
      mortgage: null,
      legacy: resolved.legacy?.mode === 'static' ? { balance: resolved.legacy.balance, payment: resolved.legacy.payment } : null,
      summary: resolved.source === 'static' ? staticSummary(resolved.legacy) : null,
      schedule: null,
      scenario,
    };
  }
  const paths = await buildRatePaths(asOf, scenario);
  const schedule = engine.buildMortgageSchedule({ ...resolved.input, paths, asOf });
  return {
    accountId,
    asOf,
    source: resolved.source,
    mortgage: resolved.stored,
    legacy: resolved.source === 'legacy' ? { track: resolved.legacy.track, termSource: resolved.legacy.termSource } : null,
    summary: summarizeSchedule(schedule, resolved.source),
    schedule,
    market: paths.meta,
    scenario,
  };
}

/** Compute a schedule for an unsaved draft (validated the same way as a save). */
async function previewMortgage(payload = {}) {
  const asOf = resolveAsOf(payload.asOf);
  const scenario = normalizeScenario(payload.scenario);
  const normalized = dependencies.store.normalizeMortgagePayload(payload.mortgage || {});
  const input = dependencies.store.toEngineInput(normalized);
  const paths = await buildRatePaths(asOf, scenario);
  const schedule = engine.buildMortgageSchedule({ ...input, paths, asOf });
  return { asOf, scenario, summary: summarizeSchedule(schedule, 'draft'), schedule, market: paths.meta };
}

/** Compare one draft track to a bank statement under nominal/effective quoting. */
async function calibrateTrack(payload = {}) {
  const asOf = resolveAsOf(payload.statement?.date);
  const normalized = dependencies.store.normalizeMortgagePayload({ tracks: [payload.track] });
  const input = dependencies.store.toEngineInput(normalized);
  const paths = await buildRatePaths(asOf, {});
  return engine.calibrateTrack(input.tracks[0], { ...payload.statement, date: asOf }, { paths, options: input.options });
}

/**
 * Write the computed balance / payment / weighted rate / remaining term back
 * into the legacy columns (and refresh the cached net equity), only when the
 * property uses detailed tracks.
 */
async function syncLegacyColumns(accountIdInput, { asOf: asOfInput, summary: precomputed } = {}) {
  const accountId = parseAccountId(accountIdInput);
  const asOf = resolveAsOf(asOfInput);
  const profile = await loadProfileRow(accountId);
  if (!profile) return { updated: false, reason: 'no_profile' };
  let summary = precomputed;
  if (!summary) {
    const resolved = await resolveMortgageInput(accountId, { asOf, profileRow: profile });
    if (resolved.source !== 'tracks') return { updated: false, reason: 'no_tracks' };
    const paths = await buildRatePaths(asOf, {});
    summary = summarizeSchedule(engine.buildMortgageSchedule({ ...resolved.input, paths, asOf }), 'tracks');
  }
  if (summary.source !== 'tracks') return { updated: false, reason: 'no_tracks' };

  // Off-plan: drawdowns still to come already finance the purchase, so the
  // stored total (used for net equity / net worth) includes them.
  const balance = Math.round(summary.balance + (summary.undrawn || 0));
  const payment = summary.nextPayment ? Math.round(summary.nextPayment * 100) / 100 : null;
  const rate = summary.weightedRate === null ? null : Math.round(summary.weightedRate * 1000) / 1000;
  const remainingYears = summary.maturityDate
    ? Math.max(0, Math.round(((Number(summary.maturityDate.slice(0, 4)) * 12 + Number(summary.maturityDate.slice(5, 7)))
      - (Number(asOf.slice(0, 4)) * 12 + Number(asOf.slice(5, 7)))) / 12 * 10) / 10)
    : null;
  const unchanged = Math.round(Number(profile.mortgage_balance) || 0) === balance
    && (Number(profile.monthly_mortgage_payment) || null) === payment
    && (Number(profile.mortgage_interest_rate) || null) === rate;
  if (unchanged) return { updated: false, reason: 'unchanged' };

  const ownership = (Number(profile.ownership_percentage) || 100) / 100;
  const estimatedValue = profile.estimated_value === null || profile.estimated_value === undefined
    ? null
    : Number(profile.estimated_value);
  const netEquity = estimatedValue === null ? null : Math.round(estimatedValue - balance * ownership);
  await database.query(
    `UPDATE real_estate_properties
        SET mortgage_balance = $1,
            monthly_mortgage_payment = $2,
            mortgage_interest_rate = $3,
            mortgage_term_years = $4,
            estimated_net_equity = COALESCE($5, estimated_net_equity),
            updated_at = CURRENT_TIMESTAMP
      WHERE account_id = $6`,
    [balance, payment, rate, remainingYears, netEquity, accountId],
  );
  return { updated: true, balance, payment, rate, remainingYears };
}

async function saveMortgage(accountIdInput, payload = {}) {
  const accountId = parseAccountId(accountIdInput);
  await dependencies.store.replaceMortgageForAccount(accountId, payload);
  await syncLegacyColumns(accountId);
  await refreshValuationSnapshot(accountId, { force: true }).catch(() => null);
  return getMortgageView(accountId);
}

const SNAPSHOT_NOTE_PREFIX = 'Real estate simulator valuation';

/** Pure: value change of a dwelling-price index between two months. */
function indexRatio(points, fromMonth, toMonth = null) {
  const sorted = (points || []).filter((point) => Number(point.value) > 0).sort((a, b) => (a.period < b.period ? -1 : 1));
  if (sorted.length === 0 || !fromMonth) return null;
  const from = [...sorted].reverse().find((point) => point.period <= fromMonth);
  if (!from) return null; // purchase predates the series
  const to = toMonth ? [...sorted].reverse().find((point) => point.period <= toMonth) : sorted[sorted.length - 1];
  if (!to) return null;
  return { ratio: Number(to.value) / Number(from.value), fromPeriod: from.period, toPeriod: to.period };
}

/**
 * Purchase price grown by the CBS dwelling-price index since the purchase
 * month. Series: the property setting, else new dwellings for off-plan
 * purchases (when its history covers the purchase), else national.
 */
async function priceIndexValuation(accountIdInput, overrides = {}) {
  const accountId = parseAccountId(accountIdInput);
  const [row, settings] = await Promise.all([loadPropertyRow(accountId), dependencies.store.getPropertySettings(accountId)]);
  const purchasePrice = Number(overrides.purchase_price ?? row?.purchase_price);
  const purchaseDate = String(overrides.purchase_date ?? row?.purchase_date ?? '').slice(0, 10);
  if (!(purchasePrice > 0) || !isIsoDate(purchaseDate)) return null;
  const purchaseMonth = purchaseDate.slice(0, 7);
  // The chosen series first; fall back to national if it has no data yet.
  const candidates = [...new Set([
    ...(settings.valueIndexSeries ? [settings.valueIndexSeries] : []),
    ...(settings.isOffPlan ? ['cbs.hpi.new_dwellings'] : []),
    'cbs.hpi.national',
  ])];
  for (const series of candidates) {
    const points = await dependencies.marketData.getSeriesPoints(series);
    const result = indexRatio(points, purchaseMonth);
    if (!result) continue;
    return {
      series,
      ...result,
      ratio: Math.round(result.ratio * 1e6) / 1e6,
      value: Math.round(purchasePrice * result.ratio),
      purchasePrice,
      purchaseMonth,
      noDataSincePurchase: result.toPeriod < purchaseMonth || result.fromPeriod === result.toPeriod,
    };
  }
  return null;
}

/** Re-value a property whose valuation method is the price index. */
async function applyIndexedValue(accountId, asOf) {
  const row = (await database.query(
    'SELECT valuation_method, ownership_percentage, estimated_value, mortgage_balance FROM real_estate_properties WHERE account_id = $1',
    [accountId],
  )).rows?.[0];
  if (!row || row.valuation_method !== 'price_index') return { updated: false };
  const valuation = await priceIndexValuation(accountId);
  if (!valuation) return { updated: false };
  const ownership = (Number(row.ownership_percentage) || 100) / 100;
  const owned = Math.round(valuation.value * ownership);
  if (Math.abs(owned - (Number(row.estimated_value) || 0)) < 1) return { updated: false };
  await database.query(
    `UPDATE real_estate_properties
        SET estimated_value = $1, scenario_base = $1,
            scenario_conservative = $2, scenario_optimistic = $3,
            estimated_net_equity = $4, last_valuation_date = $5, updated_at = CURRENT_TIMESTAMP
      WHERE account_id = $6`,
    [owned, Math.round(owned * 0.92), Math.round(owned * 1.08), Math.round(owned - (Number(row.mortgage_balance) || 0) * ownership), asOf, accountId],
  );
  return { updated: true, value: owned };
}
let lastRefreshAt = 0;

/**
 * Keep the net-worth holding of a property with detailed tracks current: the
 * stored mortgage columns are re-synced from the schedule, then a dated
 * valuation snapshot (net equity) is written when the latest one is stale.
 * One snapshot per day at most, so net-worth history shows the debt falling.
 */
async function refreshValuationSnapshot(accountIdInput, { force = false } = {}) {
  const accountId = parseAccountId(accountIdInput);
  const asOf = resolveAsOf();
  const sync = await syncLegacyColumns(accountId, { asOf });
  if (sync.reason === 'no_profile') return { refreshed: false, reason: sync.reason };
  const indexed = await applyIndexedValue(accountId, asOf);
  if (sync.reason === 'no_tracks' && !indexed.updated && !force) return { refreshed: false, reason: 'no_tracks' };
  const latest = (await database.query(
    `SELECT current_value, as_of_date FROM investment_holdings
      WHERE account_id = $1 AND COALESCE(holding_type, 'standard') = 'standard' AND notes LIKE $2
      ORDER BY as_of_date DESC, id DESC LIMIT 1`,
    [accountId, `${SNAPSHOT_NOTE_PREFIX}%`],
  )).rows?.[0] || null;
  const profile = (await database.query(
    'SELECT estimated_net_equity, estimated_value FROM real_estate_properties WHERE account_id = $1',
    [accountId],
  )).rows?.[0];
  if (!profile || !(Number(profile.estimated_value) > 0)) return { refreshed: false, reason: 'no_estimate' };
  const target = Number(profile.estimated_net_equity);
  const latestDate = latest?.as_of_date ? String(latest.as_of_date).slice(0, 10) : null;
  const ageDays = latestDate ? (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${latestDate}T00:00:00Z`)) / 86_400_000 : Infinity;
  const differs = !latest || !Number.isFinite(target) || Math.abs(Number(latest.current_value) - target) > 500;
  if (!force && !(differs || ageDays >= 28)) return { refreshed: false, reason: 'fresh' };
  if (latestDate === asOf && !differs) return { refreshed: false, reason: 'fresh' };
  // Lazy require: the simulator does not depend on this module.
  const simulator = dependencies.simulator || require('../real-estate-simulator.js');
  await simulator.applyRealEstateValuation({ accountId, asOfDate: asOf });
  return { refreshed: true, asOf };
}

/** Refresh every property with detailed tracks (throttled to once an hour unless forced). */
async function refreshValuationSnapshots({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastRefreshAt < 3_600_000) return { skipped: true };
  lastRefreshAt = now;
  await dependencies.store.ensureSchema();
  const accounts = (await database.query(
    `SELECT account_id FROM mortgage_loans
     UNION SELECT account_id FROM real_estate_properties WHERE valuation_method = 'price_index'`,
  )).rows || [];
  const results = [];
  for (const row of accounts) {
    try {
      results.push({ accountId: Number(row.account_id), ...(await refreshValuationSnapshot(row.account_id)) });
    } catch (error) {
      results.push({ accountId: Number(row.account_id), refreshed: false, error: error.message });
    }
  }
  return { skipped: false, results };
}

async function deleteMortgage(accountIdInput) {
  const accountId = parseAccountId(accountIdInput);
  // The single-mortgage fields fall back to the legacy adapter, which reads
  // the balance as of last_valuation_date: make them describe today first.
  const asOf = resolveAsOf();
  try {
    await syncLegacyColumns(accountId, { asOf });
    await database.query(
      'UPDATE real_estate_properties SET last_valuation_date = $1, updated_at = CURRENT_TIMESTAMP WHERE account_id = $2',
      [asOf, accountId],
    );
  } catch (_error) {
    // Deleting must still work if the profile cannot be refreshed.
  }
  await dependencies.store.deleteMortgageForAccount(accountId);
  return { deleted: true };
}

/**
 * Attach a live mortgage summary to each property of the real-estate
 * overview. Properties with detailed tracks get their mortgage figures
 * replaced by today's computed values. Read-only: stored columns are
 * refreshed on save and by the (throttled) net-worth refresh.
 */
async function enrichOverview(overview, { summarize } = {}) {
  if (!overview || !Array.isArray(overview.properties)) return overview;
  const asOf = resolveAsOf();
  let paths = null;
  const properties = [];
  for (const property of overview.properties) {
    let mortgage = null;
    try {
      const resolved = await resolveMortgageInput(property.accountId, { asOf });
      if (resolved.input) {
        paths = paths || await buildRatePaths(asOf, {});
        const schedule = engine.buildMortgageSchedule({ ...resolved.input, paths, asOf });
        mortgage = summarizeSchedule(schedule, resolved.source);
      } else if (resolved.source === 'static') {
        mortgage = staticSummary(resolved.legacy);
      }
    } catch (error) {
      mortgage = { source: 'error', warnings: [{ code: 'mortgage_error', message: error.message }] };
    }

    if (mortgage?.source === 'tracks') {
      const ownership = (property.ownershipPercentage || 100) / 100;
      // Debt = drawn balance + drawdowns still to come (off-plan commitments).
      const committedBalance = mortgage.balance + (mortgage.undrawn || 0);
      const ownedMortgageBalance = Math.round(committedBalance * ownership);
      const netEquity = property.ownedPropertyValue === null || property.ownedPropertyValue === undefined
        ? property.netEquity
        : Math.round(property.ownedPropertyValue - ownedMortgageBalance);
      const monthlyMortgagePayment = mortgage.nextPayment ? Math.round(mortgage.nextPayment) : null;
      const monthlyRent = property.monthlyRent || 0;
      const monthlyExpenses = Math.round((property.annualExpenses || 0) / 12);
      properties.push({
        ...property,
        totalMortgageBalance: Math.round(committedBalance),
        drawnMortgageBalance: Math.round(mortgage.balance),
        undrawnMortgageAmount: Math.round(mortgage.undrawn || 0),
        ownedMortgageBalance,
        netEquity,
        monthlyMortgagePayment,
        mortgageInterestRate: mortgage.weightedRate,
        loanToValue: property.propertyMarketValue ? (committedBalance / property.propertyMarketValue) * 100 : null,
        equityRatio: property.ownedPropertyValue ? (netEquity / property.ownedPropertyValue) * 100 : property.equityRatio,
        monthlyCashFlow: Math.round(monthlyRent - (monthlyMortgagePayment || 0) - monthlyExpenses),
        annualDebtService: monthlyMortgagePayment === null ? null : monthlyMortgagePayment * 12,
        mortgage,
      });
    } else {
      properties.push({ ...property, mortgage });
    }
  }
  return {
    ...overview,
    summary: typeof summarize === 'function' ? summarize(properties) : overview.summary,
    properties,
    market: paths ? paths.meta : null,
  };
}

// ---------------------------------------------------------------------------
// Sale / break-even analysis and mortgage health
// ---------------------------------------------------------------------------

async function loadPropertyRow(accountId) {
  const result = await database.query(
    `SELECT account_id, purchase_price, purchase_date, annual_growth_rate, annual_expenses,
            ownership_percentage, estimated_value, manual_estimated_value, monthly_rent
       FROM real_estate_properties WHERE account_id = $1`,
    [accountId],
  );
  return result.rows?.[0] || null;
}

function grossPropertyValue(row) {
  if (!row) return null;
  const ownership = (Number(row.ownership_percentage) || 100) / 100;
  if (Number(row.estimated_value) > 0) return Number(row.estimated_value) / ownership;
  if (Number(row.manual_estimated_value) > 0) return Number(row.manual_estimated_value);
  if (Number(row.purchase_price) > 0) return Number(row.purchase_price);
  return null;
}

/** Latest BoI average new-mortgage rates in the shape analysis/health expect. */
function marketAverages(series) {
  const last = (points) => (points && points.length ? points[points.length - 1] : null);
  const variable = last(series.marketRates?.variable_cpi);
  const anchor = variable ? (series.anchors?.variable_cpi || []).find((point) => point.period === variable.period) : null;
  return {
    fixed_unlinked: last(series.marketRates?.fixed_unlinked),
    fixed_cpi: last(series.marketRates?.fixed_cpi),
    variable_cpi: variable
      ? { ...variable, anchor: anchor?.value ?? null, margin: anchor ? variable.value - anchor.value : null }
      : null,
  };
}

async function resolveIncome(settings, now) {
  const override = Number(settings?.monthlyIncomeOverride);
  if (Number.isFinite(override) && override > 0) {
    return { monthly: override, method: 'manual', source: 'manual', months: [] };
  }
  try {
    return await dependencies.income.detectMonthlyIncome({ now });
  } catch (error) {
    return { monthly: null, source: 'error', error: error.message, months: [] };
  }
}

/**
 * "What does prepaying help?": prepay on the most expensive track and
 * measure interest saved over the life of the loan (shorter term).
 */
function buildPrepaymentInsight(baseInput, baseSchedule, paths, asOf, fees) {
  const candidates = baseSchedule.current.byTrack.filter((track) => track.balance > 0 && track.currentRate !== null);
  if (candidates.length === 0) return null;
  const target = candidates.reduce((best, track) => (track.currentRate > best.currentRate ? track : best));
  const amount = Math.min(100000, Math.round(target.balance * 0.5 / 1000) * 1000) || Math.round(target.balance / 2);
  // After the last drawdown, so off-plan tranches are merged into the term.
  const lastDraw = (baseInput.tracks || []).flatMap((track) => track.tranches || [])
    .reduce((latest, tranche) => (tranche.drawDate > latest ? tranche.drawDate : latest), asOf);
  const date = addDays(lastDraw > asOf ? lastDraw : asOf, 15);
  const withPrepay = engine.buildMortgageSchedule({
    ...baseInput,
    events: [...(baseInput.events || []), { trackId: target.trackId, type: 'prepay_partial', date, amount, mode: 'reduce_term' }],
    paths,
    asOf,
  });
  const interestSaved = baseSchedule.totals.lifetime.interest + baseSchedule.totals.lifetime.indexation
    - (withPrepay.totals.lifetime.interest + withPrepay.totals.lifetime.indexation);
  const trackFee = fees?.tracks?.find((track) => String(track.trackId) === String(target.trackId));
  const feeEstimate = trackFee && trackFee.balance > 0
    ? ((trackFee.capitalization || 0) + (trackFee.cpiAverage || 0)) * (amount / trackFee.balance)
    : 0;
  const trackAfter = withPrepay.tracks.find((track) => String(track.trackId) === String(target.trackId));
  return {
    trackId: target.trackId,
    type: target.type,
    rate: target.currentRate,
    amount,
    interestSaved: Math.round(interestSaved),
    feeEstimate: Math.round(feeEstimate),
    monthsShortened: trackAfter && target.maturityDate && trackAfter.maturityDate
      ? Math.max(0, (Number(target.maturityDate.slice(0, 4)) * 12 + Number(target.maturityDate.slice(5, 7)))
        - (Number(trackAfter.maturityDate.slice(0, 4)) * 12 + Number(trackAfter.maturityDate.slice(5, 7))))
      : null,
  };
}

function addDays(date, days) {
  const time = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

/** Sale / break-even analysis + mortgage health for one property. */
async function getPropertyAnalysis(accountIdInput, options = {}) {
  const accountId = parseAccountId(accountIdInput);
  const asOf = resolveAsOf(options.asOf);
  const now = dependencies.now();
  const [row, settings, storedCosts, linked] = await Promise.all([
    loadPropertyRow(accountId),
    dependencies.store.getPropertySettings(accountId),
    dependencies.store.listPropertyCosts(accountId),
    loadLinkedTransactions(accountId),
  ]);
  // Without saved costs, use the payments linked to the property account.
  const detectedCosts = storedCosts.length ? [] : costsFromLinkedTransactions(linked, Number(row?.purchase_price) || 0);
  const costs = storedCosts.length ? storedCosts : detectedCosts;
  const resolved = await resolveMortgageInput(accountId, { asOf });
  const series = await dependencies.marketData.loadRatePathSeries();
  const market = marketAverages(series);
  const pathsFor = (scenario) => ratePaths.buildPaths({ series, scenario, asOf });
  const basePaths = pathsFor({});
  const input = resolved.input;
  const runWith = (paths) => (input ? engine.buildMortgageSchedule({ ...input, paths, asOf }) : null);
  const baseSchedule = runWith(basePaths);
  const summary = baseSchedule ? summarizeSchedule(baseSchedule, resolved.source) : null;
  const value = grossPropertyValue(row);

  const saleInput = {
    asOf,
    property: {
      value,
      ownershipPct: Number(row?.ownership_percentage) || 100,
      purchasePrice: row?.purchase_price ?? null,
      purchaseDate: row?.purchase_date ?? null,
      annualGrowthPct: row?.annual_growth_rate ?? 3,
      annualOwnerCosts: row?.annual_expenses ?? 0,
    },
    schedule: baseSchedule,
    inputTracks: input?.tracks || [],
    costs,
    settings: { ...settings, marketRent: settings.marketRent ?? (Number(row?.monthly_rent) || null) },
    market,
    cpiKnownIndexAt: basePaths.cpiKnownIndexAt,
    approvedAmount: resolved.stored?.approvedAmount ?? null,
  };
  const sale = analysis.buildSaleAnalysis(saleInput);
  if (detectedCosts.length) sale.assumptions = ['costs_from_linked_transactions', ...sale.assumptions];
  sale.indexedValue = await priceIndexValuation(accountId).catch(() => null);
  sale.breakEvenAppreciationPct10y = sale.alternative ? analysis.breakEvenAppreciation(saleInput, 10) : null;

  let mortgageHealth = null;
  if (baseSchedule) {
    const incomeInfo = await resolveIncome(settings, now);
    mortgageHealth = health.buildMortgageHealth({
      summary,
      inputTracks: input.tracks,
      market,
      income: incomeInfo,
      propertyValue: value,
      schedules: {
        base: baseSchedule,
        prime1: runWith(pathsFor({ primeShiftPct: 1 })),
        combined: runWith(pathsFor({ primeShiftPct: 2, cpiAnnualOverridePct: 4, anchorShiftPct: 1 })),
      },
      prepayment: buildPrepaymentInsight(input, baseSchedule, basePaths, asOf, sale.debt.prepaymentFees),
    });
  }

  return {
    accountId,
    asOf,
    source: resolved.source,
    settings,
    costs,
    market,
    sale,
    health: mortgageHealth,
  };
}

// ---------------------------------------------------------------------------
// Bank debits: matcher, reconciliation, purchase costs from linked transactions
// ---------------------------------------------------------------------------

async function loadLinkedTransactions(accountId) {
  try {
    const result = await database.query(
      `SELECT t.identifier, t.name, t.vendor, t.account_number, t.price, t.date
         FROM transaction_account_links tal
         JOIN transactions t ON t.identifier = tal.transaction_identifier AND t.vendor = tal.transaction_vendor
        WHERE tal.account_id = $1
        ORDER BY t.date ASC`,
      [accountId],
    );
    return result.rows || [];
  } catch (_error) {
    return [];
  }
}

async function loadRecentOutflows(sinceDate) {
  const result = await database.query(
    `SELECT name, vendor, account_number, price, date FROM transactions
      WHERE price < 0 AND date >= $1 ORDER BY date ASC`,
    [sinceDate],
  );
  return result.rows || [];
}

/** First transaction date on the account the mortgage is debited from (or overall). */
async function loadHistoryStart(matcher) {
  const conditions = [];
  const params = [];
  if (matcher?.vendor) {
    params.push(matcher.vendor);
    conditions.push(`vendor = $${params.length}`);
  }
  if (matcher?.accountNumber) {
    params.push(matcher.accountNumber);
    conditions.push(`account_number = $${params.length}`);
  }
  const result = await database.query(
    `SELECT MIN(date) AS first_date FROM transactions${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''}`,
    params,
  );
  const first = result.rows?.[0]?.first_date;
  return first ? (debitMatcher.transactionDate(first) || String(first).slice(0, 10)) : null;
}

async function resolveMatcher(stored, accountId, recentOutflows) {
  const saved = debitMatcher.matcherFromLoan(stored);
  if (saved) return saved;
  const linked = debitMatcher.deriveMatcher(await loadLinkedTransactions(accountId));
  if (linked) return linked;
  const fallback = debitMatcher.deriveMatcher(recentOutflows);
  return fallback ? { ...fallback, source: 'detected' } : null;
}

/** Computed vs actual mortgage debits, month by month. */
async function getReconciliation(accountIdInput, options = {}) {
  const accountId = parseAccountId(accountIdInput);
  const asOf = resolveAsOf(options.asOf);
  const stored = await dependencies.store.getMortgageForAccount(accountId);
  if (!stored || stored.tracks.length === 0) {
    return { accountId, status: 'no_tracks', matcher: null, candidates: [], months: [], summary: null };
  }
  const input = dependencies.store.toEngineInput(stored);
  const firstDraw = input.tracks.flatMap((track) => track.tranches).map((tranche) => tranche.drawDate).sort()[0] || asOf;
  const since = addDays(firstDraw, -40);
  const outflows = await loadRecentOutflows(since < addDays(asOf, -400) ? since : addDays(asOf, -400));
  const matcher = await resolveMatcher(stored, accountId, outflows);
  const paths = await buildRatePaths(asOf, {});
  const schedule = engine.buildMortgageSchedule({ ...input, paths, asOf });
  const historyStart = await loadHistoryStart(matcher);
  const result = reconciliation.reconcileMortgage({
    schedule,
    transactions: outflows.filter((row) => String(row.date).slice(0, 10) >= since),
    matcher,
    today: asOf,
    historyStart,
  });
  return {
    accountId,
    ...result,
    matcher,
    candidates: reconciliation.matcherCandidates(outflows, debitMatcher.isMortgagePayment, debitMatcher.normalizeName),
  };
}

async function savePaymentMatcher(accountIdInput, payload = {}) {
  const accountId = parseAccountId(accountIdInput);
  await dependencies.store.updatePaymentMatcher(accountId, payload);
  return getReconciliation(accountId);
}

/**
 * Own-funds payments linked to the property account (down payment, lawyer,
 * developer vouchers…), excluding mortgage debits. Large payments (≥ 5% of
 * the price) are treated as part of the price; smaller ones as deductible costs.
 */
function costsFromLinkedTransactions(linked, purchasePrice) {
  return linked
    .filter((row) => Number(row.price) < 0 && !debitMatcher.isMortgagePayment(row.name))
    .map((row) => {
      const amount = Math.abs(Number(row.price));
      const partOfPrice = purchasePrice > 0 && amount >= purchasePrice * 0.05;
      return {
        type: partOfPrice ? 'down_payment' : 'other',
        label: row.name,
        amount,
        date: debitMatcher.transactionDate(row.date) || String(row.date).slice(0, 10),
        status: 'paid',
        deductible: !partOfPrice,
        detected: true,
      };
    });
}

// ---------------------------------------------------------------------------
// Stress test and refinance
// ---------------------------------------------------------------------------

async function loadMortgageContext(accountId, asOf) {
  const resolved = await resolveMortgageInput(accountId, { asOf });
  if (!resolved.input) throw serviceError(400, 'Add your mortgage tracks first');
  const series = await dependencies.marketData.loadRatePathSeries();
  return {
    resolved,
    series,
    market: marketAverages(series),
    paths: ratePaths.buildPaths({ series, scenario: {}, asOf }),
  };
}

const MAX_CUSTOM_SCENARIOS = 4;

async function getStressTest(accountIdInput, payload = {}) {
  const accountId = parseAccountId(accountIdInput);
  const asOf = resolveAsOf(payload.asOf);
  const { resolved, series } = await loadMortgageContext(accountId, asOf);
  const custom = (Array.isArray(payload.scenarios) ? payload.scenarios : [])
    .slice(0, MAX_CUSTOM_SCENARIOS)
    .map((item, index) => ({ key: `custom${index + 1}`, label: typeof item?.label === 'string' ? item.label.slice(0, 60) : null, scenario: normalizeScenario(item?.scenario || item) }));
  const settings = await dependencies.store.getPropertySettings(accountId).catch(() => ({}));
  const incomeInfo = await resolveIncome(settings, dependencies.now());
  return refinance.buildStressTest({
    asOf,
    monthlyIncome: incomeInfo?.monthly ?? null,
    scenarios: [...refinance.STRESS_PRESETS, ...custom],
    runSchedule: (scenario) => engine.buildMortgageSchedule({
      ...resolved.input,
      paths: ratePaths.buildPaths({ series, scenario, asOf }),
      asOf,
    }),
  });
}

async function getRefinanceCheck(accountIdInput, options = {}) {
  const accountId = parseAccountId(accountIdInput);
  const asOf = resolveAsOf(options.asOf);
  const { resolved, market, paths } = await loadMortgageContext(accountId, asOf);
  const switchingCosts = Number.isFinite(Number(options.switchingCosts)) && options.switchingCosts !== '' && options.switchingCosts !== undefined
    ? Number(options.switchingCosts)
    : refinance.DEFAULT_SWITCHING_COSTS;
  return {
    asOf,
    market,
    switchingCosts,
    tracks: refinance.buildRefinanceCheck({ asOf, input: resolved.input, paths, market, switchingCosts }),
  };
}

const OFFER_TRACK_TYPES = new Set(['prime', 'fixed_unlinked', 'fixed_cpi', 'variable_unlinked', 'variable_cpi']);

function normalizeOfferTracks(raw) {
  const tracks = Array.isArray(raw) ? raw.slice(0, 8) : [];
  return tracks.map((track, index) => {
    if (!OFFER_TRACK_TYPES.has(track?.type)) throw serviceError(400, `offerTracks[${index}].type is not supported`);
    const number = (value, name, min, max) => {
      if (value === null || value === undefined || value === '') return null;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw serviceError(400, `offerTracks[${index}].${name} is out of range`);
      return parsed;
    };
    const normalized = {
      type: track.type,
      rate: number(track.rate, 'rate', -5, 30),
      margin: number(track.margin, 'margin', -10, 15),
      rateConvention: track.rateConvention === 'effective' ? 'effective' : 'nominal',
      termMonths: number(track.termMonths, 'termMonths', 1, 600) ?? 360,
      sharePct: number(track.sharePct, 'sharePct', 0, 100),
      resetPeriodMonths: number(track.resetPeriodMonths, 'resetPeriodMonths', 1, 360) ?? (track.type.startsWith('variable') ? 60 : null),
    };
    if (normalized.type === 'prime' && normalized.margin === null) throw serviceError(400, `offerTracks[${index}].margin is required for prime`);
    if (normalized.type !== 'prime' && normalized.rate === null) throw serviceError(400, `offerTracks[${index}].rate is required`);
    return normalized;
  });
}

async function previewRefinance(accountIdInput, payload = {}) {
  const accountId = parseAccountId(accountIdInput);
  const asOf = resolveAsOf(payload.asOf);
  const { resolved, market, paths } = await loadMortgageContext(accountId, asOf);
  const knownIds = new Set(resolved.input.tracks.map((track) => String(track.id)));
  const closeTrackIds = (Array.isArray(payload.closeTrackIds) ? payload.closeTrackIds : []).map(String).filter((id) => knownIds.has(id));
  const date = payload.date && isIsoDate(String(payload.date).slice(0, 10)) ? String(payload.date).slice(0, 10) : undefined;
  if (date && date < asOf) throw serviceError(400, 'The refinance date cannot be in the past');
  return refinance.compareRefinance({
    asOf,
    input: resolved.input,
    paths,
    market,
    closeTrackIds,
    offerTracks: normalizeOfferTracks(payload.offerTracks),
    date,
    switchingCosts: payload.switchingCosts,
    financeFees: payload.financeFees,
    discountRatePct: payload.discountRatePct,
  });
}

async function savePropertySettings(accountIdInput, payload) {
  const accountId = parseAccountId(accountIdInput);
  return dependencies.store.replacePropertySettings(accountId, payload || {});
}

async function savePropertyCosts(accountIdInput, payload) {
  const accountId = parseAccountId(accountIdInput);
  return dependencies.store.replacePropertyCosts(accountId, payload || []);
}

module.exports = {
  getRefinanceCheck,
  getStressTest,
  previewRefinance,
  indexRatio,
  priceIndexValuation,
  refreshValuationSnapshot,
  refreshValuationSnapshots,
  calibrateTrack,
  costsFromLinkedTransactions,
  getReconciliation,
  savePaymentMatcher,
  getPropertyAnalysis,
  savePropertyCosts,
  savePropertySettings,
  deleteMortgage,
  enrichOverview,
  getMortgageView,
  normalizeScenario,
  previewMortgage,
  saveMortgage,
  syncLegacyColumns,
  __setDependencies(overrides = {}) {
    if (overrides.database) database = overrides.database;
    dependencies = { ...dependencies, ...overrides };
  },
  __resetDependencies() {
    lastRefreshAt = 0;
    database = actualDatabase;
    dependencies = { store, marketData, income, now: () => new Date() };
  },
};
