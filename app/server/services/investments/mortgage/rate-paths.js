'use strict';

/**
 * Pure builders that turn cached market series + a user scenario into the
 * path functions consumed by engine.js.
 *
 * series = {
 *   policyRate: [{ date: 'YYYY-MM-DD', value }]     // BoI rate change points
 *   cpi: [{ period: 'YYYY-MM', value }]              // chained CPI, any base
 *   inflationExpectations: { y1, y5, y10 }           // annual %
 *   anchors: { [key]: [{ period|date, value }] }     // variable-track anchors
 *   marketRates: { [trackType]: [{ period|date, value }] }
 * }
 * scenario = { primeShiftPct, primeOverridePct, cpiAnnualOverridePct,
 *              cpiShiftPct, anchorShiftPct }
 */

const { monthIndex, parseIsoDate } = require('./dates.js');

const PRIME_SPREAD = 1.5;
const DEFAULT_CPI_PUBLICATION_DAY = 15;
const DEFAULT_INFLATION_PCT = 2; // midpoint of the BoI 1–3% target band

function finite(value) {
  const parsed = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : null;
}

function pointDate(point) {
  if (point.date) return String(point.date).slice(0, 10);
  if (point.period) return `${String(point.period).slice(0, 7)}-01`;
  return null;
}

/** Step function: value of the last point at or before `date`. */
function createStepLookup(points) {
  const sorted = (Array.isArray(points) ? points : [])
    .map((point) => ({ date: pointDate(point), value: finite(point.value) }))
    .filter((point) => point.date && point.value !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    size: sorted.length,
    first: sorted[0] || null,
    last: sorted[sorted.length - 1] || null,
    at(date) {
      let found = null;
      let low = 0;
      let high = sorted.length - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (sorted[mid].date <= date) {
          found = sorted[mid];
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return found ? found.value : null;
    },
  };
}

function periodFromIndex(index) {
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** CPI month whose index is "known" (published) on `date`. */
function knownCpiPeriod(date, publicationDay = DEFAULT_CPI_PUBLICATION_DAY) {
  const parsed = parseIsoDate(date);
  const index = parsed.y * 12 + (parsed.m - 1);
  // Month M is published on the 15th of M+1 (evening), so it is known from the 16th.
  return periodFromIndex(parsed.d > publicationDay ? index - 1 : index - 2);
}

/** Annual inflation assumption for the k-th projected month (k >= 1). */
function projectedAnnualInflation(monthsAhead, expectations = {}, scenario = {}) {
  const override = finite(scenario.cpiAnnualOverridePct);
  const shift = finite(scenario.cpiShiftPct) || 0;
  if (override !== null) return override + shift;
  const e1 = (finite(expectations.y1) ?? DEFAULT_INFLATION_PCT) / 100;
  const e5 = (finite(expectations.y5) ?? finite(expectations.y1) ?? DEFAULT_INFLATION_PCT) / 100;
  const e10 = (finite(expectations.y10) ?? finite(expectations.y5) ?? finite(expectations.y1) ?? DEFAULT_INFLATION_PCT) / 100;
  let annual;
  if (monthsAhead <= 12) {
    annual = e1;
  } else if (monthsAhead <= 60) {
    annual = Math.pow(Math.pow(1 + e5, 5) / (1 + e1), 1 / 4) - 1;
  } else {
    // 5→10y forward, held flat thereafter.
    annual = Math.pow(Math.pow(1 + e10, 10) / Math.pow(1 + e5, 5), 1 / 5) - 1;
  }
  return annual * 100 + shift;
}

function createCpiPath(cpiPoints, expectations, scenario, asOf, publicationDay) {
  const history = new Map();
  for (const point of Array.isArray(cpiPoints) ? cpiPoints : []) {
    const value = finite(point.value);
    const period = point.period ? String(point.period).slice(0, 7) : String(point.date || '').slice(0, 7);
    if (value !== null && value > 0 && /^\d{4}-\d{2}$/.test(period)) history.set(period, value);
  }
  const periods = Array.from(history.keys()).sort();
  let lastIndex;
  let lastValue;
  let firstIndex;
  let firstValue;
  if (periods.length > 0) {
    lastIndex = monthIndex(`${periods[periods.length - 1]}-01`);
    lastValue = history.get(periods[periods.length - 1]);
    firstIndex = monthIndex(`${periods[0]}-01`);
    firstValue = history.get(periods[0]);
  } else {
    // No data: synthetic index of 100 for the month known today; only ratios matter.
    lastIndex = monthIndex(`${knownCpiPeriod(asOf, publicationDay)}-01`);
    lastValue = 100;
    firstIndex = lastIndex;
    firstValue = 100;
  }

  const projected = [lastValue];
  const indexForMonth = (index) => {
    if (index <= lastIndex) {
      if (index < firstIndex) return firstValue;
      const value = history.get(periodFromIndex(index));
      if (value) return value;
      // Gap in history: fall back to the nearest earlier month.
      for (let probe = index - 1; probe >= firstIndex; probe -= 1) {
        const earlier = history.get(periodFromIndex(probe));
        if (earlier) return earlier;
      }
      return firstValue;
    }
    const ahead = index - lastIndex;
    while (projected.length <= ahead) {
      const k = projected.length;
      const annual = projectedAnnualInflation(k, expectations, scenario) / 100;
      projected.push(projected[k - 1] * Math.pow(1 + annual, 1 / 12));
    }
    return projected[ahead];
  };

  return {
    lastPeriod: periodFromIndex(lastIndex),
    hasHistory: periods.length > 0,
    knownIndexAt(date) {
      const period = knownCpiPeriod(date, publicationDay);
      return indexForMonth(monthIndex(`${period}-01`));
    },
  };
}

function buildPaths({ series = {}, scenario = {}, asOf, publicationDay = DEFAULT_CPI_PUBLICATION_DAY } = {}) {
  if (!parseIsoDate(asOf)) throw new Error('buildPaths requires asOf (YYYY-MM-DD)');
  const policy = createStepLookup(series.policyRate);
  const primeShift = finite(scenario.primeShiftPct) || 0;
  const primeOverride = finite(scenario.primeOverridePct);
  const anchorShift = finite(scenario.anchorShiftPct) || 0;

  const primeAt = (date) => {
    const future = date > asOf;
    if (future && primeOverride !== null) return primeOverride;
    const policyRate = policy.at(date) ?? (policy.size ? policy.first.value : null);
    if (policyRate === null) return primeOverride;
    return policyRate + PRIME_SPREAD + (future ? primeShift : 0);
  };

  const anchorLookups = new Map(
    Object.entries(series.anchors || {}).map(([key, points]) => [key, createStepLookup(points)]),
  );
  const anchorAt = (key, date) => {
    const lookup = anchorLookups.get(key);
    if (!lookup || lookup.size === 0) return null;
    const value = lookup.at(date) ?? lookup.first.value;
    return value + (date > asOf ? anchorShift : 0);
  };

  const marketLookups = new Map(
    Object.entries(series.marketRates || {}).map(([key, points]) => [key, createStepLookup(points)]),
  );
  const marketRateAt = (trackType, date) => {
    if (trackType === 'prime') {
      const prime = primeAt(date);
      return prime === null ? null : prime;
    }
    const lookup = marketLookups.get(trackType);
    if (!lookup || lookup.size === 0) return null;
    // Market averages lag ~2 months; future draws use the latest value.
    return lookup.at(date) ?? lookup.last.value;
  };

  const cpi = createCpiPath(series.cpi, series.inflationExpectations, scenario, asOf, publicationDay);

  return {
    primeAt,
    anchorAt,
    marketRateAt,
    cpiKnownIndexAt: cpi.knownIndexAt,
    meta: {
      asOf,
      currentPolicyRate: policy.at(asOf),
      currentPrime: primeAt(asOf),
      cpiLastPeriod: cpi.lastPeriod,
      cpiHasHistory: cpi.hasHistory,
      projectedInflation1y: projectedAnnualInflation(1, series.inflationExpectations, scenario),
    },
  };
}

module.exports = {
  DEFAULT_CPI_PUBLICATION_DAY,
  DEFAULT_INFLATION_PCT,
  PRIME_SPREAD,
  buildPaths,
  createStepLookup,
  knownCpiPeriod,
  projectedAnnualInflation,
};
