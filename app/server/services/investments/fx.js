const actualDatabase = require('../database.js');

const DEFAULT_BASE_CURRENCY = 'ILS';
const DEFAULT_MAX_AGE_DAYS = 14;
const DEFAULT_SOURCE = 'manual';
const BOI_SOURCE = 'Bank of Israel representative rate';
const BOI_ENDPOINT = 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/';

let database = actualDatabase;
let schemaPromise = null;

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeCurrency(value, fieldName = 'currency') {
  const currency = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw serviceError(400, `${fieldName} must be a three-letter currency code`);
  }
  return currency;
}

function normalizeDate(value = new Date()) {
  const raw = value instanceof Date ? value.toISOString() : String(value || '').trim();
  const date = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw serviceError(400, 'rate_date must be a valid YYYY-MM-DD date');
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw serviceError(400, 'rate_date must be a valid YYYY-MM-DD date');
  }
  return date;
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    throw serviceError(400, 'amount must be a finite number');
  }
  return amount;
}

function normalizeRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw serviceError(400, 'rate must be a positive finite number');
  }
  return rate;
}

function daysBetween(earlier, later) {
  const earlierTime = new Date(`${earlier}T00:00:00.000Z`).getTime();
  const laterTime = new Date(`${later}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.round((laterTime - earlierTime) / 86_400_000));
}

function normalizeMaxAgeDays(value) {
  const rawValue = value === undefined || value === null || value === ''
    ? DEFAULT_MAX_AGE_DAYS
    : value;
  const maxAgeDays = Number(rawValue);
  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
    throw serviceError(400, 'maxAgeDays must be a non-negative finite number');
  }
  return maxAgeDays;
}

function missingRateResult(fromCurrency, toCurrency, requestedDate) {
  return {
    requestedDate,
    rateDate: null,
    fromCurrency,
    toCurrency,
    rate: null,
    source: null,
    ageDays: null,
    status: 'missing',
  };
}

function applyMaxAge(rateResult, maxAgeDays) {
  if (!rateResult || rateResult.status === 'missing' || rateResult.status === 'identity') {
    return rateResult;
  }
  return rateResult.ageDays > maxAgeDays
    ? { ...rateResult, status: 'stale' }
    : rateResult;
}

function rateComponent(rateResult) {
  return {
    fromCurrency: rateResult.fromCurrency,
    toCurrency: rateResult.toCurrency,
    rate: rateResult.rate,
    rateDate: rateResult.rateDate,
    source: rateResult.source,
    ageDays: rateResult.ageDays,
    status: rateResult.status,
  };
}

function identityRate(currency, requestedDate) {
  return {
    requestedDate,
    rateDate: requestedDate,
    fromCurrency: currency,
    toCurrency: currency,
    rate: 1,
    source: 'identity',
    ageDays: 0,
    status: 'identity',
  };
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await database.query(`
        CREATE TABLE IF NOT EXISTS investment_fx_preferences (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          base_currency TEXT NOT NULL DEFAULT 'ILS',
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await database.query(`
        CREATE TABLE IF NOT EXISTS investment_fx_rates (
          rate_date TEXT NOT NULL,
          from_currency TEXT NOT NULL,
          to_currency TEXT NOT NULL,
          rate REAL NOT NULL CHECK (rate > 0),
          source TEXT NOT NULL DEFAULT 'manual',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (rate_date, from_currency, to_currency)
        )
      `);
      await database.query(
        `
          INSERT INTO investment_fx_preferences (id, base_currency)
          VALUES (1, $1)
          ON CONFLICT (id) DO NOTHING
        `,
        [DEFAULT_BASE_CURRENCY],
      );
      await database.query(
        'CREATE INDEX IF NOT EXISTS idx_investment_fx_rates_lookup ON investment_fx_rates(from_currency, to_currency, rate_date DESC)',
      );
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  await schemaPromise;
}

async function getBaseCurrency() {
  await ensureSchema();
  const result = await database.query(
    'SELECT base_currency FROM investment_fx_preferences WHERE id = 1 LIMIT 1',
  );
  const value = result.rows?.[0]?.base_currency || DEFAULT_BASE_CURRENCY;
  return normalizeCurrency(value, 'base_currency');
}

async function setBaseCurrency(value) {
  await ensureSchema();
  const baseCurrency = normalizeCurrency(value, 'base_currency');
  const result = await database.query(
    `
      INSERT INTO investment_fx_preferences (id, base_currency, updated_at)
      VALUES (1, $1, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        base_currency = excluded.base_currency,
        updated_at = CURRENT_TIMESTAMP
      RETURNING base_currency
    `,
    [baseCurrency],
  );
  return normalizeCurrency(result.rows?.[0]?.base_currency || baseCurrency, 'base_currency');
}

function normalizeRateRow(row, requestedDate = null) {
  if (!row) return null;
  const rateDate = normalizeDate(row.rate_date);
  const fromCurrency = normalizeCurrency(row.from_currency, 'from_currency');
  const toCurrency = normalizeCurrency(row.to_currency, 'to_currency');
  const normalized = {
    rateDate,
    fromCurrency,
    toCurrency,
    rate: normalizeRate(row.rate),
    source: String(row.source || DEFAULT_SOURCE),
  };
  if (requestedDate) {
    normalized.requestedDate = requestedDate;
    normalized.ageDays = daysBetween(rateDate, requestedDate);
    normalized.status = rateDate === requestedDate ? 'exact' : 'prior';
  }
  return normalized;
}

async function upsertRate(payload = {}) {
  await ensureSchema();
  const rateDate = normalizeDate(payload.rateDate ?? payload.rate_date);
  const fromCurrency = normalizeCurrency(
    payload.fromCurrency ?? payload.from_currency,
    'from_currency',
  );
  const toCurrency = normalizeCurrency(
    payload.toCurrency ?? payload.to_currency,
    'to_currency',
  );
  if (fromCurrency === toCurrency) {
    throw serviceError(400, 'Manual FX rates must convert between different currencies');
  }
  const rate = normalizeRate(payload.rate);
  const source = String(payload.source || DEFAULT_SOURCE).trim() || DEFAULT_SOURCE;

  const result = await database.query(
    `
      INSERT INTO investment_fx_rates (
        rate_date,
        from_currency,
        to_currency,
        rate,
        source,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (rate_date, from_currency, to_currency) DO UPDATE SET
        rate = excluded.rate,
        source = excluded.source,
        updated_at = CURRENT_TIMESTAMP
      RETURNING rate_date, from_currency, to_currency, rate, source
    `,
    [rateDate, fromCurrency, toCurrency, rate, source],
  );

  return normalizeRateRow(result.rows?.[0] || {
    rate_date: rateDate,
    from_currency: fromCurrency,
    to_currency: toCurrency,
    rate,
    source,
  });
}

async function listRates(params = {}) {
  await ensureSchema();
  const conditions = [];
  const values = [];

  if (params.fromCurrency || params.from_currency) {
    values.push(normalizeCurrency(params.fromCurrency ?? params.from_currency, 'from_currency'));
    conditions.push(`from_currency = $${values.length}`);
  }
  if (params.toCurrency || params.to_currency) {
    values.push(normalizeCurrency(params.toCurrency ?? params.to_currency, 'to_currency'));
    conditions.push(`to_currency = $${values.length}`);
  }
  if (params.startDate || params.start_date) {
    values.push(normalizeDate(params.startDate ?? params.start_date));
    conditions.push(`rate_date >= $${values.length}`);
  }
  if (params.endDate || params.end_date) {
    values.push(normalizeDate(params.endDate ?? params.end_date));
    conditions.push(`rate_date <= $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await database.query(
    `
      SELECT rate_date, from_currency, to_currency, rate, source
      FROM investment_fx_rates
      ${whereClause}
      ORDER BY rate_date DESC, from_currency ASC, to_currency ASC
    `,
    values,
  );

  return (result.rows || []).map((row) => normalizeRateRow(row));
}

async function findStoredRate(fromCurrency, toCurrency, requestedDate) {
  const result = await database.query(
    `
      SELECT rate_date, from_currency, to_currency, rate, source
      FROM investment_fx_rates
      WHERE from_currency = $1
        AND to_currency = $2
        AND rate_date <= $3
      ORDER BY rate_date DESC
      LIMIT 1
    `,
    [fromCurrency, toCurrency, requestedDate],
  );
  const row = result.rows?.[0];
  if (!row) return null;

  const normalized = normalizeRateRow(row, requestedDate);
  // The SQL predicate is authoritative. These defensive checks prevent a
  // malformed adapter/mock from leaking a future or wrong-direction row into
  // a historical conversion.
  if (normalized.rateDate > requestedDate
    || normalized.fromCurrency !== fromCurrency
    || normalized.toCurrency !== toCurrency) {
    return null;
  }
  return normalized;
}

function deriveReciprocalRate(reverseRate, fromCurrency, toCurrency, requestedDate) {
  return {
    requestedDate,
    rateDate: reverseRate.rateDate,
    fromCurrency,
    toCurrency,
    rate: 1 / reverseRate.rate,
    source: `Derived reciprocal of ${reverseRate.source}`,
    ageDays: reverseRate.ageDays,
    status: reverseRate.status === 'exact' ? 'exact' : 'prior',
    derived: true,
    derivation: 'reciprocal',
    components: [rateComponent(reverseRate)],
  };
}

function deriveIlsCrossRate(fromLeg, toLeg, fromCurrency, toCurrency, requestedDate) {
  const components = [fromLeg, toLeg];
  const rateDate = components
    .map((component) => component.rateDate)
    .sort()[0];
  const ageDays = Math.max(...components.map((component) => component.ageDays));
  const exact = components.every((component) => (
    component.status === 'exact' || component.status === 'identity'
  ));
  const sources = Array.from(new Set(components.map((component) => component.source)));
  return {
    requestedDate,
    rateDate,
    fromCurrency,
    toCurrency,
    rate: fromLeg.rate / toLeg.rate,
    source: `Derived via ILS from ${sources.join(' + ')}`,
    ageDays,
    status: exact ? 'exact' : 'prior',
    derived: true,
    derivation: 'ils_cross',
    components: components.map(rateComponent),
  };
}

async function getRate(params = {}) {
  await ensureSchema();
  const fromCurrency = normalizeCurrency(
    params.fromCurrency ?? params.from_currency,
    'from_currency',
  );
  const toCurrency = normalizeCurrency(
    params.toCurrency ?? params.to_currency,
    'to_currency',
  );
  const requestedDate = normalizeDate(params.date ?? params.rateDate ?? params.rate_date);
  const maxAgeDays = normalizeMaxAgeDays(params.maxAgeDays ?? params.max_age_days);

  if (fromCurrency === toCurrency) {
    return identityRate(fromCurrency, requestedDate);
  }

  const storedRateCache = new Map();
  const lookupStoredRate = (lookupFrom, lookupTo) => {
    const key = `${lookupFrom}|${lookupTo}`;
    if (!storedRateCache.has(key)) {
      storedRateCache.set(
        key,
        findStoredRate(lookupFrom, lookupTo, requestedDate),
      );
    }
    return storedRateCache.get(key);
  };
  const directRate = await lookupStoredRate(fromCurrency, toCurrency);
  if (directRate) {
    return applyMaxAge(directRate, maxAgeDays);
  }

  const reverseRate = await lookupStoredRate(toCurrency, fromCurrency);
  if (reverseRate) {
    return applyMaxAge(
      deriveReciprocalRate(reverseRate, fromCurrency, toCurrency, requestedDate),
      maxAgeDays,
    );
  }

  const [fromIlsLeg, toIlsLeg] = await Promise.all([
    fromCurrency === DEFAULT_BASE_CURRENCY
      ? identityRate(DEFAULT_BASE_CURRENCY, requestedDate)
      : lookupStoredRate(fromCurrency, DEFAULT_BASE_CURRENCY),
    toCurrency === DEFAULT_BASE_CURRENCY
      ? identityRate(DEFAULT_BASE_CURRENCY, requestedDate)
      : lookupStoredRate(toCurrency, DEFAULT_BASE_CURRENCY),
  ]);
  if (fromIlsLeg && toIlsLeg) {
    return applyMaxAge(
      deriveIlsCrossRate(
        fromIlsLeg,
        toIlsLeg,
        fromCurrency,
        toCurrency,
        requestedDate,
      ),
      maxAgeDays,
    );
  }

  return missingRateResult(fromCurrency, toCurrency, requestedDate);
}

async function convertAmount(params = {}) {
  await ensureSchema();
  const amount = normalizeAmount(params.amount);
  const currency = normalizeCurrency(
    params.currency ?? params.fromCurrency ?? params.from_currency,
    'currency',
  );
  const baseCurrency = params.baseCurrency || params.toCurrency || params.to_currency
    ? normalizeCurrency(
      params.baseCurrency ?? params.toCurrency ?? params.to_currency,
      'base_currency',
    )
    : await getBaseCurrency();
  const requestedDate = normalizeDate(params.date ?? params.rateDate ?? params.rate_date);
  const rateResult = await getRate({
    fromCurrency: currency,
    toCurrency: baseCurrency,
    date: requestedDate,
    maxAgeDays: params.maxAgeDays ?? params.max_age_days,
  });
  const usable = !['missing', 'stale'].includes(rateResult.status);
  const baseAmount = usable ? amount * rateResult.rate : null;

  return {
    amount,
    currency,
    baseAmount,
    baseCurrency,
    convertedAmount: baseAmount,
    requestedDate,
    rate: rateResult.rate,
    rateDate: rateResult.rateDate,
    rateAgeDays: rateResult.ageDays,
    source: rateResult.source,
    status: rateResult.status,
    derived: rateResult.derived === true,
    derivation: rateResult.derivation || null,
    rateComponents: rateResult.components || [],
    complete: usable,
  };
}

function groupNativeTotals(entries = []) {
  const totals = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const currency = normalizeCurrency(
      entry?.currency ?? entry?.fromCurrency ?? entry?.from_currency,
      'currency',
    );
    const amount = normalizeAmount(entry?.amount);
    const current = totals.get(currency) || { currency, total: 0, count: 0 };
    current.total += amount;
    current.count += 1;
    totals.set(currency, current);
  });

  return Array.from(totals.values()).sort((left, right) =>
    left.currency.localeCompare(right.currency));
}

async function summarizeAmounts(entries = [], options = {}) {
  await ensureSchema();
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  const baseCurrency = options.baseCurrency
    ? normalizeCurrency(options.baseCurrency, 'base_currency')
    : await getBaseCurrency();
  const nativeTotals = groupNativeTotals(normalizedEntries);
  const conversions = await Promise.all(normalizedEntries.map((entry) => convertAmount({
    amount: entry.amount,
    currency: entry.currency ?? entry.fromCurrency ?? entry.from_currency,
    baseCurrency,
    date: entry.date ?? entry.rateDate ?? entry.rate_date ?? options.date,
    maxAgeDays: entry.maxAgeDays ?? options.maxAgeDays,
  })));
  const missing = conversions
    .map((conversion, index) => ({ ...conversion, index }))
    .filter((conversion) => !conversion.complete);
  const convertedSubtotal = conversions.reduce(
    (sum, conversion) => sum + (conversion.baseAmount ?? 0),
    0,
  );

  return {
    baseCurrency,
    nativeTotals,
    baseTotal: missing.length === 0 ? convertedSubtotal : null,
    convertedSubtotal,
    complete: missing.length === 0,
    conversions,
    missing,
  };
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  values.push(current);
  return values;
}

function parseBoiCsv(csvText) {
  const lines = String(csvText || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const headerIndex = (name) => headers.indexOf(name);
  const currencyIndex = headerIndex('BASE_CURRENCY');
  const counterIndex = headerIndex('COUNTER_CURRENCY');
  const dateIndex = headerIndex('TIME_PERIOD');
  const valueIndex = headerIndex('OBS_VALUE');
  const unitMultiplierIndex = headerIndex('UNIT_MULT');
  if ([currencyIndex, counterIndex, dateIndex, valueIndex].some((index) => index < 0)) {
    throw serviceError(502, 'Bank of Israel FX response did not contain the expected columns');
  }

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const unitMultiplier = unitMultiplierIndex < 0 || values[unitMultiplierIndex] === ''
      ? 0
      : Number(values[unitMultiplierIndex]);
    if (!Number.isInteger(unitMultiplier)) {
      throw serviceError(502, 'Bank of Israel FX response contained an invalid unit multiplier');
    }
    return {
      fromCurrency: normalizeCurrency(values[currencyIndex], 'from_currency'),
      toCurrency: normalizeCurrency(values[counterIndex], 'to_currency'),
      rateDate: normalizeDate(values[dateIndex]),
      // SDMX UNIT_MULT=2 means the observation is quoted per 10^2 units
      // (notably JPY per 100 yen). Store all rates on a one-unit basis.
      rate: normalizeRate(Number(values[valueIndex]) / (10 ** unitMultiplier)),
      source: BOI_SOURCE,
    };
  });
}

async function syncBoiRates(payload = {}, dependencies = {}) {
  const baseCurrencyInput = payload.baseCurrency ?? payload.base_currency;
  const baseCurrency = baseCurrencyInput
    ? normalizeCurrency(baseCurrencyInput, 'base_currency')
    : await getBaseCurrency();
  if (baseCurrency !== 'ILS') {
    throw serviceError(400, 'Automatic Bank of Israel sync currently supports an ILS base currency');
  }

  const currencies = Array.from(new Set(
    (Array.isArray(payload.currencies) ? payload.currencies : ['USD', 'EUR', 'GBP'])
      .map((currency) => normalizeCurrency(currency, 'currency'))
      .filter((currency) => currency !== 'ILS'),
  ));
  if (currencies.length === 0) {
    return { baseCurrency, imported: 0, rates: [] };
  }

  const requestUrl = new URL(BOI_ENDPOINT);
  requestUrl.searchParams.set('c[DATA_TYPE]', 'OF00');
  requestUrl.searchParams.set('c[BASE_CURRENCY]', currencies.join(','));
  requestUrl.searchParams.set('c[COUNTER_CURRENCY]', 'ILS');
  requestUrl.searchParams.set('format', 'csv');
  const startDateInput = payload.startDate ?? payload.start_date;
  const endDateInput = payload.endDate ?? payload.end_date;
  const startDate = startDateInput ? normalizeDate(startDateInput) : null;
  const endDate = endDateInput ? normalizeDate(endDateInput) : null;
  if (startDate && endDate && startDate > endDate) {
    throw serviceError(400, 'startDate must be on or before endDate');
  }
  if (startDate) requestUrl.searchParams.set('startPeriod', startDate);
  if (endDate) requestUrl.searchParams.set('endPeriod', endDate);
  if (!requestUrl.searchParams.has('startPeriod')) {
    const last = Number(payload.lastNObservations ?? payload.last_n_observations ?? 10);
    requestUrl.searchParams.set('lastNObservations', String(Number.isFinite(last) ? Math.max(1, Math.min(4000, Math.trunc(last))) : 10));
  }
  // The BOI SDMX endpoint documents comma-separated filter values and returns
  // HTTP 404 when the comma is percent-encoded as %2C. URLSearchParams encodes
  // it by default, so restore the literal separator before issuing the request.
  requestUrl.href = requestUrl.href.replace(/%2C/gi, ',');

  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw serviceError(503, 'FX sync is unavailable in this environment');
  }
  let response;
  try {
    response = await fetchImpl(requestUrl, {
      headers: { Accept: 'text/csv' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw serviceError(503, `Could not reach the Bank of Israel FX service: ${error?.message || error}`);
  }
  if (!response.ok) {
    throw serviceError(502, `Bank of Israel FX service returned HTTP ${response.status}`);
  }

  const parsedRates = parseBoiCsv(await response.text())
    .filter((rate) => currencies.includes(rate.fromCurrency) && rate.toCurrency === 'ILS');
  for (const rate of parsedRates) {
    await upsertRate(rate);
  }

  return {
    baseCurrency,
    imported: parsedRates.length,
    source: BOI_SOURCE,
    rates: parsedRates,
  };
}

module.exports = {
  DEFAULT_BASE_CURRENCY,
  DEFAULT_MAX_AGE_DAYS,
  convertAmount,
  ensureSchema,
  getBaseCurrency,
  getRate,
  groupNativeTotals,
  listRates,
  setBaseCurrency,
  summarizeAmounts,
  syncBoiRates,
  upsertRate,
  __parseBoiCsv: parseBoiCsv,
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
    schemaPromise = null;
  },
  __resetDatabase() {
    database = actualDatabase;
    schemaPromise = null;
  },
};

module.exports.default = module.exports;
