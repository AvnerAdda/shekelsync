/**
 * Where the current month, week or day stands against the user's own past periods at the
 * same point (day 10 of this month vs. day 10 of previous months), what drives the gap,
 * and data problems that would make the comparison wrong.
 */
const actualDatabase = require('../database.js');
const actualFinancialTruth = require('../financial-truth.js');
const { dialect } = require('../../../lib/sql-dialect.js');
const { createTtlCache, clearAllTtlCaches } = require('../../../lib/server/ttl-cache.js');
const { getCreditCardRepaymentCategoryCondition } = require('../accounts/repayment-category.js');
const { repairTransactionCategoryTypes } = require('../categorization/category-type-sync.js');
const { dateKey, validDate, shiftDays, invalid } = require('../planning-math.js');

let database = actualDatabase;
let financialTruth = actualFinancialTruth;
const cache = createTtlCache({ maxEntries: 20, defaultTtlMs: 60 * 1000 });

const GRANULARITIES = ['month', 'week', 'day'];
const METRICS = ['spend', 'income'];
const SCOPES = ['all', 'everyday'];
const PAST_PERIODS = { month: 6, week: 12 };
const AXIS_LENGTH = { month: 31, week: 7 };
const DAY_WINDOW = 42;
const DAY_BASELINE_WEEKS = 8;
const LOOKBACK_DAYS = 230;
const CHECK_WINDOW_DAYS = 45;
// The usual range is the middle of past periods, so one unusual month does not widen it.
const BAND = [0.2, 0.8];
const MIN_PERIODS_FOR_BAND = 2;
// An institution with this small a share of recent transactions does not limit history.
const MIN_VENDOR_SHARE = 0.15;
const STALE_SYNC_DAYS = 3;
const UNUSUAL_DAY_MIN = 250;
const NEW_MERCHANT_MIN = 200;
const DRIVER_LIMIT = 6;
const DAY_TRANSACTION_LIMIT = 5;
const DRIFT_MIN_HISTORY = 2;
const DRIFT_MIN_SHARE = 0.75;

const round2 = (value) => Math.round(value * 100) / 100;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const weekdayOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const normalizeMerchant = (row) => String(row.merchant_name || row.name || '').trim().toLowerCase().replace(/\s+/g, ' ');

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

const median = (values) => quantile(values, 0.5);

function daysInMonth(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addMonths(monthKey, count) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Weeks start on Sunday, as in Israel. x is the 1-based position inside the period. */
function periodOf(granularity, day) {
  if (granularity === 'month') {
    const key = day.slice(0, 7);
    return { key, start: `${key}-01`, end: `${key}-${daysInMonth(key)}`, x: Number(day.slice(8, 10)), length: daysInMonth(key) };
  }
  const start = shiftDays(day, -weekdayOf(day));
  return { key: start, start, end: shiftDays(start, 6), x: weekdayOf(day) + 1, length: 7 };
}

function previousPeriod(granularity, period, count) {
  return granularity === 'month'
    ? periodOf('month', `${addMonths(period.key, -count)}-01`)
    : periodOf('week', shiftDays(period.start, -7 * count));
}

function metricValue(row, metric) {
  const price = Number(row.price);
  if (!Number.isFinite(price)) return null;
  if (metric === 'income') {
    if (row.category_type !== 'income' || !Number(row.counted_as_income) || Number(row.capital_return)) return null;
    return price;
  }
  // Refunds in a spending category reduce spending.
  return row.category_type === 'expense' ? -price : null;
}

function categoryOf(row) {
  return {
    key: row.category_id == null ? 'none' : String(row.category_id),
    categoryId: row.category_id == null ? null : Number(row.category_id),
    name: row.category_name || null,
    nameEn: row.category_name_en || null,
    nameFr: row.category_name_fr || null,
  };
}

function compareToBand(current, past) {
  if (past.length < MIN_PERIODS_FOR_BAND) {
    return { current: round2(current), median: null, low: null, high: null, status: 'insufficient', deltaAmount: null, deltaPercent: null };
  }
  const mid = median(past);
  const low = quantile(past, BAND[0]);
  const high = quantile(past, BAND[1]);
  const status = current > high ? 'above' : current < low ? 'below' : 'within';
  return {
    current: round2(current),
    median: round2(mid),
    low: round2(low),
    high: round2(high),
    status,
    deltaAmount: round2(current - mid),
    deltaPercent: mid > 0 ? Math.round(((current - mid) / mid) * 100) : null,
  };
}

/** The latest first-transaction day among institutions that carry real volume. */
function resolveCoverageStart(vendorStats = []) {
  const recentTotal = sum(vendorStats.map((row) => Number(row.recent_count) || 0));
  const starts = vendorStats
    .filter((row) => row.first_day && (recentTotal === 0 || (Number(row.recent_count) || 0) / recentTotal >= MIN_VENDOR_SHARE))
    .map((row) => String(row.first_day).slice(0, 10));
  return starts.length ? starts.sort().at(-1) : null;
}

function buildPeriodComparison({ counted, rows, today, granularity, metric, coverageStart }) {
  const current = periodOf(granularity, today);
  const past = [];
  for (let count = 1; count <= PAST_PERIODS[granularity]; count += 1) {
    const period = previousPeriod(granularity, current, count);
    if (coverageStart && period.start < coverageStart) break;
    past.push(period);
  }
  const tracked = new Map([current, ...past].map((period) => [period.key, {
    period, daily: new Array(AXIS_LENGTH[granularity] + 1).fill(0), categories: new Map(),
  }]));

  counted.forEach((entry) => {
    const position = periodOf(granularity, entry.day);
    const bucket = tracked.get(position.key);
    if (!bucket) return;
    bucket.daily[position.x] += entry.value;
    const category = bucket.categories.get(entry.category.key) || { ...entry.category, toDate: 0, total: 0 };
    category.total += entry.value;
    if (position.x <= current.x) category.toDate += entry.value;
    bucket.categories.set(entry.category.key, category);
  });

  const cumulative = (bucket) => {
    let running = 0;
    return bucket.daily.map((value, x) => (x === 0 ? 0 : (running += value)));
  };
  const currentBucket = tracked.get(current.key);
  const currentCumulative = cumulative(currentBucket);
  const pastBuckets = past.map((period) => tracked.get(period.key));
  const pastCumulative = pastBuckets.map(cumulative);

  const points = [];
  for (let x = 1; x <= AXIS_LENGTH[granularity]; x += 1) {
    const values = pastCumulative.map((series) => series[x]);
    const hasBand = values.length >= MIN_PERIODS_FOR_BAND;
    points.push({
      x,
      current: x <= current.x ? round2(currentCumulative[x]) : null,
      previous: past[0] && x <= past[0].length ? round2(pastCumulative[0][x]) : null,
      median: hasBand ? round2(median(values)) : null,
      low: hasBand ? round2(quantile(values, BAND[0])) : null,
      high: hasBand ? round2(quantile(values, BAND[1])) : null,
    });
  }

  const atNow = pastCumulative.map((series) => series[current.x]);
  const totals = pastCumulative.map((series) => series[AXIS_LENGTH[granularity]]);
  const pace = {
    ...compareToBand(currentCumulative[current.x], atNow),
    x: current.x,
    length: current.length,
    typicalTotal: totals.length >= MIN_PERIODS_FOR_BAND ? round2(median(totals)) : null,
    projectedTotal: totals.length >= MIN_PERIODS_FOR_BAND
      ? round2(currentCumulative[current.x] + median(totals.map((total, index) => total - atNow[index])))
      : null,
  };

  const categoryKeys = new Set([...currentBucket.categories.keys(), ...pastBuckets.flatMap((bucket) => [...bucket.categories.keys()])]);
  const threshold = Math.max(50, Math.abs(pace.median || 0) * 0.03);
  const drivers = pastBuckets.length < MIN_PERIODS_FOR_BAND ? [] : [...categoryKeys].map((key) => {
    const mine = currentBucket.categories.get(key);
    const info = mine || pastBuckets.map((bucket) => bucket.categories.get(key)).find(Boolean);
    const currentValue = mine?.toDate || 0;
    const typical = median(pastBuckets.map((bucket) => bucket.categories.get(key)?.toDate || 0));
    return {
      categoryId: info.categoryId, name: info.name, nameEn: info.nameEn, nameFr: info.nameFr,
      current: round2(currentValue), typical: round2(typical), delta: round2(currentValue - typical),
    };
  })
    .filter((driver) => Math.abs(driver.delta) >= threshold)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, DRIVER_LIMIT);

  let newMerchants = [];
  const historyIsLongEnough = !coverageStart || daysBetween(coverageStart, current.start) >= 60;
  if (metric === 'spend' && historyIsLongEnough) {
    const seen = new Set(rows.filter((row) => row.day < current.start).map(normalizeMerchant));
    const fresh = new Map();
    counted.filter((entry) => entry.day >= current.start && entry.day <= today).forEach((entry) => {
      const key = normalizeMerchant(entry.row);
      if (!key || seen.has(key)) return;
      const merchant = fresh.get(key) || {
        merchant: entry.row.merchant_name || entry.row.name,
        amount: 0,
        count: 0,
        category: { categoryId: entry.category.categoryId, name: entry.category.name, nameEn: entry.category.nameEn, nameFr: entry.category.nameFr },
      };
      merchant.amount += entry.value;
      merchant.count += 1;
      fresh.set(key, merchant);
    });
    newMerchants = [...fresh.values()]
      .filter((merchant) => merchant.amount >= NEW_MERCHANT_MIN)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((merchant) => ({ ...merchant, amount: round2(merchant.amount) }));
  }

  const periods = [...past].reverse().map((period, index, list) => ({
    key: period.key, start: period.start, end: period.end, isCurrent: false,
    total: round2(totals[list.length - 1 - index]),
  }));
  periods.push({
    key: current.key, start: current.start, end: current.end, isCurrent: true,
    total: round2(currentCumulative[current.x]), projected: pace.projectedTotal,
  });

  return { current: { key: current.key, start: current.start, end: current.end }, points, pace, drivers, newMerchants, periods };
}

function buildDayComparison({ counted, today, metric, coverageStart }) {
  const totals = new Map();
  const transactions = new Map();
  counted.forEach((entry) => {
    totals.set(entry.day, (totals.get(entry.day) || 0) + entry.value);
    if (!transactions.has(entry.day)) transactions.set(entry.day, []);
    transactions.get(entry.day).push(entry);
  });
  const valueOn = (day) => totals.get(day) || 0;
  const inHistory = (day) => !coverageStart || day >= coverageStart;

  const days = [];
  for (let offset = DAY_WINDOW - 1; offset >= 0; offset -= 1) {
    const day = shiftDays(today, -offset);
    if (!inHistory(day)) continue;
    const history = [];
    for (let week = 1; week <= DAY_BASELINE_WEEKS; week += 1) {
      const earlier = shiftDays(day, -7 * week);
      if (inHistory(earlier)) history.push(valueOn(earlier));
    }
    const hasBand = history.length >= 3;
    const value = valueOn(day);
    const high = hasBand ? quantile(history, BAND[1]) : null;
    days.push({
      date: day,
      weekday: weekdayOf(day),
      value: round2(value),
      median: hasBand ? round2(median(history)) : null,
      low: hasBand ? round2(quantile(history, BAND[0])) : null,
      high: hasBand ? round2(high) : null,
      unusual: metric === 'spend' && hasBand && value - high >= Math.max(UNUSUAL_DAY_MIN, high),
      transactions: (transactions.get(day) || [])
        .sort((a, b) => b.value - a.value)
        .slice(0, DAY_TRANSACTION_LIMIT)
        .map((entry) => ({
          identifier: entry.row.identifier, vendor: entry.row.vendor,
          name: entry.row.merchant_name || entry.row.name, amount: round2(entry.value),
          categoryId: entry.category.categoryId, categoryName: entry.category.name,
          categoryNameEn: entry.category.nameEn, categoryNameFr: entry.category.nameFr,
        })),
    });
  }

  // Last 7 days against the previous non-overlapping 7-day windows.
  const windowSum = (end) => sum(Array.from({ length: 7 }, (_, index) => valueOn(shiftDays(end, -index))));
  const pastWindows = [];
  for (let week = 1; week <= DAY_BASELINE_WEEKS; week += 1) {
    const end = shiftDays(today, -7 * week);
    if (inHistory(shiftDays(end, -6))) pastWindows.push(windowSum(end));
  }
  return {
    days,
    pace: { ...compareToBand(windowSum(today), pastWindows), x: 7, length: 7 },
    unusualDays: days.filter((day) => day.unusual).length,
  };
}

/** Same merchant, usually one category, recently filed under another. */
function findCategoryDrift(rows, today) {
  const boundary = shiftDays(today, -CHECK_WINDOW_DAYS);
  const history = new Map();
  rows.filter((row) => row.day <= boundary && row.category_id != null).forEach((row) => {
    const key = normalizeMerchant(row);
    if (!key) return;
    const counts = history.get(key) || new Map();
    const category = categoryOf(row);
    const entry = counts.get(category.key) || { ...category, type: row.category_type, count: 0 };
    entry.count += 1;
    counts.set(category.key, entry);
    history.set(key, counts);
  });
  const drift = new Map();
  rows.filter((row) => row.day > boundary && row.day <= today).forEach((row) => {
    const key = normalizeMerchant(row);
    const counts = history.get(key);
    if (!counts) return;
    const total = sum([...counts.values()].map((entry) => entry.count));
    const usual = [...counts.values()].sort((a, b) => b.count - a.count)[0];
    if (usual.count < DRIFT_MIN_HISTORY || usual.count / total < DRIFT_MIN_SHARE) return;
    const category = categoryOf(row);
    if (category.key === usual.key) return;
    const existing = drift.get(key);
    if (existing && existing.date >= row.day) {
      existing.count += 1;
      return;
    }
    drift.set(key, {
      type: 'category_drift',
      merchant: row.merchant_name || row.name,
      date: row.day,
      amount: round2(Math.abs(Number(row.price) || 0)),
      count: (existing?.count || 0) + 1,
      identifier: row.identifier,
      vendor: row.vendor,
      category: { ...category, type: row.category_type },
      usualCategory: { categoryId: usual.categoryId, name: usual.name, nameEn: usual.nameEn, nameFr: usual.nameFr, type: usual.type, count: usual.count },
    });
  });
  return [...drift.values()].sort((a, b) => b.amount - a.amount);
}

/** Rows whose stored type disagrees with their category, e.g. a salary stored as an expense. */
function findTypeMismatches(rows) {
  const mismatched = rows.filter((row) => row.category_id != null
    && row.stored_type === 'expense'
    && ['income', 'investment'].includes(row.category_definition_type));
  if (!mismatched.length) return [];
  return [{
    type: 'type_mismatch',
    count: mismatched.length,
    transactions: mismatched
      .sort((a, b) => (a.day < b.day ? 1 : -1))
      .slice(0, 10)
      .map((row) => ({
        identifier: row.identifier, vendor: row.vendor, date: row.day,
        name: row.merchant_name || row.name, amount: round2(Number(row.price) || 0),
        storedType: row.stored_type, categoryType: row.category_definition_type,
        categoryName: row.category_name, categoryNameEn: row.category_name_en, categoryNameFr: row.category_name_fr,
      })),
  }];
}

function findStaleAccounts(accounts = [], today) {
  return accounts
    .map((account) => {
      const lastSuccess = account.last_scrape_success ? String(account.last_scrape_success).slice(0, 10) : null;
      const days = lastSuccess ? daysBetween(lastSuccess, today) : null;
      const failed = account.last_scrape_status === 'failed';
      const stale = days == null || days >= STALE_SYNC_DAYS || (failed && days >= 1);
      return stale ? {
        type: 'stale_account', vendor: account.vendor, nickname: account.nickname || null,
        lastSuccess, days, lastStatus: account.last_scrape_status || null,
      } : null;
    })
    .filter(Boolean);
}

function buildRhythmComparison({
  rows = [], today, granularity = 'month', metric = 'spend', scope = 'all',
  isRecurring = () => false, coverageStart = null, accounts = [],
}) {
  const visible = rows.filter((row) => row.day && row.day <= today);
  const counted = [];
  visible.forEach((row) => {
    const value = metricValue(row, metric);
    if (value == null || value === 0) return;
    if (scope === 'everyday' && isRecurring(row)) return;
    counted.push({ day: row.day, value, category: categoryOf(row), row });
  });
  const comparison = granularity === 'day'
    ? buildDayComparison({ counted, today, metric, coverageStart })
    : buildPeriodComparison({ counted, rows: visible, today, granularity, metric, coverageStart });
  return {
    granularity,
    metric,
    scope,
    asOf: today,
    coverageStart,
    ...comparison,
    checks: [
      ...findTypeMismatches(visible),
      ...findStaleAccounts(accounts, today),
      ...findCategoryDrift(visible, today),
    ],
  };
}

const localDaySql = dialect.useSqlite ? "DATE(t.date, 'localtime')" : 'DATE(t.date)';
const kindSql = "COALESCE(cd.category_type, t.category_type, CASE WHEN t.price < 0 THEN 'expense' END)";

async function loadRows(start, today) {
  const result = await database.query(`
    SELECT t.identifier, t.vendor, t.name, t.merchant_name, t.date, t.price,
      ${localDaySql} AS day,
      t.category_definition_id AS category_id,
      ${kindSql} AS category_type,
      t.category_type AS stored_type,
      cd.category_type AS category_definition_type,
      cd.name AS category_name, cd.name_en AS category_name_en, cd.name_fr AS category_name_fr,
      COALESCE(cd.is_counted_as_income, 1) AS counted_as_income,
      CASE WHEN COALESCE(cd.name, '') = 'החזר קרן' OR COALESCE(cd.name_en, '') = 'Capital Returns' THEN 1 ELSE 0 END AS capital_return
    FROM transactions t
    LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
    WHERE t.date >= $1 AND t.date < $2 AND ${localDaySql} >= $3 AND ${localDaySql} <= $4
      AND t.status IN ('completed', 'pending')
      AND NOT ${getCreditCardRepaymentCategoryCondition('cd')}
      AND ${dialect.excludePikadon('t')}
      AND NOT EXISTS (SELECT 1 FROM transaction_pairing_exclusions tpe
        WHERE tpe.transaction_identifier = t.identifier AND tpe.transaction_vendor = t.vendor)
  `, [shiftDays(start, -1), shiftDays(today, 2), start, today]);
  return result.rows || [];
}

async function loadCoverageStart(today) {
  const result = await database.query(`
    SELECT t.vendor, MIN(${localDaySql}) AS first_day,
      SUM(CASE WHEN t.date >= $1 THEN 1 ELSE 0 END) AS recent_count
    FROM transactions t
    GROUP BY t.vendor
  `, [shiftDays(today, -90)]);
  return resolveCoverageStart(result.rows || []);
}

async function loadAccounts() {
  try {
    const result = await database.query(`
      SELECT vendor, nickname, last_scrape_success, last_scrape_status
      FROM vendor_credentials
    `);
    return result.rows || [];
  } catch {
    return [];
  }
}

function loadRecurringFilter(rows) {
  if (process.env.NODE_ENV === 'test' && financialTruth === actualFinancialTruth) return () => false;
  const snapshot = financialTruth.getProjectionSnapshot();
  return financialTruth.createRecurringEvidenceFilter(snapshot, rows);
}

function parseOption(value, allowed, fallback, label) {
  if (value == null || value === '') return fallback;
  if (!allowed.includes(value)) throw invalid(`Unsupported ${label}`);
  return value;
}

async function getRhythmComparison(params = {}) {
  const granularity = parseOption(params.granularity, GRANULARITIES, 'month', 'granularity');
  const metric = parseOption(params.metric, METRICS, 'spend', 'metric');
  const scope = parseOption(params.scope, SCOPES, 'all', 'scope');
  const requestedDay = params.today;
  if (requestedDay != null && (typeof requestedDay !== 'string' || !validDate(requestedDay))) {
    throw invalid('Invalid date');
  }
  const today = typeof requestedDay === 'string' ? requestedDay : dateKey();
  const cacheKey = JSON.stringify({ granularity, metric, scope, today });
  const skipCache = process.env.NODE_ENV === 'test' || params.noCache === '1' || params.noCache === true;
  if (!skipCache) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const [rows, coverageStart, accounts] = await Promise.all([
    loadRows(shiftDays(today, -LOOKBACK_DAYS), today),
    loadCoverageStart(today),
    loadAccounts(),
  ]);
  const result = buildRhythmComparison({
    rows, today, granularity, metric, scope, coverageStart, accounts,
    isRecurring: scope === 'everyday' ? loadRecurringFilter(rows) : () => false,
  });
  if (!skipCache) cache.set(cacheKey, result);
  return result;
}

async function repairCategoryTypes() {
  const repaired = await repairTransactionCategoryTypes(database);
  cache.clear();
  if (repaired > 0) clearAllTtlCaches();
  return { repaired };
}

module.exports = {
  getRhythmComparison,
  repairCategoryTypes,
  buildRhythmComparison,
  resolveCoverageStart,
  __setDatabase(db) {
    database = db || actualDatabase;
  },
  __setFinancialTruth(service) {
    financialTruth = service || actualFinancialTruth;
  },
  __resetDependencies() {
    database = actualDatabase;
    financialTruth = actualFinancialTruth;
    cache.clear();
  },
};
module.exports.default = module.exports;
