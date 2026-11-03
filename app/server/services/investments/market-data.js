'use strict';

/**
 * Cached public market data for mortgage modelling:
 *   - Bank of Israel policy rate (prime = rate + 1.5) and next decision date
 *   - CBS consumer price index (chained across base changes)
 *   - CBS dwelling price indexes (national, districts, new dwellings)
 *   - BoI average new-mortgage rates by track and inflation expectations
 *
 * Mirrors fx.js: injectable fetchImpl/database, per-series failure isolation,
 * SQLite cache in market_series / market_series_points, staleness flags.
 * Sync never blocks reads; consumers always get whatever is cached.
 */

const actualDatabase = require('../database.js');
const { buildBoiSeriesUrl, parseSdmxCsv } = require('./boi-sdmx.js');
const { MORTGAGE_INDEX_STATEMENTS, MORTGAGE_TABLE_STATEMENTS } = require('./mortgage/schema.js');
const { PRIME_SPREAD, knownCpiPeriod } = require('./mortgage/rate-paths.js');

const CBS_PRICE_ENDPOINT = 'https://api.cbs.gov.il/index/data/price';
const BOI_INTEREST_ENDPOINT = 'https://www.boi.org.il/PublicApi/GetInterest';
const FETCH_TIMEOUT_MS = 20_000;
const HISTORY_START = '2000-01-01';

let database = actualDatabase;
let schemaPromise = null;
let inflightSync = null;

const SERIES = Object.freeze({
  'boi.policy_rate': {
    source: 'boi', frequency: 'D', unit: '%', dataflow: 'BR', code: 'MNT_RIB_BOI_D',
    description: 'Bank of Israel policy rate', stepOnly: true, staleDays: 7,
  },
  'cbs.cpi': {
    source: 'cbs', frequency: 'M', unit: 'index', cbsId: 120010,
    description: 'Consumer price index (general)', staleDays: 7,
  },
  'cbs.hpi.national': {
    source: 'cbs', frequency: 'M', unit: 'index', cbsId: 40010,
    description: 'Dwelling price index — national', staleDays: 14,
  },
  'cbs.hpi.new_dwellings': {
    source: 'cbs', frequency: 'M', unit: 'index', cbsId: 70000,
    description: 'Dwelling price index — new dwellings', staleDays: 14,
  },
  'cbs.hpi.district.jerusalem': { source: 'cbs', frequency: 'M', unit: 'index', cbsId: 60000, description: 'Dwelling prices — Jerusalem district', staleDays: 14 },
  'cbs.hpi.district.north': { source: 'cbs', frequency: 'M', unit: 'index', cbsId: 60100, description: 'Dwelling prices — North district', staleDays: 14 },
  'cbs.hpi.district.haifa': { source: 'cbs', frequency: 'M', unit: 'index', cbsId: 60200, description: 'Dwelling prices — Haifa district', staleDays: 14 },
  'cbs.hpi.district.center': { source: 'cbs', frequency: 'M', unit: 'index', cbsId: 60300, description: 'Dwelling prices — Center district', staleDays: 14 },
  'cbs.hpi.district.tel_aviv': { source: 'cbs', frequency: 'M', unit: 'index', cbsId: 60400, description: 'Dwelling prices — Tel Aviv district', staleDays: 14 },
  'cbs.hpi.district.south': { source: 'cbs', frequency: 'M', unit: 'index', cbsId: 60500, description: 'Dwelling prices — South district', staleDays: 14 },
  'boi.mrtg.fixed_unlinked': {
    source: 'boi', frequency: 'M', unit: '%', dataflow: 'BIR_MRTG_99', code: 'BNK_99034_LR_BIR_MRTG_467',
    description: 'Average rate, new mortgages — fixed unlinked', staleDays: 14,
  },
  'boi.mrtg.fixed_cpi': {
    source: 'boi', frequency: 'M', unit: '%', dataflow: 'BIR_MRTG_99', code: 'BNK_99034_LR_BIR_MRTG_1492',
    description: 'Average rate, new mortgages — fixed CPI-linked', staleDays: 14,
  },
  'boi.mrtg.var_cpi_anchor': {
    source: 'boi', frequency: 'M', unit: '%', dataflow: 'BIR_MRTG_99', code: 'BNK_99034_LR_BIR_MRTG_1489',
    description: 'Average anchor, new mortgages — variable CPI-linked', staleDays: 14,
  },
  'boi.mrtg.var_cpi_margin': {
    source: 'boi', frequency: 'M', unit: '%', dataflow: 'BIR_MRTG_99', code: 'BNK_99034_LR_BIR_MRTG_1488',
    description: 'Average margin, new mortgages — variable CPI-linked', staleDays: 14,
  },
  'boi.infl_exp.1y': {
    source: 'boi', frequency: 'M', unit: '%', dataflow: 'ZCM', code: 'EXP_EXP_01Y_BI_MA',
    description: 'Inflation expectations — 1 year (BoI composite)', staleDays: 14,
  },
  'boi.infl_exp.5y': {
    source: 'boi', frequency: 'M', unit: '%', dataflow: 'ZCM', code: 'EXP_EXB_ZD_5Y_MA',
    description: 'Inflation expectations — 5 years (capital market)', staleDays: 14,
  },
  'boi.infl_exp.10y': {
    source: 'boi', frequency: 'M', unit: '%', dataflow: 'ZCM', code: 'EXP_EXB_ZD_10Y_MA',
    description: 'Inflation expectations — 10 years (capital market)', staleDays: 14,
  },
  'boi.zc.nominal.5y': {
    source: 'boi', frequency: 'M', unit: '%', dataflow: 'ZCM', code: 'ZC_TSB_ZND_05Y_MA',
    description: 'Nominal 5-year zero-coupon government yield', staleDays: 14,
  },
});

const DEFAULT_SYNC_KEYS = Object.freeze(Object.keys(SERIES).filter((key) => !SERIES[key].optional));

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      for (const statement of MORTGAGE_TABLE_STATEMENTS) await database.query(statement);
      for (const statement of MORTGAGE_INDEX_STATEMENTS) await database.query(statement);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

// ---------------------------------------------------------------------------
// Parsers (pure)
// ---------------------------------------------------------------------------

/** Keep only the days on which the value changed (BoI daily series carry forward). */
function compressStepSeries(points) {
  const sorted = [...points].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  const compressed = [];
  for (const point of sorted) {
    const previous = compressed[compressed.length - 1];
    if (!previous || Math.abs(previous.value - point.value) > 1e-9) compressed.push(point);
  }
  return { points: compressed, lastPeriod: sorted.length ? sorted[sorted.length - 1].period : null };
}

/**
 * Parse a CBS index JSON payload into points chained to the newest base.
 * CBS returns each month in the base that was current then, with prevBase
 * chains (coef=true) expressing that value in every older base.
 */
function parseCbsIndexJson(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_error) {
    throw serviceError(502, 'CBS returned a non-JSON response');
  }
  const entries = (payload?.month || []).flatMap((series) => series?.date || []);
  const points = entries
    .map((entry) => {
      const month = Number(entry?.month);
      const year = Number(entry?.year);
      const value = Number(entry?.currBase?.value);
      if (!Number.isInteger(year) || !(month >= 1 && month <= 12) || !(value > 0)) return null;
      return {
        period: `${year}-${String(month).padStart(2, '0')}`,
        rawValue: value,
        baseLabel: entry.currBase.baseDesc || null,
        prevBase: Array.isArray(entry.prevBase) ? entry.prevBase : [],
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.period < b.period ? -1 : 1));
  if (points.length === 0) return { points: [], baseLabel: null };

  // Factor that converts a value in base B into the newest base: newest/B.
  const newest = points[points.length - 1];
  const factors = new Map([[newest.baseLabel, 1]]);
  // Walk from newest to oldest, learning each base's factor from entries whose
  // prevBase chain contains a base we already know.
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (factors.has(point.baseLabel)) {
      const factor = factors.get(point.baseLabel);
      for (const older of point.prevBase) {
        const olderValue = Number(older?.value);
        if (older?.baseDesc && olderValue > 0 && !factors.has(older.baseDesc)) {
          factors.set(older.baseDesc, factor * (point.rawValue / olderValue));
        }
      }
    }
  }
  const chained = [];
  for (const point of points) {
    const factor = factors.get(point.baseLabel);
    if (factor === undefined) continue; // unreachable base: skip rather than mis-chain
    chained.push({ period: point.period, value: point.rawValue * factor, rawValue: point.rawValue, baseLabel: point.baseLabel });
  }
  return { points: chained, baseLabel: newest.baseLabel };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchText(fetchImpl, url, accept) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: accept },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw serviceError(503, `Could not reach ${new URL(url).hostname}: ${error?.message || error}`);
  }
  if (!response.ok) {
    const error = serviceError(502, `${new URL(url).hostname} returned HTTP ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  const contentType = String(response.headers?.get?.('content-type') || '');
  const text = await response.text();
  if (/text\/html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(text)) {
    throw serviceError(502, `${new URL(url).hostname} returned an HTML page instead of data`);
  }
  return text;
}

function cbsUrl(definition, range) {
  const url = new URL(CBS_PRICE_ENDPOINT);
  url.searchParams.set('id', String(definition.cbsId));
  url.searchParams.set('format', 'json');
  url.searchParams.set('download', 'false');
  url.searchParams.set('coef', 'true');
  url.searchParams.set('PageSize', '1000');
  for (const [key, value] of Object.entries(range)) url.searchParams.set(key, value);
  return url;
}

async function fetchCbsSeries(definition, fetchImpl) {
  let text;
  let partial = false;
  try {
    text = await fetchText(fetchImpl, cbsUrl(definition, { startPeriod: `01-${HISTORY_START.slice(0, 4)}` }), 'application/json');
  } catch (error) {
    // Some CBS series (e.g. new dwellings, 70000) answer HTTP 500 when the
    // requested range predates their history; retry with the last 5 years.
    // Any other failure (timeouts, 503, HTML pages) must not shorten history.
    if (error.httpStatus !== 500) throw error;
    text = await fetchText(fetchImpl, cbsUrl(definition, { last: '60' }), 'application/json');
    partial = true;
  }
  const parsed = parseCbsIndexJson(text);
  return {
    points: parsed.points,
    lastPeriod: parsed.points.length ? parsed.points[parsed.points.length - 1].period : null,
    meta: { baseLabel: parsed.baseLabel },
    partial,
  };
}

async function fetchBoiGroup(dataflow, entries, fetchImpl) {
  const url = buildBoiSeriesUrl(dataflow, entries.map(([, definition]) => definition.code), {
    startPeriod: HISTORY_START,
  });
  const observations = parseSdmxCsv(await fetchText(fetchImpl, url, 'text/csv'));
  const results = new Map();
  for (const [key, definition] of entries) {
    const points = observations
      .filter((observation) => observation.seriesCode === definition.code)
      .map((observation) => ({ period: observation.period, value: observation.value }));
    results.set(key, definition.stepOnly
      ? compressStepSeries(points)
      : { points, lastPeriod: points.reduce((max, point) => (point.period > max ? point.period : max), '') || null });
  }
  return results;
}

async function fetchBoiNextDecision(fetchImpl) {
  const text = await fetchText(fetchImpl, BOI_INTEREST_ENDPOINT, 'application/json');
  const payload = JSON.parse(text);
  return {
    currentInterest: Number.isFinite(Number(payload?.currentInterest)) ? Number(payload.currentInterest) : null,
    nextDecisionDate: payload?.nextInterestDate ? String(payload.nextInterestDate).slice(0, 10) : null,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function storeSeries(key, definition, result, syncedAt) {
  const client = typeof database.getClient === 'function'
    ? await database.getClient()
    : { query: (...args) => database.query(...args), release: () => {} };
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO market_series (series_key, source, frequency, unit, description, last_synced_at, last_observation_period, last_error, meta_json, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $6)
       ON CONFLICT (series_key) DO UPDATE SET
         source = excluded.source, frequency = excluded.frequency, unit = excluded.unit,
         description = excluded.description, last_synced_at = excluded.last_synced_at,
         last_observation_period = excluded.last_observation_period, last_error = NULL,
         meta_json = excluded.meta_json, updated_at = excluded.updated_at`,
      [key, definition.source, definition.frequency, definition.unit, definition.description, syncedAt, result.lastPeriod, result.meta ? JSON.stringify(result.meta) : null],
    );
    // Full responses replace the series (CBS rebases change every chained
    // value); a partial (short-range) response is merged so older cached
    // history is kept.
    if (!result.partial) {
      await client.query('DELETE FROM market_series_points WHERE series_key = $1', [key]);
    }
    for (const point of result.points) {
      await client.query(
        `INSERT INTO market_series_points (series_key, period, value, raw_value, base_label) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (series_key, period) DO UPDATE SET
           value = excluded.value, raw_value = excluded.raw_value, base_label = excluded.base_label`,
        [key, point.period, point.value, point.rawValue ?? null, point.baseLabel ?? null],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackError) {
      // Preserve the original error.
    }
    throw error;
  } finally {
    client.release?.();
  }
}

async function recordFailure(key, definition, message, syncedAt) {
  await database.query(
    `INSERT INTO market_series (series_key, source, frequency, unit, description, last_error, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (series_key) DO UPDATE SET last_error = excluded.last_error, updated_at = excluded.updated_at`,
    [key, definition.source, definition.frequency, definition.unit, definition.description, String(message).slice(0, 500), syncedAt],
  );
}

async function listSeriesRows() {
  await ensureSchema();
  const result = await database.query(
    'SELECT series_key, last_synced_at, last_observation_period, last_error, meta_json FROM market_series',
  );
  return new Map((result.rows || []).map((row) => [row.series_key, row]));
}

function parseMeta(row) {
  if (!row?.meta_json) return {};
  try {
    return JSON.parse(row.meta_json) || {};
  } catch (_error) {
    return {};
  }
}

function daysSince(isoTimestamp, now) {
  if (!isoTimestamp) return Infinity;
  const time = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(time)) return Infinity;
  return (now.getTime() - time) / 86_400_000;
}

function isStale(key, row, now = new Date()) {
  const definition = SERIES[key];
  if (!definition) return false;
  if (!row || !row.last_synced_at) return true;
  const age = daysSince(row.last_synced_at, now);
  if (key === 'boi.policy_rate') {
    const nextDecision = parseMeta(row).nextDecisionDate;
    if (nextDecision && now.toISOString().slice(0, 10) > nextDecision && age > 0.25) return true;
  }
  return age > definition.staleDays;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch and cache series. Failures are isolated per series (or per BoI
 * dataflow group) and reported in `failed`; cached data is never deleted on
 * failure.
 */
async function syncMarketSeries(payload = {}, dependencies = {}) {
  await ensureSchema();
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw serviceError(503, 'Market data sync is unavailable in this environment');
  const now = dependencies.now ? new Date(dependencies.now) : new Date();
  const syncedAt = now.toISOString();

  const requested = Array.isArray(payload.keys) && payload.keys.length > 0 ? payload.keys : DEFAULT_SYNC_KEYS;
  const unknown = requested.filter((key) => !SERIES[key]);
  if (unknown.length) throw serviceError(400, `Unknown market series: ${unknown.join(', ')}`);

  const rows = await listSeriesRows();
  const keys = payload.force ? requested : requested.filter((key) => isStale(key, rows.get(key), now));
  const imported = {};
  const failed = [];

  const handle = async (key, task) => {
    const definition = SERIES[key];
    try {
      const result = await task();
      if (!result || result.points.length === 0) throw serviceError(502, 'No observations returned');
      await storeSeries(key, definition, result, syncedAt);
      imported[key] = result.points.length;
    } catch (error) {
      failed.push({ key, status: error.status || 500, message: error.message });
      try {
        await recordFailure(key, definition, error.message, syncedAt);
      } catch (_recordError) {
        // Ignore bookkeeping failures.
      }
    }
  };

  // BoI series grouped by dataflow (one request each), falling back to
  // per-series requests if the group request fails.
  const boiGroups = new Map();
  for (const key of keys) {
    const definition = SERIES[key];
    if (definition.source !== 'boi') continue;
    if (!boiGroups.has(definition.dataflow)) boiGroups.set(definition.dataflow, []);
    boiGroups.get(definition.dataflow).push([key, definition]);
  }

  const tasks = [];
  for (const [dataflow, entries] of boiGroups) {
    tasks.push((async () => {
      let grouped = null;
      try {
        grouped = await fetchBoiGroup(dataflow, entries, fetchImpl);
      } catch (_groupError) {
        grouped = null;
      }
      for (const [key, definition] of entries) {
        await handle(key, async () => {
          const result = grouped?.get(key)?.points.length
            ? grouped.get(key)
            : (await fetchBoiGroup(dataflow, [[key, definition]], fetchImpl)).get(key);
          if (key === 'boi.policy_rate') {
            try {
              result.meta = await fetchBoiNextDecision(fetchImpl);
            } catch (_error) {
              result.meta = { nextDecisionDate: null };
            }
          }
          return result;
        });
      }
    })());
  }
  for (const key of keys) {
    const definition = SERIES[key];
    if (definition.source === 'cbs') tasks.push(handle(key, () => fetchCbsSeries(definition, fetchImpl)));
  }
  await Promise.all(tasks);

  if (Object.keys(imported).length > 0) {
    // Mortgage payments in the forecast follow prime and CPI.
    try {
      (dependencies.invalidateCaches || require('../financial-truth.js').invalidateDependentCaches)();
    } catch (_error) {
      // Best-effort: cached forecasts expire on their own.
    }
  }

  return {
    syncedAt,
    requested,
    attempted: keys,
    skipped: requested.filter((key) => !keys.includes(key)),
    imported,
    failed,
  };
}

/** Sync stale series in the background. Never throws; returns the in-flight promise. */
function ensureFresh(keys = DEFAULT_SYNC_KEYS, dependencies = {}) {
  if (inflightSync) return inflightSync;
  inflightSync = syncMarketSeries({ keys }, dependencies)
    .catch((error) => ({ failed: [{ key: '*', message: error.message }] }))
    .finally(() => {
      inflightSync = null;
    });
  return inflightSync;
}

async function getSeriesPoints(key, { from, to } = {}) {
  await ensureSchema();
  const conditions = ['series_key = $1'];
  const params = [key];
  if (from) {
    params.push(from);
    conditions.push(`period >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`period <= $${params.length}`);
  }
  const result = await database.query(
    `SELECT period, value FROM market_series_points WHERE ${conditions.join(' AND ')} ORDER BY period ASC`,
    params,
  );
  return (result.rows || []).map((row) => ({ period: row.period, value: Number(row.value) }));
}

async function getSeries(key, range = {}) {
  if (!SERIES[key]) throw serviceError(404, `Unknown market series: ${key}`);
  const rows = await listSeriesRows();
  const row = rows.get(key);
  return {
    key,
    ...SERIES[key],
    lastSyncedAt: row?.last_synced_at || null,
    lastPeriod: row?.last_observation_period || null,
    lastError: row?.last_error || null,
    stale: isStale(key, row),
    meta: parseMeta(row),
    points: await getSeriesPoints(key, range),
  };
}

function latest(points) {
  return points.length ? points[points.length - 1] : null;
}

const RATE_PATH_KEYS = Object.freeze([
  'boi.policy_rate', 'cbs.cpi', 'boi.infl_exp.1y', 'boi.infl_exp.5y', 'boi.infl_exp.10y',
  'boi.mrtg.var_cpi_anchor', 'boi.mrtg.var_cpi_margin', 'boi.mrtg.fixed_unlinked', 'boi.mrtg.fixed_cpi', 'boi.zc.nominal.5y',
]);

/** Pure: cached points per series key → the `series` input of rate-paths.buildPaths. */
function assembleRatePathSeries(pointsByKey) {
  const get = (key) => pointsByKey[key] || [];
  const varAnchor = get('boi.mrtg.var_cpi_anchor');
  const marginByPeriod = new Map(get('boi.mrtg.var_cpi_margin').map((point) => [point.period, point.value]));
  return {
    policyRate: get('boi.policy_rate').map((point) => ({ date: point.period, value: point.value })),
    cpi: get('cbs.cpi'),
    inflationExpectations: {
      y1: latest(get('boi.infl_exp.1y'))?.value ?? null,
      y5: latest(get('boi.infl_exp.5y'))?.value ?? null,
      y10: latest(get('boi.infl_exp.10y'))?.value ?? null,
    },
    anchors: {
      variable_cpi: varAnchor,
      variable_unlinked: get('boi.zc.nominal.5y'),
    },
    marketRates: {
      fixed_unlinked: get('boi.mrtg.fixed_unlinked'),
      fixed_cpi: get('boi.mrtg.fixed_cpi'),
      variable_cpi: varAnchor
        .filter((point) => marginByPeriod.has(point.period))
        .map((point) => ({ period: point.period, value: point.value + marginByPeriod.get(point.period) })),
    },
  };
}

/** Everything rate-paths.buildPaths needs, read from the cache. */
async function loadRatePathSeries() {
  const entries = await Promise.all(RATE_PATH_KEYS.map(async (key) => [key, await getSeriesPoints(key)]));
  return assembleRatePathSeries(Object.fromEntries(entries));
}

function yearOverYear(points) {
  const last = latest(points);
  if (!last) return null;
  const [y, m] = last.period.split('-').map(Number);
  const previous = points.find((point) => point.period === `${y - 1}-${String(m).padStart(2, '0')}`);
  return previous ? ((last.value / previous.value) - 1) * 100 : null;
}

/** Headline figures for the UI chip / panel. */
async function getMarketSnapshot({ now = new Date() } = {}) {
  const rows = await listSeriesRows();
  const today = now.toISOString().slice(0, 10);
  const series = {};
  for (const key of Object.keys(SERIES)) {
    const row = rows.get(key);
    series[key] = {
      lastSyncedAt: row?.last_synced_at || null,
      lastPeriod: row?.last_observation_period || null,
      lastError: row?.last_error || null,
      stale: isStale(key, row, now),
      optional: Boolean(SERIES[key].optional),
    };
  }
  const [policy, cpi, hpi, newHpi, exp1, fixedUnlinked, fixedCpi, varAnchor, varMargin] = await Promise.all([
    getSeriesPoints('boi.policy_rate'),
    getSeriesPoints('cbs.cpi'),
    getSeriesPoints('cbs.hpi.national'),
    getSeriesPoints('cbs.hpi.new_dwellings'),
    getSeriesPoints('boi.infl_exp.1y'),
    getSeriesPoints('boi.mrtg.fixed_unlinked'),
    getSeriesPoints('boi.mrtg.fixed_cpi'),
    getSeriesPoints('boi.mrtg.var_cpi_anchor'),
    getSeriesPoints('boi.mrtg.var_cpi_margin'),
  ]);
  const policyNow = policy.filter((point) => point.period <= today).pop() || null;
  const knownPeriod = knownCpiPeriod(today);
  const cpiKnown = cpi.filter((point) => point.period <= knownPeriod).pop() || null;
  const meta = parseMeta(rows.get('boi.policy_rate'));
  const lastCpi = latest(cpi);
  const lastAnchor = latest(varAnchor);
  const lastMargin = latest(varMargin);
  return {
    asOf: today,
    hasData: policy.length > 0 || cpi.length > 0,
    policyRate: policyNow ? { value: policyNow.value, since: policyNow.period } : null,
    prime: policyNow ? { value: policyNow.value + PRIME_SPREAD } : null,
    nextDecisionDate: meta.nextDecisionDate || null,
    cpi: lastCpi
      ? {
        lastPeriod: lastCpi.period,
        yearOverYear: yearOverYear(cpi),
        knownPeriod: cpiKnown?.period || null,
      }
      : null,
    inflationExpectation1y: latest(exp1) ? { value: latest(exp1).value, period: latest(exp1).period } : null,
    housePrices: latest(hpi)
      ? { lastPeriod: latest(hpi).period, yearOverYear: yearOverYear(hpi), newDwellingsYearOverYear: yearOverYear(newHpi) }
      : null,
    averageMortgageRates: {
      fixed_unlinked: latest(fixedUnlinked),
      fixed_cpi: latest(fixedCpi),
      variable_cpi: lastAnchor && lastMargin && lastAnchor.period === lastMargin.period
        ? { period: lastAnchor.period, value: lastAnchor.value + lastMargin.value, anchor: lastAnchor.value, margin: lastMargin.value }
        : null,
      // The BoI publishes no average for prime or unlinked variable tracks.
      prime: null,
      variable_unlinked: null,
    },
    series,
  };
}

module.exports = {
  DEFAULT_SYNC_KEYS,
  RATE_PATH_KEYS,
  assembleRatePathSeries,
  SERIES,
  compressStepSeries,
  ensureFresh,
  ensureSchema,
  getMarketSnapshot,
  getSeries,
  getSeriesPoints,
  isStale,
  loadRatePathSeries,
  parseCbsIndexJson,
  syncMarketSeries,
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
    schemaPromise = null;
    inflightSync = null;
  },
  __resetDatabase() {
    database = actualDatabase;
    schemaPromise = null;
    inflightSync = null;
  },
};
