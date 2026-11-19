/**
 * "Since you started ShekelSync": compares the months before the first successful sync with
 * the most recent months after it.
 *
 * The comparison is built to be honest rather than flattering:
 * - only full calendar months; the month of the first sync is mixed, so it is left out;
 * - both sides have the same number of months, and "before" months must be fully covered by
 *   the main accounts (the first sync only reaches ~3 months back);
 * - needed spending (essential, stability, growth or fixed categories) is excluded, and the
 *   user can change what counts as needed;
 * - medians, not means, so one unusual month does not decide the result;
 * - a change only counts when it is larger than the usual month-to-month swing, and changes
 *   for the worse are reported the same way as improvements.
 */
const actualDatabase = require('../database.js');
const { dialect } = require('../../../lib/sql-dialect.js');
const { createTtlCache } = require('../../../lib/server/ttl-cache.js');
const { getCreditCardRepaymentCategoryCondition } = require('../accounts/repayment-category.js');
const { autoDetectSpendingCategory } = require('./spending-categories.js');
const { resolveCoverageStart } = require('./rhythm-comparison.js');
const { normalizePatternKey, selectDominantCluster } = require('./recurring-analyzer.js');
const { dateKey, validDate, shiftDays, invalid } = require('../planning-math.js');

let database = actualDatabase;
const cache = createTtlCache({ maxEntries: 10, defaultTtlMs: 60 * 1000 });

const MAX_MONTHS = 6;
const MIN_MONTHS = 2;
// A "before" month still counts when the first transaction of an account lands a few days
// into it (the first sync starts on the 1st, but nothing may have happened that day).
const COVERAGE_TOLERANCE_DAYS = 10;
const RELATIVE_NOISE = 0.05;
const MIN_CHANGE = { controllableSpend: 100, kept: 100, fees: 5 };
const NEEDED_SPENDING_CATEGORIES = new Set(['essential', 'stability', 'growth']);
const FEE_CATEGORY_NAMES = new Set(['עמלות בנק וכרטיס', 'bank & card fees']);
const FEE_NAME_PATTERN = /עמל|commission/i;
const SUBSCRIPTION_MIN_AMOUNT = 10;
const SUBSCRIPTION_MAX_CV = 0.15;
const SUBSCRIPTION_MAX_CHARGES_PER_MONTH = 1.5;
const SUBSCRIPTION_QUIET_MONTHS = 2;
// A cancellation is only credited after a steady run of charges before the first sync.
const SUBSCRIPTION_MIN_CHARGES_STOPPED = 3;
const SUBSCRIPTION_MIN_CHARGES_STARTED = 2;
// One purchase this large (share of typical monthly income) is a one-off, not a habit.
const LARGE_ONE_OFF_SHARE = 0.1;
const LARGE_ONE_OFF_MIN = 1000;
const LARGE_ONE_OFF_LIST = 8;
const UNCATEGORIZED_KEY = 'none';

const round2 = (value) => Math.round(value * 100) / 100;
const sum = (values) => values.reduce((total, value) => total + value, 0);

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

const median = (values) => quantile(values, 0.5);

function addMonths(monthKey, count) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthRange(fromMonth, toMonth) {
  const months = [];
  for (let month = fromMonth; month <= toMonth; month = addMonths(month, 1)) months.push(month);
  return months;
}

function monthEnd(monthKey) {
  return shiftDays(`${addMonths(monthKey, 1)}-01`, -1);
}

function toEpochMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const text = String(value);
  const normalized = /\dT\d|Z$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/** The local calendar day of a stored UTC timestamp. */
function localDayOf(value) {
  const ms = toEpochMs(value);
  return ms === null ? null : dateKey(new Date(ms));
}

/**
 * Before = the N full months just before the first-sync month that the accounts fully cover.
 * After = the N most recent full months after it. N is the smaller side, capped at 6.
 */
function resolveWindows({ frontierDay, today, coverageStart = null }) {
  const frontierMonth = frontierDay.slice(0, 7);
  const lastFullMonth = addMonths(today.slice(0, 7), -1);
  const firstAfter = addMonths(frontierMonth, 1);
  const afterMonths = firstAfter <= lastFullMonth ? monthRange(firstAfter, lastFullMonth) : [];

  const lastBefore = addMonths(frontierMonth, -1);
  const coveredFrom = coverageStart ? shiftDays(String(coverageStart).slice(0, 10), -COVERAGE_TOLERANCE_DAYS) : null;
  const beforeMonths = [];
  for (let month = lastBefore, count = 0; count < MAX_MONTHS; month = addMonths(month, -1), count += 1) {
    if (!coveredFrom || `${month}-01` < coveredFrom) break;
    beforeMonths.unshift(month);
  }

  const n = Math.min(afterMonths.length, beforeMonths.length, MAX_MONTHS);
  const readyOn = `${addMonths(frontierMonth, MIN_MONTHS + 1)}-01`;
  let status = 'ready';
  if (afterMonths.length < MIN_MONTHS) status = 'waiting';
  else if (beforeMonths.length < MIN_MONTHS) status = 'no_history';

  const before = beforeMonths.slice(-n);
  const after = afterMonths.slice(-n);
  return {
    status,
    months: status === 'ready' ? n : 0,
    frontierMonth,
    readyOn: status === 'waiting' ? readyOn : null,
    fullMonthsAfter: afterMonths.length,
    fullMonthsBefore: beforeMonths.length,
    // All covered months before the first sync, used to tell a steady subscription from a one-off.
    historyStart: status === 'ready' ? `${beforeMonths[0]}-01` : null,
    before: status === 'ready' ? { months: before, start: `${before[0]}-01`, end: monthEnd(before.at(-1)) } : null,
    after: status === 'ready' ? { months: after, start: `${after[0]}-01`, end: monthEnd(after.at(-1)) } : null,
  };
}

function parseOverrides(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'boolean'));
  } catch {
    return {};
  }
}

function categoryKeyOf(row) {
  return row.category_id == null ? UNCATEGORIZED_KEY : String(row.category_id);
}

/**
 * Why a category is needed by default, or null when it is spending the user can control.
 * A fixed cost is not needed by itself: a gym or a streaming plan is fixed but still a choice.
 */
function defaultNeededReason(category) {
  let spendingCategory = category.spending_category ?? category.parent_spending_category ?? null;
  if (category.category_id != null && !category.spending_category && !category.parent_spending_category) {
    spendingCategory = autoDetectSpendingCategory(category.category_name, category.category_name_en, category.parent_name, 'expense').spendingCategory;
  }
  return NEEDED_SPENDING_CATEGORIES.has(spendingCategory) ? spendingCategory : null;
}

function isFee(row) {
  const names = [row.category_name, row.category_name_en, row.parent_name, row.parent_name_en]
    .filter(Boolean).map((name) => String(name).trim().toLowerCase());
  if (names.some((name) => FEE_CATEGORY_NAMES.has(name))) return true;
  return FEE_NAME_PATTERN.test(String(row.name || ''));
}

/** Lower is better for spending and fees; higher is better for money kept. */
function compareSides(key, beforeValues, afterValues, direction) {
  const before = median(beforeValues);
  const after = median(afterValues);
  if (before === null || after === null) {
    return { before: null, after: null, delta: null, deltaPercent: null, verdict: 'insufficient' };
  }
  const spread = median(beforeValues.map((value) => Math.abs(value - before)));
  const threshold = Math.max(Math.abs(before) * RELATIVE_NOISE, spread, MIN_CHANGE[key] ?? 0);
  const delta = after - before;
  let verdict = 'unchanged';
  if (Math.abs(delta) > threshold) {
    const improved = direction === 'lower' ? delta < 0 : delta > 0;
    verdict = improved ? 'better' : 'worse';
  }
  return {
    before: round2(before),
    after: round2(after),
    delta: round2(delta),
    deltaPercent: before !== 0 ? Math.round((delta / Math.abs(before)) * 100) : null,
    threshold: round2(threshold),
    verdict,
  };
}

function shareOfIncome(spend, income) {
  return income > 0 ? round2((spend / income) * 100) : null;
}

/** Monthly charges with a steady amount, at most about once a month, in `minMonths` months or more. */
function findRecurring(charges, fromMonth, toMonth, minMonths) {
  const inWindow = charges.filter((charge) => charge.month >= fromMonth && charge.month <= toMonth);
  const distinctMonths = new Set(inWindow.map((charge) => charge.month));
  if (distinctMonths.size < minMonths) return null;
  if (inWindow.length / distinctMonths.size > SUBSCRIPTION_MAX_CHARGES_PER_MONTH) return null;
  const cluster = selectDominantCluster(inWindow.map((charge) => ({ amount: charge.amount, date: charge.day })));
  if (!cluster || cluster.charges.length < 2 || cluster.mean < SUBSCRIPTION_MIN_AMOUNT) return null;
  if (cluster.coefficientOfVariation > SUBSCRIPTION_MAX_CV) return null;
  const clusterMonths = new Set(cluster.charges.map((charge) => charge.date.slice(0, 7)));
  if (clusterMonths.size < minMonths) return null;
  return { monthlyAmount: round2(cluster.mean), lastDay: cluster.latestDate, months: clusterMonths.size };
}

/**
 * Recurring charges in controllable categories that stopped after the first sync, and new
 * ones that started. Needed categories are left out, as are charges as large as a one-off.
 */
function buildSubscriptionChanges(expenseRows, windows, today, maxAmount) {
  const byMerchant = new Map();
  expenseRows.forEach((row) => {
    if (row.amount <= 0 || row.needed || row.amount >= maxAmount) return;
    const key = normalizePatternKey(row.merchant_name || row.name);
    if (!key) return;
    if (!byMerchant.has(key)) byMerchant.set(key, { key, name: row.merchant_name || row.name, charges: [] });
    byMerchant.get(key).charges.push({ day: row.day, month: row.month, amount: row.amount });
  });

  const { frontierMonth } = windows;
  const historyMonth = windows.historyStart.slice(0, 7);
  const afterMonths = windows.after.months;
  const currentMonth = today.slice(0, 7);
  const quietFrom = `${afterMonths.at(-SUBSCRIPTION_QUIET_MONTHS) || afterMonths[0]}-01`;
  const recentFrom = `${afterMonths.at(-1)}-01`;
  const stopped = [];
  const started = [];

  byMerchant.forEach((merchant) => {
    // The first-sync month still counts as "before": a plan cancelled right after syncing ran until then.
    const before = findRecurring(merchant.charges, historyMonth, frontierMonth, SUBSCRIPTION_MIN_CHARGES_STOPPED);
    const after = findRecurring(merchant.charges, addMonths(frontierMonth, 1), currentMonth, SUBSCRIPTION_MIN_CHARGES_STARTED);
    const chargedLately = merchant.charges.some((charge) => charge.day >= quietFrom && charge.day <= today);
    const chargedBefore = merchant.charges.some((charge) => charge.month >= historyMonth && charge.month < frontierMonth);
    // Still running when the user started, and silent for the last two full months since.
    if (before && before.lastDay >= `${addMonths(frontierMonth, -1)}-01` && !chargedLately) {
      stopped.push({ name: merchant.name, monthlyAmount: before.monthlyAmount, yearlyAmount: round2(before.monthlyAmount * 12), lastCharge: before.lastDay });
    }
    if (after && !chargedBefore && after.lastDay >= recentFrom) {
      const firstCharge = merchant.charges.map((charge) => charge.day).filter((day) => day >= `${frontierMonth}-01`).sort()[0];
      started.push({ name: merchant.name, monthlyAmount: after.monthlyAmount, yearlyAmount: round2(after.monthlyAmount * 12), firstCharge });
    }
  });

  const byAmount = (a, b) => b.yearlyAmount - a.yearlyAmount;
  const stoppedYearly = round2(sum(stopped.map((item) => item.yearlyAmount)));
  const startedYearly = round2(sum(started.map((item) => item.yearlyAmount)));
  const net = round2(stoppedYearly - startedYearly);
  let verdict = 'unchanged';
  if (net > 0) verdict = 'better';
  else if (net < 0) verdict = 'worse';
  return {
    stopped: stopped.sort(byAmount),
    started: started.sort(byAmount),
    stoppedYearly,
    startedYearly,
    netYearly: net,
    verdict: stopped.length || started.length ? verdict : 'unchanged',
  };
}

/**
 * Pure builder: rows are transactions already limited to counted ones (no card repayments,
 * pairing duplicates or pikadon) with local `day` and resolved `category_type`.
 */
function buildBeforeAfter({ rows = [], frontierDay, today, coverageStart = null, overrides = {}, frontierSource = null }) {
  if (!frontierDay) {
    return { status: 'no_sync', frontier: null, windows: null, metrics: null, categories: [], monthly: [] };
  }
  const windows = resolveWindows({ frontierDay, today, coverageStart });
  const base = {
    status: windows.status,
    frontier: { day: frontierDay, source: frontierSource },
    windows,
    coverageStart,
  };
  if (windows.status !== 'ready') return { ...base, metrics: null, categories: [], monthly: [] };

  const phaseOf = new Map([
    ...windows.before.months.map((month) => [month, 'before']),
    ...windows.after.months.map((month) => [month, 'after']),
  ]);
  const allMonths = [...phaseOf.keys()];
  const monthly = new Map(allMonths.map((month) => [month, {
    month, phase: phaseOf.get(month), income: 0, spend: 0, controllableSpend: 0, largeOneOffs: 0, neededSpend: 0, invested: 0, fees: 0,
  }]));
  const categories = new Map();
  const expenseRows = [];

  const parsed = rows.map((row) => {
    const day = row.day ? String(row.day).slice(0, 10) : null;
    const price = Number(row.price);
    if (!day || !Number.isFinite(price) || price === 0) return null;
    return { row, day, month: day.slice(0, 7), price, type: row.category_type };
  }).filter(Boolean);

  parsed.forEach(({ row, month, price, type }) => {
    const bucket = monthly.get(month);
    if (bucket && type === 'income' && Number(row.counted_as_income) && !Number(row.capital_return)) bucket.income += price;
  });
  const typicalIncome = median(allMonths.map((month) => monthly.get(month).income)) || 0;
  const largeThreshold = round2(Math.max(LARGE_ONE_OFF_MIN, typicalIncome * LARGE_ONE_OFF_SHARE));
  const largeOneOffs = [];

  const categoryOf = (row) => {
    const key = categoryKeyOf(row);
    if (!categories.has(key)) {
      const reason = row.category_id == null ? null : defaultNeededReason(row);
      categories.set(key, {
        key,
        categoryId: row.category_id == null ? null : Number(row.category_id),
        name: row.category_name || null,
        nameEn: row.category_name_en || null,
        nameFr: row.category_name_fr || null,
        defaultReason: reason,
        defaultNeeded: reason !== null,
        before: 0,
        after: 0,
      });
    }
    const category = categories.get(key);
    return { category, needed: typeof overrides[key] === 'boolean' ? overrides[key] : category.defaultNeeded };
  };

  parsed.forEach(({ row, day, month, price, type }) => {
    if (type === 'investment') {
      const bucket = monthly.get(month);
      if (bucket) bucket.invested -= price;
      return;
    }
    if (type !== 'expense') return;

    // Refunds in a spending category reduce spending.
    const amount = -price;
    const { category, needed } = categoryOf(row);
    expenseRows.push({ ...row, day, month, amount, needed });
    const bucket = monthly.get(month);
    if (!bucket) return;
    category[bucket.phase] += amount;

    bucket.spend += amount;
    if (needed) {
      bucket.neededSpend += amount;
    } else if (amount >= largeThreshold) {
      bucket.largeOneOffs += amount;
      largeOneOffs.push({
        day, phase: bucket.phase, name: row.merchant_name || row.name || null, amount: round2(amount),
        categoryId: category.categoryId, categoryName: category.name, categoryNameEn: category.nameEn, categoryNameFr: category.nameFr,
      });
    } else {
      bucket.controllableSpend += amount;
    }
    if (isFee(row)) bucket.fees += amount;
  });

  const months = allMonths.map((month) => {
    const bucket = monthly.get(month);
    const kept = bucket.income - bucket.spend;
    return {
      ...Object.fromEntries(Object.entries(bucket).map(([key, value]) => [key, typeof value === 'number' ? round2(value) : value])),
      kept: round2(kept),
      keptRate: bucket.income > 0 ? round2((kept / bucket.income) * 100) : null,
      controllableShare: shareOfIncome(bucket.controllableSpend, bucket.income),
    };
  });
  const side = (phase, field) => months.filter((month) => month.phase === phase).map((month) => month[field]);
  const medianOrNull = (values) => {
    const value = median(values.filter((entry) => entry !== null));
    return value === null ? null : round2(value);
  };

  const controllableSpend = {
    ...compareSides('controllableSpend', side('before', 'controllableSpend'), side('after', 'controllableSpend'), 'lower'),
    shareBefore: medianOrNull(side('before', 'controllableShare')),
    shareAfter: medianOrNull(side('after', 'controllableShare')),
    // Left out of the comparison above and shown on their own, so one purchase cannot decide it.
    largeOneOffs: {
      threshold: largeThreshold,
      beforeTotal: round2(sum(side('before', 'largeOneOffs'))),
      afterTotal: round2(sum(side('after', 'largeOneOffs'))),
      beforeCount: largeOneOffs.filter((item) => item.phase === 'before').length,
      afterCount: largeOneOffs.filter((item) => item.phase === 'after').length,
      items: [...largeOneOffs].sort((a, b) => b.amount - a.amount).slice(0, LARGE_ONE_OFF_LIST),
    },
  };
  const kept = {
    ...compareSides('kept', side('before', 'kept'), side('after', 'kept'), 'higher'),
    rateBefore: medianOrNull(side('before', 'keptRate')),
    rateAfter: medianOrNull(side('after', 'keptRate')),
  };
  const fees = compareSides('fees', side('before', 'fees'), side('after', 'fees'), 'lower');
  const income = compareSides('kept', side('before', 'income'), side('after', 'income'), 'higher');

  const categoryList = [...categories.values()]
    .map(({ before: beforeTotal, after: afterTotal, ...category }) => ({
      ...category,
      needed: typeof overrides[category.key] === 'boolean' ? overrides[category.key] : category.defaultNeeded,
      overridden: typeof overrides[category.key] === 'boolean' && overrides[category.key] !== category.defaultNeeded,
      beforeMonthly: round2(beforeTotal / windows.months),
      afterMonthly: round2(afterTotal / windows.months),
    }))
    .sort((a, b) => (b.beforeMonthly + b.afterMonthly) - (a.beforeMonthly + a.afterMonthly));

  return {
    ...base,
    metrics: {
      controllableSpend,
      subscriptions: buildSubscriptionChanges(expenseRows, windows, today, largeThreshold),
      kept,
      fees,
      // Context only: a raise or a pay cut changes what the other numbers mean.
      income: { before: income.before, after: income.after, delta: income.delta, deltaPercent: income.deltaPercent },
    },
    categories: categoryList,
    monthly: months,
  };
}

const localDaySql = dialect.useSqlite ? "DATE(t.date, 'localtime')" : 'DATE(t.date)';
const kindSql = "COALESCE(cd.category_type, t.category_type, CASE WHEN t.price < 0 THEN 'expense' END)";

async function loadRows(start, end) {
  const result = await database.query(`
    SELECT t.identifier, t.vendor, t.name, t.merchant_name, t.price,
      ${localDaySql} AS day,
      t.category_definition_id AS category_id,
      ${kindSql} AS category_type,
      cd.name AS category_name, cd.name_en AS category_name_en, cd.name_fr AS category_name_fr,
      parent.name AS parent_name, parent.name_en AS parent_name_en,
      scm.spending_category, pscm.spending_category AS parent_spending_category,
      COALESCE(cd.is_counted_as_income, 1) AS counted_as_income,
      CASE WHEN COALESCE(cd.name, '') = 'החזר קרן' OR COALESCE(cd.name_en, '') = 'Capital Returns' THEN 1 ELSE 0 END AS capital_return
    FROM transactions t
    LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
    LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
    LEFT JOIN spending_category_mappings scm ON scm.category_definition_id = cd.id
    LEFT JOIN spending_category_mappings pscm ON pscm.category_definition_id = parent.id
    WHERE t.date >= $1 AND t.date < $2 AND ${localDaySql} >= $3 AND ${localDaySql} <= $4
      AND t.status IN ('completed', 'pending')
      AND NOT ${getCreditCardRepaymentCategoryCondition('cd')}
      AND ${dialect.excludePikadon('t')}
      AND NOT EXISTS (SELECT 1 FROM transaction_pairing_exclusions tpe
        WHERE tpe.transaction_identifier = t.identifier AND tpe.transaction_vendor = t.vendor)
  `, [shiftDays(start, -1), shiftDays(end, 2), start, end]);
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

async function optionalFirst(sql) {
  try {
    const result = await database.query(sql);
    return result.rows?.[0] || null;
  } catch {
    return null;
  }
}

async function loadSettings() {
  return (await optionalFirst('SELECT first_sync_at, category_overrides FROM before_after_settings WHERE id = 1')) || {};
}

async function saveSettings(fields) {
  const current = await loadSettings();
  const next = { first_sync_at: current.first_sync_at ?? null, category_overrides: current.category_overrides ?? null, ...fields };
  await database.query(`
    INSERT INTO before_after_settings (id, first_sync_at, category_overrides, updated_at)
    VALUES (1, $1, $2, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      first_sync_at = excluded.first_sync_at,
      category_overrides = excluded.category_overrides,
      updated_at = excluded.updated_at
  `, [next.first_sync_at, next.category_overrides]);
}

/**
 * The first successful sync. It is saved the first time it is seen, because deleting an
 * account also deletes its sync history; a later recomputation can only move it earlier.
 */
async function resolveFrontier(settings) {
  const firstSuccess = (await database.query("SELECT MIN(created_at) AS earliest FROM scrape_events WHERE status = 'success'")).rows?.[0];
  const storedMs = toEpochMs(settings.first_sync_at);
  const successMs = toEpochMs(firstSuccess?.earliest);

  if (successMs !== null && (storedMs === null || successMs < storedMs)) {
    try {
      await saveSettings({ first_sync_at: new Date(successMs).toISOString() });
    } catch {
      // Older schema without the settings table: still answer, just do not persist.
    }
    return { day: localDayOf(successMs), source: 'sync' };
  }
  if (storedMs !== null) return { day: localDayOf(storedMs), source: 'saved' };

  // No successful sync on record (history deleted, or imported data): fall back to the install date.
  const license = await optionalFirst('SELECT installation_date AS earliest FROM license WHERE id = 1');
  const installDay = localDayOf(license?.earliest);
  return installDay ? { day: installDay, source: 'install' } : { day: null, source: null };
}

async function getBeforeAfter(params = {}) {
  const requestedDay = params.today;
  if (requestedDay != null && (typeof requestedDay !== 'string' || !validDate(requestedDay))) {
    throw invalid('Invalid date');
  }
  const today = typeof requestedDay === 'string' ? requestedDay : dateKey();
  const skipCache = process.env.NODE_ENV === 'test' || params.noCache === '1' || params.noCache === true;
  if (!skipCache) {
    const cached = cache.get(today);
    if (cached) return cached;
  }

  const settings = await loadSettings();
  const overrides = parseOverrides(settings.category_overrides);
  const frontier = await resolveFrontier(settings);
  let result;
  if (!frontier.day) {
    result = buildBeforeAfter({ today });
  } else {
    const coverageStart = await loadCoverageStart(today);
    const windows = resolveWindows({ frontierDay: frontier.day, today, coverageStart });
    const rows = windows.status === 'ready' ? await loadRows(windows.historyStart, today) : [];
    result = buildBeforeAfter({ rows, frontierDay: frontier.day, frontierSource: frontier.source, today, coverageStart, overrides });
  }
  if (!skipCache) cache.set(today, result);
  return result;
}

async function updateCategoryOverrides(body = {}) {
  const input = body.overrides;
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw invalid('overrides must be an object of category key to boolean');
  }
  const overrides = {};
  Object.entries(input).forEach(([key, value]) => {
    if (key !== UNCATEGORIZED_KEY && !/^\d+$/.test(key)) throw invalid('Invalid category key');
    if (typeof value !== 'boolean') throw invalid('Override values must be booleans');
    overrides[key] = value;
  });
  await saveSettings({ category_overrides: Object.keys(overrides).length ? JSON.stringify(overrides) : null });
  cache.clear();
  return { overrides };
}

module.exports = {
  getBeforeAfter,
  updateCategoryOverrides,
  buildBeforeAfter,
  resolveWindows,
  __setDatabase(db) {
    database = db || actualDatabase;
    cache.clear();
  },
  __resetDependencies() {
    database = actualDatabase;
    cache.clear();
  },
};
module.exports.default = module.exports;
