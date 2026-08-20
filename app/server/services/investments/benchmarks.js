const actualDatabase = require('../database.js');
const fxModule = require('./fx.js');

let database = actualDatabase;
let fxService = fxModule;

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeDate(value) {
  const date = String(value || '').trim().slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== date
  ) {
    throw serviceError(400, `Invalid benchmark date: ${value || '(empty)'}`);
  }
  return date;
}

function normalizeOptionalId(value, fieldName = 'benchmark id') {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw serviceError(400, `${fieldName} must be a positive integer`);
  }
  return id;
}

function normalizeBoolean(value, fieldName, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true') {
    return true;
  }
  if (value === false || value === 0 || value === '0' || String(value).toLowerCase() === 'false') {
    return false;
  }
  throw serviceError(400, `${fieldName} must be true or false`);
}

function normalizePoints(input) {
  if (!Array.isArray(input) || input.length < 2) {
    throw serviceError(400, 'A benchmark series requires at least two dated points');
  }
  const byDate = new Map();
  input.forEach((point) => {
    const date = normalizeDate(point?.date);
    const value = Number(point?.value);
    if (!Number.isFinite(value) || value <= 0) {
      throw serviceError(400, `Benchmark value for ${date} must be greater than zero`);
    }
    byDate.set(date, value);
  });
  const points = Array.from(byDate.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((left, right) => left.date.localeCompare(right.date));
  if (points.length < 2) {
    throw serviceError(400, 'A benchmark series requires at least two dated points');
  }
  return points;
}

function normalizeBenchmark(row, points = undefined) {
  return {
    id: Number(row.id),
    name: row.name,
    currency: row.currency,
    isTotalReturn: Boolean(Number(row.is_total_return)),
    source: row.source,
    sourceVersion: row.source_version || null,
    isDefault: Boolean(Number(row.is_default)),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    ...(points ? { points } : {}),
  };
}

async function listBenchmarks(params = {}) {
  const includePoints = params.includePoints === true || params.includePoints === 'true';
  const result = await database.query(
    'SELECT * FROM investment_benchmarks ORDER BY is_default DESC, name ASC',
    [],
  );
  const benchmarks = [];
  for (const row of result.rows || []) {
    let points;
    if (includePoints) {
      const pointResult = await database.query(
        `SELECT point_date AS date, point_value AS value
           FROM investment_benchmark_points
          WHERE benchmark_id = $1
          ORDER BY point_date ASC`,
        [row.id],
      );
      points = (pointResult.rows || []).map((point) => ({
        date: String(point.date).slice(0, 10),
        value: Number(point.value),
      }));
    }
    benchmarks.push(normalizeBenchmark(row, points));
  }
  return { benchmarks };
}

async function importBenchmark(payload = {}) {
  const name = String(payload.name || '').trim();
  const source = String(payload.source || '').trim();
  const currency = String(payload.currency || 'ILS').trim().toUpperCase();
  if (!name) throw serviceError(400, 'Benchmark name is required');
  if (!source) throw serviceError(400, 'Benchmark source is required');
  if (!/^[A-Z]{3}$/.test(currency)) throw serviceError(400, 'currency must be a three-letter code');
  const points = normalizePoints(payload.points);
  const isTotalReturn = normalizeBoolean(
    payload.isTotalReturn ?? payload.is_total_return,
    'isTotalReturn',
    false,
  );
  const isDefault = normalizeBoolean(
    payload.isDefault ?? payload.is_default,
    'isDefault',
    true,
  );

  const client = typeof database.getClient === 'function'
    ? await database.getClient()
    : { query: (...args) => database.query(...args), release: () => {} };
  try {
    await client.query('BEGIN');
    if (isDefault) {
      await client.query('UPDATE investment_benchmarks SET is_default = 0 WHERE is_default = 1');
    }
    const benchmarkResult = await client.query(
      `INSERT INTO investment_benchmarks (
         name, currency, is_total_return, source, source_version, is_default
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        name,
        currency,
        isTotalReturn ? 1 : 0,
        source,
        String(payload.sourceVersion ?? payload.source_version ?? '').trim() || null,
        isDefault ? 1 : 0,
      ],
    );
    const benchmark = benchmarkResult.rows[0];
    for (const point of points) {
      await client.query(
        `INSERT INTO investment_benchmark_points (benchmark_id, point_date, point_value)
         VALUES ($1, $2, $3)`,
        [benchmark.id, point.date, point.value],
      );
    }
    await client.query('COMMIT');
    return { benchmark: normalizeBenchmark(benchmark, points) };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release?.();
  }
}

async function removeBenchmark(params = {}) {
  const id = Number(params.id || params.benchmark_id);
  if (!Number.isInteger(id) || id <= 0) throw serviceError(400, 'Benchmark id is required');
  const result = await database.query(
    'DELETE FROM investment_benchmarks WHERE id = $1 RETURNING *',
    [id],
  );
  if (!result.rows?.length) throw serviceError(404, 'Benchmark not found');
  return { removed: normalizeBenchmark(result.rows[0]) };
}

async function getBenchmarkComparison({
  startDate,
  endDate,
  benchmarkId,
  baseCurrency: requestedBaseCurrency,
  base_currency: requestedBaseCurrencySnake,
} = {}) {
  if (!startDate || !endDate) {
    return { status: 'unavailable', reason: 'missing_portfolio_dates', benchmark: null };
  }
  const normalizedStartDate = normalizeDate(startDate);
  const normalizedEndDate = normalizeDate(endDate);
  if (normalizedStartDate > normalizedEndDate) {
    throw serviceError(400, 'startDate must be on or before endDate');
  }
  const normalizedBenchmarkId = normalizeOptionalId(benchmarkId);
  const params = [];
  const condition = normalizedBenchmarkId
    ? `id = $${params.push(normalizedBenchmarkId)}`
    : 'is_default = 1';
  const benchmarkResult = await database.query(
    `SELECT * FROM investment_benchmarks WHERE ${condition} ORDER BY id DESC LIMIT 1`,
    params,
  );
  const row = benchmarkResult.rows?.[0];
  if (!row) return { status: 'unavailable', reason: 'not_configured', benchmark: null };

  const pointsResult = await database.query(
    `SELECT point_date AS date, point_value AS value
      FROM investment_benchmark_points
      WHERE benchmark_id = $1
        AND point_date <= $2
      ORDER BY point_date ASC`,
    [row.id, normalizedEndDate],
  );
  const allPoints = (pointsResult.rows || []).map((point) => ({
    date: String(point.date).slice(0, 10),
    value: Number(point.value),
  }));
  const startPoint = allPoints.filter((point) => point.date <= normalizedStartDate).at(-1) || null;
  const endPoint = allPoints.filter((point) => point.date <= normalizedEndDate).at(-1) || null;
  if (!startPoint || !endPoint || startPoint.date === endPoint.date) {
    return {
      status: 'unavailable',
      reason: 'insufficient_overlapping_points',
      benchmark: normalizeBenchmark(row),
    };
  }
  const nativeReturn = endPoint.value / startPoint.value - 1;
  const baseCurrencyInput = requestedBaseCurrency || requestedBaseCurrencySnake;
  let comparisonReturn = nativeReturn;
  let returnCurrency = row.currency;
  let fx = null;

  if (baseCurrencyInput) {
    const baseCurrency = String(baseCurrencyInput).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(baseCurrency)) {
      throw serviceError(400, 'baseCurrency must be a three-letter currency code');
    }
    const [startConversion, endConversion] = await Promise.all([
      fxService.convertAmount({
        amount: startPoint.value,
        currency: row.currency,
        baseCurrency,
        date: startPoint.date,
      }),
      fxService.convertAmount({
        amount: endPoint.value,
        currency: row.currency,
        baseCurrency,
        date: endPoint.date,
      }),
    ]);
    if (!startConversion.complete || !endConversion.complete) {
      return {
        status: 'unavailable',
        reason: 'missing_fx_rates',
        benchmark: normalizeBenchmark(row),
        fx: {
          baseCurrency,
          complete: false,
          missing: [startConversion, endConversion].filter((item) => !item.complete),
        },
      };
    }
    comparisonReturn = endConversion.baseAmount / startConversion.baseAmount - 1;
    returnCurrency = baseCurrency;
    fx = {
      baseCurrency,
      complete: true,
      start: startConversion,
      end: endConversion,
    };
  }

  const points = allPoints.filter(
    (point) => point.date >= startPoint.date && point.date <= endPoint.date,
  );
  return {
    status: 'ok',
    reason: null,
    benchmark: normalizeBenchmark(row),
    startDate: normalizedStartDate,
    endDate: normalizedEndDate,
    startObservationDate: startPoint.date,
    endObservationDate: endPoint.date,
    return: comparisonReturn,
    nativeReturn,
    returnCurrency,
    currencyAdjusted: returnCurrency !== row.currency,
    fx,
    points,
  };
}

module.exports = {
  listBenchmarks,
  importBenchmark,
  removeBenchmark,
  getBenchmarkComparison,
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
    fxService.__setDatabase(database);
  },
  __setFxService(mockFxService) {
    fxService = mockFxService || fxModule;
  },
  __resetDatabase() {
    database = actualDatabase;
    fxService = fxModule;
    fxService.__resetDatabase();
  },
};

module.exports.default = module.exports;
