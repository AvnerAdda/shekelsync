const actualDatabase = require('../database.js');
const historyModule = require('./history.js');
const fxModule = require('./fx.js');
const {
  fetchLinkedInvestmentTransactions,
} = require('./linked-transaction-rollforward.js');

let database = actualDatabase;
let historyService = historyModule;
let fxService = fxModule;

const DEFAULT_ASSET_SCOPE = 'exclude_real_estate';
const FEE_KEYWORDS = ['fee', 'fees', 'commission', 'עמלה', 'עמלות'];
const DIVIDEND_KEYWORDS = ['dividend', 'דיבידנד'];
const INTEREST_KEYWORDS = ['interest', 'ריבית'];
const INVESTMENT_INCOME_KEYWORDS = [...INTEREST_KEYWORDS, ...DIVIDEND_KEYWORDS];
const CAPITAL_RETURN_KEYWORDS = ['capital return', 'capital returns', 'החזר קרן'];
const INVESTMENT_TAX_KEYWORDS = [
  'investment tax',
  'tax withholding',
  'withholding tax',
  'מס על השקעות',
  'ניכוי מס',
  'retenue d’impôt',
  "retenue d'impôt",
];

function coerceBoolean(value) {
  return value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true';
}

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateStr(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.split('T')[0];
  return new Date(value).toISOString().split('T')[0];
}

async function normalizeMonetaryRows(rows, {
  baseCurrency,
  currencyFor,
  dateFor,
  fields,
  kind,
} = {}) {
  const normalized = [];
  const missing = [];
  const rateCache = new Map();

  for (const row of rows || []) {
    const currency = String(currencyFor(row) || baseCurrency).trim().toUpperCase();
    const date = toDateStr(dateFor(row));
    const cacheKey = `${currency}|${baseCurrency}|${date}`;
    let rate = rateCache.get(cacheKey);
    if (!rate) {
      rate = await fxService.getRate({
        fromCurrency: currency,
        toCurrency: baseCurrency,
        date,
      });
      rateCache.set(cacheKey, rate);
    }
    if (rate.rate === null || rate.status === 'missing' || rate.status === 'stale') {
      missing.push({ kind, currency, date, status: rate.status });
      continue;
    }

    const converted = { ...row, native_currency: currency, currency: baseCurrency };
    fields.forEach((field) => {
      if (row[field] === null || row[field] === undefined || row[field] === '') return;
      const amount = Number(row[field]);
      if (!Number.isFinite(amount)) return;
      converted[`native_${field}`] = amount;
      converted[field] = amount * rate.rate;
    });
    normalized.push(converted);
  }

  return { rows: normalized, missing };
}

function lower(value) {
  return String(value || '').toLowerCase();
}

function matchesKeyword(text, keywords) {
  const normalized = lower(text);
  return keywords.some((keyword) => normalized.includes(keyword));
}

function addFlow(map, date, updater) {
  if (!date) return;
  if (!map.has(date)) {
    map.set(date, {
      contributions: 0,
      withdrawals: 0,
      capitalReturns: 0,
      income: 0,
      fees: 0,
      taxes: 0,
      dividends: 0,
      interest: 0,
    });
  }

  updater(map.get(date));
}

function buildAttribution({
  endValue = null,
  endCostBasis = null,
  realizedGainGross = null,
  realizedGainNet = null,
  hasPositionEvents = false,
} = {}) {
  const unrealizedGain = endValue === null || endCostBasis === null
    ? null
    : endValue - endCostBasis;

  return {
    basis: 'snapshots_and_linked_transactions',
    returnBasis: 'gross_of_linked_fees_and_taxes',
    formula:
      'valueChange = contributions - withdrawals - capitalReturns - income - fees - taxes + marketMove',
    realizedGainGross,
    realizedGainNet,
    realizedStatus: hasPositionEvents
      ? 'explicit_position_events'
      : 'unavailable_without_explicit_disposal_basis',
    unrealizedGain,
    unrealizedStatus: unrealizedGain === null ? 'unavailable' : 'snapshot_estimate',
  };
}

function buildEmptyPerformanceResponse(range, requestedStartDate = null, reason = 'insufficient_history') {
  return {
    range,
    requestedStartDate: toDateStr(requestedStartDate),
    startDate: null,
    endDate: null,
    startValue: null,
    endValue: null,
    valueChange: null,
    netFlows: {
      contributions: 0,
      withdrawals: 0,
      netContributions: 0,
    },
    capitalReturns: 0,
    income: 0,
    fees: 0,
    taxes: 0,
    dividends: 0,
    interest: 0,
    marketMove: null,
    twr: null,
    mwr: null,
    method: 'unavailable',
    quality: 'unavailable',
    metricSemantics: {
      outputField: 'twr',
      isTrueTwr: false,
      description: 'No defensible portfolio return is available for this period.',
    },
    confidence: {
      level: 'unavailable',
      score: null,
      reasons: [reason],
      historyPoints: 0,
      actualValuationPoints: null,
      cashFlowDays: 0,
      flowBoundaryCoverage: null,
    },
    attribution: buildAttribution(),
    timeline: [],
  };
}

function normalizeAccountIds(accountIds) {
  if (!accountIds) return [];
  const values = Array.isArray(accountIds) ? accountIds : [accountIds];
  return Array.from(new Set(
    values
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value)),
  ));
}

function normalizeAssetScope(value) {
  const normalized = String(value || DEFAULT_ASSET_SCOPE).trim().toLowerCase();
  if (normalized === 'without_real_estate' || normalized === 'exclude-real-estate') {
    return 'exclude_real_estate';
  }
  if (['all', 'liquid', 'restricted', 'illiquid', 'exclude_real_estate'].includes(normalized)) {
    return normalized;
  }
  return DEFAULT_ASSET_SCOPE;
}

async function loadAccountIdsForScope(scope) {
  if (scope === 'all') {
    return [];
  }

  const conditions = ['ia.is_active = true'];
  const params = [];

  if (scope === 'exclude_real_estate') {
    conditions.push("ia.account_type <> 'real_estate'");
  } else if (scope === 'illiquid') {
    conditions.push("(ia.account_type = 'real_estate' OR ia.investment_category = 'illiquid')");
  } else {
    params.push(scope);
    conditions.push(`ia.investment_category = $${params.length}`);
    if (scope !== 'illiquid') {
      conditions.push("ia.account_type <> 'real_estate'");
    }
  }

  const result = await database.query(
    `
      SELECT ia.id
      FROM investment_accounts ia
      WHERE ${conditions.join(' AND ')}
      ORDER BY ia.id ASC
    `,
    params,
  );

  return (result.rows || [])
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id));
}

function calculateTwr(timeline) {
  if (!Array.isArray(timeline) || timeline.length < 2) return null;

  let twr = 1;
  let calculatedPeriods = 0;
  for (let index = 1; index < timeline.length; index += 1) {
    const previous = timeline[index - 1];
    const current = timeline[index];
    const startValue = toNumber(previous.currentValue);
    if (startValue <= 0) continue;

    const valueChange = toNumber(current.currentValue) - startValue;
    const netExternalFlow =
      toNumber(current.contributions)
      - toNumber(current.withdrawals)
      - toNumber(current.capitalReturns)
      - toNumber(current.income)
      - toNumber(current.fees)
      - toNumber(current.taxes);
    const dailyReturn = (valueChange - netExternalFlow) / startValue;
    twr *= 1 + dailyReturn;
    calculatedPeriods += 1;
  }

  return calculatedPeriods > 0 ? twr - 1 : null;
}

function getValuationMarker(point) {
  if (!point || typeof point !== 'object') return null;
  if (typeof point.isActualValuation === 'boolean') return point.isActualValuation;
  if (typeof point.isValuation === 'boolean') return point.isValuation;
  if (typeof point.isForwardFilled === 'boolean') return !point.isForwardFilled;
  return null;
}

function signedExternalFlow(point = {}) {
  return (
    toNumber(point.contributions)
    - toNumber(point.withdrawals)
    - toNumber(point.capitalReturns)
    - toNumber(point.income)
    - toNumber(point.fees)
    - toNumber(point.taxes)
  );
}

function calculateModifiedDietz(timeline) {
  if (!Array.isArray(timeline) || timeline.length < 2) return null;
  const first = timeline[0];
  const last = timeline[timeline.length - 1];
  const startValue = toNullableNumber(first?.currentValue);
  const endValue = toNullableNumber(last?.currentValue);
  const startTime = new Date(`${toDateStr(first?.date)}T00:00:00.000Z`).getTime();
  const endTime = new Date(`${toDateStr(last?.date)}T00:00:00.000Z`).getTime();
  const duration = endTime - startTime;
  if (
    startValue === null
    || endValue === null
    || !Number.isFinite(startTime)
    || !Number.isFinite(endTime)
    || duration <= 0
  ) {
    return null;
  }

  let totalFlow = 0;
  let weightedFlow = 0;
  // Modified Dietz:
  //   R = (ending value - beginning value - net external flows)
  //       / (beginning value + time-weighted net external flows)
  // Contributions are positive flows into the portfolio; withdrawals,
  // distributions, linked fees, and linked taxes are negative flows.
  for (const point of timeline) {
    const flow = signedExternalFlow(point);
    if (flow === 0) continue;
    const flowTime = new Date(`${toDateStr(point.date)}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(flowTime)) return null;
    const weight = Math.max(0, Math.min(1, (endTime - flowTime) / duration));
    totalFlow += flow;
    weightedFlow += weight * flow;
  }

  const denominator = startValue + weightedFlow;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  const result = (endValue - startValue - totalFlow) / denominator;
  return Number.isFinite(result) ? result : null;
}

function assessDailyLinkedCoverage(history, timeline) {
  const historyPoints = Array.isArray(history) ? history.length : 0;
  const markers = (history || []).map(getValuationMarker);
  const hasCompleteProvenance = markers.every((marker) => marker !== null);
  const actualValuationPoints = hasCompleteProvenance
    ? markers.filter(Boolean).length
    : null;
  const flowIndexes = (timeline || [])
    .map((point, index) => (Math.abs(signedExternalFlow(point)) > 0 ? index : null))
    .filter((index) => index !== null);
  const coveredFlowBoundaries = hasCompleteProvenance
    ? flowIndexes.filter((index) => index > 0 && markers[index - 1] === true && markers[index] === true).length
    : 0;
  const flowBoundaryCoverage = hasCompleteProvenance
    ? (flowIndexes.length > 0 ? coveredFlowBoundaries / flowIndexes.length : 1)
    : null;
  const periodBoundariesObserved = hasCompleteProvenance
    && markers[0] === true
    && markers[markers.length - 1] === true;
  const dailyDenominatorsValid = (timeline || [])
    .slice(0, -1)
    .every((point) => {
      const value = toNullableNumber(point?.currentValue);
      return value !== null && value > 0;
    });

  return {
    historyPoints,
    hasCompleteProvenance,
    actualValuationPoints,
    flowDays: flowIndexes.length,
    flowBoundaryCoverage,
    periodBoundariesObserved,
    sufficient:
      historyPoints >= 2
      && periodBoundariesObserved
      && flowBoundaryCoverage === 1
      && dailyDenominatorsValid,
  };
}

function buildPerformanceReturnMetadata(history, timeline) {
  const historyPoints = Array.isArray(history) ? history.length : 0;
  if (historyPoints < 2) {
    return {
      twr: null,
      method: 'unavailable',
      quality: 'unavailable',
      metricSemantics: {
        outputField: 'twr',
        isTrueTwr: false,
        description: 'No defensible portfolio return is available for this period.',
      },
      confidence: {
        level: 'unavailable',
        score: null,
        reasons: ['insufficient_history'],
        historyPoints,
        actualValuationPoints: null,
        cashFlowDays: 0,
        flowBoundaryCoverage: null,
      },
    };
  }

  const coverage = assessDailyLinkedCoverage(history, timeline);
  if (coverage.sufficient) {
    const twr = calculateTwr(timeline);
    if (twr !== null && Number.isFinite(twr)) {
      const allPointsObserved = coverage.actualValuationPoints === historyPoints;
      return {
        twr,
        method: 'daily_linked_return',
        quality: allPointsObserved ? 'observed' : 'estimated',
        metricSemantics: {
          outputField: 'twr',
          isTrueTwr: true,
          description: 'Geometrically linked daily subperiod returns with observed valuation boundaries around external cash flows.',
        },
        confidence: {
          level: allPointsObserved ? 'high' : 'medium',
          score: allPointsObserved ? 1 : null,
          reasons: allPointsObserved ? [] : ['non_flow_history_points_forward_filled'],
          historyPoints,
          actualValuationPoints: coverage.actualValuationPoints,
          cashFlowDays: coverage.flowDays,
          flowBoundaryCoverage: coverage.flowBoundaryCoverage,
        },
      };
    }
  }

  const modifiedDietz = calculateModifiedDietz(timeline);
  const reasons = [];
  if (!coverage.hasCompleteProvenance) reasons.push('valuation_provenance_missing');
  if (coverage.hasCompleteProvenance && !coverage.periodBoundariesObserved) {
    reasons.push('period_boundaries_not_observed');
  }
  if (coverage.flowBoundaryCoverage !== null && coverage.flowBoundaryCoverage < 1) {
    reasons.push('flow_boundaries_not_observed');
  }

  if (modifiedDietz !== null) {
    return {
      twr: modifiedDietz,
      method: 'modified_dietz',
      quality: 'estimated',
      metricSemantics: {
        outputField: 'twr',
        isTrueTwr: false,
        description: 'Whole-period Modified Dietz estimate using time-weighted external cash flows; returned in twr only for backward compatibility.',
      },
      confidence: {
        level: 'low',
        score: null,
        reasons: reasons.length > 0 ? reasons : ['daily_linking_not_defensible'],
        historyPoints,
        actualValuationPoints: coverage.actualValuationPoints,
        cashFlowDays: coverage.flowDays,
        flowBoundaryCoverage: coverage.flowBoundaryCoverage,
      },
    };
  }

  return {
    twr: null,
    method: 'unavailable',
    quality: 'unavailable',
    metricSemantics: {
      outputField: 'twr',
      isTrueTwr: false,
      description: 'No defensible portfolio return is available because the Modified Dietz capital base is invalid.',
    },
    confidence: {
      level: 'unavailable',
      score: null,
      reasons: [...reasons, 'invalid_modified_dietz_denominator'],
      historyPoints,
      actualValuationPoints: coverage.actualValuationPoints,
      cashFlowDays: coverage.flowDays,
      flowBoundaryCoverage: coverage.flowBoundaryCoverage,
    },
  };
}

function xnpv(rate, cashFlows) {
  const firstDate = new Date(cashFlows[0].date).getTime();
  return cashFlows.reduce((sum, flow) => {
    const date = new Date(flow.date).getTime();
    const years = (date - firstDate) / (365 * 24 * 60 * 60 * 1000);
    return sum + (flow.amount / ((1 + rate) ** years));
  }, 0);
}

function calculateMwr(cashFlows) {
  if (!Array.isArray(cashFlows) || cashFlows.length < 2) return null;
  const firstTime = new Date(cashFlows[0].date).getTime();
  const lastTime = new Date(cashFlows[cashFlows.length - 1].date).getTime();
  if (!Number.isFinite(firstTime) || !Number.isFinite(lastTime) || lastTime <= firstTime) {
    return null;
  }
  const hasPositive = cashFlows.some((flow) => flow.amount > 0);
  const hasNegative = cashFlows.some((flow) => flow.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  let low = -0.9999;
  let high = 10;
  let npvLow = xnpv(low, cashFlows);
  let npvHigh = xnpv(high, cashFlows);

  if (Number.isNaN(npvLow) || Number.isNaN(npvHigh) || npvLow * npvHigh > 0) {
    return null;
  }

  for (let iteration = 0; iteration < 120; iteration += 1) {
    const mid = (low + high) / 2;
    const npvMid = xnpv(mid, cashFlows);
    if (Math.abs(npvMid) < 1e-7) return mid;
    if (npvLow * npvMid < 0) {
      high = mid;
      npvHigh = npvMid;
    } else {
      low = mid;
      npvLow = npvMid;
    }
  }

  return (low + high) / 2;
}

async function loadPikadonReturnMap(accountIds = [], options = {}) {
  const ids = Array.isArray(accountIds)
    ? accountIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    : [];

  const params = [];
  const filters = [
    "ih.holding_type = 'pikadon'",
    'ih.return_transaction_id IS NOT NULL',
    'ih.return_transaction_vendor IS NOT NULL',
  ];

  if (ids.length > 0) {
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
    params.push(...ids);
    filters.push(`ih.account_id IN (${placeholders})`);
  }
  if (options.startDate) {
    params.push(toDateStr(options.startDate));
    filters.push(`substr(rt.date, 1, 10) >= $${params.length}`);
  }
  if (options.endDate) {
    params.push(toDateStr(options.endDate));
    filters.push(`substr(rt.date, 1, 10) <= $${params.length}`);
  }

  const result = await database.query(
    `
      SELECT
        ih.return_transaction_id,
        ih.return_transaction_vendor,
        ih.cost_basis,
        (ih.current_value - ih.cost_basis) AS interest_amount,
        ia.currency,
        rt.date AS return_date
      FROM investment_holdings ih
      JOIN investment_accounts ia ON ia.id = ih.account_id
      LEFT JOIN transactions rt
        ON rt.identifier = ih.return_transaction_id
       AND rt.vendor = ih.return_transaction_vendor
      WHERE ${filters.join(' AND ')}
    `,
    params,
  );

  let rows = result.rows || [];
  let missing = [];
  if (options.normalizeCurrencies) {
    const conversion = await normalizeMonetaryRows(rows, {
      baseCurrency: options.baseCurrency,
      currencyFor: (row) => row.currency,
      dateFor: (row) => row.return_date,
      fields: ['cost_basis', 'interest_amount'],
      kind: 'pikadon_return',
    });
    rows = conversion.rows;
    missing = conversion.missing;
  }

  const map = new Map();
  rows.forEach((row) => {
    const key = `${row.return_transaction_id}|${row.return_transaction_vendor}`;
    const existing = map.get(key) || { principal: 0, interest: 0 };
    map.set(key, {
      principal: existing.principal + Math.max(toNumber(row.cost_basis), 0),
      interest: existing.interest + Math.max(toNumber(row.interest_amount), 0),
    });
  });
  return { map, missing };
}

async function loadPositionEvents(accountIds, startDate, endDate) {
  const ids = (accountIds || []).map(Number).filter(Number.isFinite);
  if (ids.length === 0) return [];
  const values = [...ids, startDate, endDate];
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
  const result = await database.query(
    `SELECT
       ipe.*,
       ip.account_id,
       ip.currency
     FROM investment_position_events ipe
     JOIN investment_positions ip ON ip.id = ipe.position_id
     WHERE ip.account_id IN (${placeholders})
       AND ipe.effective_date >= $${ids.length + 1}
       AND ipe.effective_date <= $${ids.length + 2}
     ORDER BY ipe.effective_date ASC, ipe.id ASC`,
    values,
  );
  return result.rows || [];
}

function deduplicateLinkedPositionEvents(events) {
  const canonicalByTransaction = new Map();
  (events || []).forEach((event) => {
    if (!event.linked_transaction_identifier || !event.linked_transaction_vendor) return;
    const key = `${event.linked_transaction_identifier}|${event.linked_transaction_vendor}`;
    const current = canonicalByTransaction.get(key);
    if (!current || Number(event.id) < Number(current.id)) {
      canonicalByTransaction.set(key, event);
    }
  });

  return (events || []).filter((event) => {
    if (!event.linked_transaction_identifier || !event.linked_transaction_vendor) return true;
    const key = `${event.linked_transaction_identifier}|${event.linked_transaction_vendor}`;
    return canonicalByTransaction.get(key) === event;
  });
}

function mergePositionEvents(dailyFlows, events) {
  let realizedGainGross = 0;
  let realizedGainNet = 0;
  let realizedEventCount = 0;
  let dividends = 0;
  let interest = 0;
  const linkedKeys = new Set();

  (events || []).forEach((event) => {
    const date = toDateStr(event.effective_date);
    const eventType = lower(event.event_type);
    const income = Math.max(toNumber(event.income_amount), 0);
    const fee = Math.max(toNumber(event.fee_amount), 0);
    const tax = Math.max(toNumber(event.tax_amount), 0);
    const principal = Math.max(toNumber(event.principal_amount), 0);
    if (event.linked_transaction_identifier && event.linked_transaction_vendor) {
      linkedKeys.add(`${event.linked_transaction_identifier}|${event.linked_transaction_vendor}`);
    }

    addFlow(dailyFlows, date, (flow) => {
      if (eventType === 'deposit') flow.contributions += principal || Math.max(toNumber(event.amount), 0);
      if (eventType === 'capital_return') flow.capitalReturns += principal;
      if (eventType === 'dividend' || eventType === 'interest') {
        if (!event.reinvested) flow.income += income;
        if (eventType === 'dividend') {
          flow.dividends = (flow.dividends || 0) + income;
          dividends += income;
        } else {
          flow.interest = (flow.interest || 0) + income;
          interest += income;
        }
      }
      if (eventType === 'fee') flow.fees += fee || Math.max(toNumber(event.amount), 0);
      if (eventType === 'tax') flow.taxes += tax || Math.max(toNumber(event.amount), 0);
      if (eventType === 'sell') {
        flow.fees += fee;
        flow.taxes += tax;
      }
    });

    if (eventType === 'sell' && event.realized_gain_loss !== null && event.realized_gain_loss !== undefined) {
      const realized = toNumber(event.realized_gain_loss);
      const gross = realized + fee + tax;
      realizedGainGross += gross;
      realizedGainNet += realized;
      realizedEventCount += 1;
    }
  });

  return {
    linkedKeys,
    dividends,
    interest,
    realizedGainGross: realizedEventCount > 0 ? realizedGainGross : null,
    realizedGainNet: realizedEventCount > 0 ? realizedGainNet : null,
    realizedEventCount,
  };
}

function classifyTransactions(rows, pikadonReturns) {
  const dailyFlows = new Map();

  rows.forEach((row) => {
    const date = toDateStr(row.date);
    const amount = toNumber(row.price);
    const name = `${row.name || ''} ${row.category_name_en || ''} ${row.category_name || ''}`;
    const key = `${row.identifier}|${row.vendor}`;

    if (amount < 0 && matchesKeyword(name, INVESTMENT_TAX_KEYWORDS)) {
      addFlow(dailyFlows, date, (entry) => {
        entry.taxes += Math.abs(amount);
      });
      return;
    }

    if (amount < 0 && row.category_type === 'investment' && matchesKeyword(name, FEE_KEYWORDS)) {
      addFlow(dailyFlows, date, (entry) => {
        entry.fees += Math.abs(amount);
      });
      return;
    }

    const pikadonReturn = amount > 0 ? pikadonReturns.get(key) : null;
    if (pikadonReturn) {
      addFlow(dailyFlows, date, (entry) => {
        entry.capitalReturns += pikadonReturn.principal;
        entry.income += pikadonReturn.interest;
        entry.interest += pikadonReturn.interest;
      });
      return;
    }

    if (row.category_type === 'investment') {
      addFlow(dailyFlows, date, (entry) => {
        if (amount < 0) {
          entry.contributions += Math.abs(amount);
        } else {
          entry.withdrawals += Math.abs(amount);
        }
      });
      return;
    }

    if (row.category_type === 'income' && amount > 0) {
      const isCapitalReturn =
        row.is_counted_as_income === 0
        || row.is_counted_as_income === false
        || matchesKeyword(name, CAPITAL_RETURN_KEYWORDS);

      addFlow(dailyFlows, date, (entry) => {
        if (isCapitalReturn) {
          entry.capitalReturns += amount;
        } else if (matchesKeyword(name, DIVIDEND_KEYWORDS)) {
          entry.income += amount;
          entry.dividends += amount;
        } else if (matchesKeyword(name, INTEREST_KEYWORDS)) {
          entry.income += amount;
          entry.interest += amount;
        } else if (matchesKeyword(name, INVESTMENT_INCOME_KEYWORDS)) {
          entry.income += amount;
        } else {
          entry.income += amount;
        }
      });
    }
  });

  return dailyFlows;
}

async function getInvestmentPerformance(params = {}) {
  const range = params.range || params.timeRange || '3m';
  const normalizeCurrencies = coerceBoolean(params.normalizeCurrencies);
  const assetScope = normalizeAssetScope(params.assetScope || params.scope || params.chartScope);
  const explicitAccountIds = normalizeAccountIds(params.accountIds || params.accountId);
  const scopedAccountIds = explicitAccountIds.length > 0
    ? explicitAccountIds
    : await loadAccountIdsForScope(assetScope);
  if (assetScope !== 'all' && explicitAccountIds.length === 0 && scopedAccountIds.length === 0) {
    return buildEmptyPerformanceResponse(range, null, 'no_matching_accounts');
  }

  const historyParams = {
    timeRange: range,
    includeAccounts: true,
  };
  if (normalizeCurrencies) historyParams.normalizeCurrencies = true;
  if (scopedAccountIds.length > 0) {
    historyParams.accountIds = scopedAccountIds;
  }

  const historyResult = await historyService.getInvestmentHistory({
    ...historyParams,
  });
  const history = Array.isArray(historyResult?.history) ? historyResult.history : [];

  if (history.length === 0) {
    return buildEmptyPerformanceResponse(
      range,
      historyResult?.startDate || null,
      historyResult?.fx?.complete === false ? 'missing_fx_rates' : 'insufficient_history',
    );
  }

  // Returns must start when the first real portfolio value is available. Using
  // the requested range boundary here would annualize MWR across time for which
  // the service has no opening valuation.
  const startDate = history[0]?.date;
  const endDate = history[history.length - 1]?.date || history[0]?.date;
  const accountIds = Array.isArray(historyResult?.accounts)
    ? historyResult.accounts
      .map((account) => Number(account?.accountId))
      .filter((id) => Number.isFinite(id))
    : [];
  const baseCurrency = normalizeCurrencies
    ? (historyResult?.fx?.baseCurrency || await fxService.getBaseCurrency())
    : null;

  const [allTransactions, pikadonReturnResult, loadedPositionEvents] = accountIds.length > 0
    ? await Promise.all([
      fetchLinkedInvestmentTransactions(database, accountIds, {
        startDate: toDateStr(startDate),
        endDate: toDateStr(endDate),
      }),
      loadPikadonReturnMap(accountIds, {
        normalizeCurrencies,
        baseCurrency,
        startDate: toDateStr(startDate),
        endDate: toDateStr(endDate),
      }),
      coerceBoolean(params.includePositionEvents)
        ? loadPositionEvents(accountIds, toDateStr(startDate), toDateStr(endDate))
        : [],
    ])
    : [[], { map: new Map(), missing: [] }, []];

  // A transaction can be linked to more than one investment account, but the
  // link table does not carry an allocation amount. Count it once rather than
  // manufacturing duplicate cash flow.
  const uniqueTransactions = Array.from(new Map(
    allTransactions.map((transaction) => [
      `${transaction.identifier}|${transaction.vendor}`,
      transaction,
    ]),
  ).values());
  const duplicateLinkedTransactionCount = allTransactions.length - uniqueTransactions.length;
  const uniquePositionEvents = deduplicateLinkedPositionEvents(loadedPositionEvents);
  const duplicatePositionEventCount = loadedPositionEvents.length - uniquePositionEvents.length;
  const positionLinkedTransactionKeys = new Set(
    uniquePositionEvents
      .filter((event) =>
        event.linked_transaction_identifier && event.linked_transaction_vendor)
      .map((event) =>
        `${event.linked_transaction_identifier}|${event.linked_transaction_vendor}`),
  );
  const deduplicatedTransactions = uniqueTransactions.filter((transaction) =>
    !positionLinkedTransactionKeys.has(`${transaction.identifier}|${transaction.vendor}`));

  let normalizedTransactions = deduplicatedTransactions;
  let positionEvents = uniquePositionEvents;
  const missingFx = [...(pikadonReturnResult.missing || [])];
  if (normalizeCurrencies) {
    // Remove event-linked duplicates before FX lookup. A discarded transaction
    // must not make the performance result unavailable merely because its own
    // currency rate is missing; the explicit event is the authoritative flow.
    const transactionConversion = await normalizeMonetaryRows(deduplicatedTransactions, {
      baseCurrency,
      currencyFor: (row) => row.charged_currency || row.original_currency || baseCurrency,
      dateFor: (row) => row.date,
      fields: ['price'],
      kind: 'linked_transaction',
    });
    const eventConversion = await normalizeMonetaryRows(uniquePositionEvents, {
      baseCurrency,
      currencyFor: (row) => row.currency,
      dateFor: (row) => row.effective_date,
      fields: [
        'amount',
        'principal_amount',
        'income_amount',
        'fee_amount',
        'tax_amount',
        'proceeds_amount',
        'disposed_cost_basis',
        'realized_gain_loss',
        'current_value',
        'cost_basis',
      ],
      kind: 'position_event',
    });
    normalizedTransactions = transactionConversion.rows;
    positionEvents = eventConversion.rows;
    missingFx.push(...transactionConversion.missing, ...eventConversion.missing);
  }

  if (missingFx.length > 0) {
    return {
      ...buildEmptyPerformanceResponse(range, historyResult?.startDate || null, 'missing_fx_rates'),
      fx: {
        baseCurrency,
        complete: false,
        missingCount: missingFx.length,
        missing: missingFx,
      },
    };
  }

  const transactions = normalizedTransactions;
  const dailyFlows = classifyTransactions(transactions, pikadonReturnResult.map);
  const mergedPositionAttribution = mergePositionEvents(dailyFlows, positionEvents);

  const timeline = history.map((point, index) => {
    const date = toDateStr(point.date);
    const flows = dailyFlows.get(date) || {
      contributions: 0,
      withdrawals: 0,
      capitalReturns: 0,
      income: 0,
      fees: 0,
      taxes: 0,
      dividends: 0,
      interest: 0,
    };
    const previousValue = index > 0 ? toNumber(history[index - 1]?.currentValue) : toNumber(point.currentValue);
    const currentValue = toNumber(point.currentValue);
    const valueChange = index > 0 ? currentValue - previousValue : 0;
    const marketMove =
      valueChange
      - flows.contributions
      + flows.withdrawals
      + flows.capitalReturns
      + flows.income
      + flows.fees
      + flows.taxes;

    return {
      date,
      currentValue,
      costBasis: toNumber(point.costBasis),
      contributions: flows.contributions,
      withdrawals: flows.withdrawals,
      capitalReturns: flows.capitalReturns,
      income: flows.income,
      fees: flows.fees,
      taxes: flows.taxes,
      dividends: flows.dividends || 0,
      interest: flows.interest || 0,
      valueChange,
      marketMove,
      netFlow:
        flows.contributions
        - flows.withdrawals
        - flows.capitalReturns
        - flows.income
        - flows.fees
        - flows.taxes,
    };
  });

  const totals = timeline.reduce(
    (acc, point) => {
      acc.contributions += point.contributions;
      acc.withdrawals += point.withdrawals;
      acc.capitalReturns += point.capitalReturns;
      acc.income += point.income;
      acc.fees += point.fees;
      acc.taxes += point.taxes;
      acc.dividends += point.dividends || 0;
      acc.interest += point.interest || 0;
      return acc;
    },
    {
      contributions: 0,
      withdrawals: 0,
      capitalReturns: 0,
      income: 0,
      fees: 0,
      taxes: 0,
      dividends: 0,
      interest: 0,
    },
  );

  const startValue = toNumber(history[0]?.currentValue);
  const endValue = toNumber(history[history.length - 1]?.currentValue);
  const valueChange = endValue - startValue;
  const marketMove =
    valueChange
    - totals.contributions
    + totals.withdrawals
    + totals.capitalReturns
    + totals.income
    + totals.fees
    + totals.taxes;

  const cashFlows = [
    { date: toDateStr(startDate), amount: -startValue },
    ...timeline.flatMap((point) => {
      const flows = [];
      if (point.contributions > 0) {
        flows.push({ date: point.date, amount: -point.contributions });
      }
      if (point.withdrawals > 0) {
        flows.push({ date: point.date, amount: point.withdrawals });
      }
      if (point.capitalReturns > 0) {
        flows.push({ date: point.date, amount: point.capitalReturns });
      }
      if (point.income > 0) {
        flows.push({ date: point.date, amount: point.income });
      }
      if (point.fees > 0) {
        flows.push({ date: point.date, amount: -point.fees });
      }
      if (point.taxes > 0) {
        flows.push({ date: point.date, amount: -point.taxes });
      }
      return flows;
    }),
    { date: toDateStr(endDate), amount: endValue },
  ];

  const performanceMetadata = buildPerformanceReturnMetadata(history, timeline);
  const endCostBasis = toNullableNumber(history[history.length - 1]?.costBasis);

  return {
    range,
    requestedStartDate: toDateStr(historyResult?.startDate || null),
    startDate: toDateStr(startDate),
    endDate: toDateStr(endDate),
    startValue,
    endValue,
    valueChange,
    netFlows: {
      contributions: totals.contributions,
      withdrawals: totals.withdrawals,
      netContributions: totals.contributions - totals.withdrawals,
    },
    capitalReturns: totals.capitalReturns,
    income: totals.income,
    fees: totals.fees,
    taxes: totals.taxes,
    dividends: totals.dividends,
    interest: totals.interest,
    marketMove,
    mwr: calculateMwr(cashFlows),
    ...performanceMetadata,
    baseCurrency,
    fx: historyResult?.fx || null,
    flowCoverage: {
      linkedTransactionCount: uniqueTransactions.length,
      includedLinkedTransactionCount: transactions.length,
      duplicateLinkedTransactionCount,
      positionEventCount: positionEvents.length,
      duplicatePositionEventCount,
      missingFxCount: 0,
    },
    attribution: buildAttribution({
      endValue,
      endCostBasis,
      realizedGainGross: mergedPositionAttribution.realizedGainGross,
      realizedGainNet: mergedPositionAttribution.realizedGainNet,
      hasPositionEvents: mergedPositionAttribution.realizedEventCount > 0,
    }),
    timeline,
  };
}

module.exports = {
  getInvestmentPerformance,
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
    fxService.__setDatabase(database);
    if (historyService?.__setDatabase) {
      historyService.__setDatabase(database);
    }
  },
  __setHistoryService(mockHistoryService) {
    historyService = mockHistoryService || historyModule;
  },
  __resetDatabase() {
    database = actualDatabase;
    historyService = historyModule;
    fxService = fxModule;
    fxService.__resetDatabase();
    if (historyService?.__resetDatabase) {
      historyService.__resetDatabase();
    }
  },
};

module.exports.default = module.exports;
