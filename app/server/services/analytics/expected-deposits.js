'use strict';

/**
 * Expected money that has not arrived: a salary, another regular income, or a
 * regular investment deposit (kupat gemel, savings deposit).
 *
 * Salaries come from the user's payroll rules (household_employment), which
 * name the deposit exactly; other flows come from detected financial patterns.
 * A deposit is only reported missing once the account it lands in has data past
 * the deadline, so a sync that has not caught up never reads as missing money.
 */

const actualDatabase = require('../database.js');
const actualFinancialTruth = require('../financial-truth.js');
const { matchesSalaryDeposit } = require('../payroll/calculator.js');

let database = actualDatabase;
let financialTruth = actualFinancialTruth;

const DAY_MS = 86400000;
const SALARY_LOOKBACK_DAYS = 200;
const SALARY_MIN_MONTHS = 2;
const SALARY_RECENT_MONTHS = 6;
// Paid after the latest day of month seen recently, plus this many days.
const SALARY_GRACE_DAYS = 2;
// A deposit this late in the month, when the salary normally lands in the first
// half, is next month's salary paid early (before a weekend or holiday).
const EARLY_PAYMENT_FROM_DAY = 24;
const PATTERN_GRACE_DAYS = {
  weekly: 2,
  biweekly: 3,
  monthly: 4,
  bimonthly: 5,
  quarterly: 7,
  yearly: 10,
};
const FREQUENCY_DAYS = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  bimonthly: 61,
  quarterly: 91,
  yearly: 365,
};
// Matches the pattern layer: after this many missed cycles a detected flow has
// stopped and is no longer expected.
const MISSED_CYCLES_BEFORE_LAPSE = 2.5;
const MIN_PATTERN_CONFIDENCE = 0.6;

function rowsOf(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

function dateOnly(value) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function toUtc(date) {
  return Date.parse(`${date}T00:00:00Z`);
}

function addDays(date, days) {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

function laterDate(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return left > right ? left : right;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function shiftMonth(month, offset) {
  const [year, monthIndex] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function dayInMonth(month, day) {
  const [year, monthIndex] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/**
 * Salary months for one payroll rule: the month each deposit pays for, its
 * date and amount. Deposits late in the month count toward the next month when
 * the salary normally lands early in the month.
 */
function salaryMonths(employment, deposits) {
  const matched = deposits
    .map((deposit) => ({ ...deposit, day: dateOnly(deposit.date) }))
    .filter((deposit) => deposit.day && matchesSalaryDeposit(employment, deposit));
  if (matched.length === 0) return [];

  const typicalDay = median(matched.map((deposit) => Number(deposit.day.slice(8, 10))));
  const months = new Map();
  matched.forEach((deposit) => {
    const dayOfMonth = Number(deposit.day.slice(8, 10));
    const paidEarly = typicalDay <= 15 && dayOfMonth >= EARLY_PAYMENT_FROM_DAY;
    const month = paidEarly ? shiftMonth(deposit.day.slice(0, 7), 1) : deposit.day.slice(0, 7);
    const existing = months.get(month);
    if (existing) {
      existing.amount += Number(deposit.price) || 0;
      if (deposit.day < existing.date) existing.date = deposit.day;
      return;
    }
    months.set(month, {
      month,
      date: deposit.day,
      dayOfMonth: paidEarly ? 1 : dayOfMonth,
      amount: Number(deposit.price) || 0,
      vendor: deposit.vendor || null,
    });
  });
  return [...months.values()].sort((left, right) => left.month.localeCompare(right.month));
}

function missingSalary(employment, deposits, { today, coverageForVendor }) {
  const months = salaryMonths(employment, deposits);
  if (months.length < SALARY_MIN_MONTHS) return null;

  const recent = months.slice(-SALARY_RECENT_MONTHS);
  const last = months[months.length - 1];
  const expectedMonth = shiftMonth(last.month, 1);
  const typicalDay = Math.round(median(recent.map((month) => month.dayOfMonth)));
  const latestDay = Math.max(...recent.map((month) => month.dayOfMonth));
  const expectedDate = dayInMonth(expectedMonth, typicalDay);
  const deadline = addDays(dayInMonth(expectedMonth, latestDay), SALARY_GRACE_DAYS);
  if (today <= deadline) return null;

  const vendor = employment.salary_match_vendor || last.vendor;
  const coveredThrough = coverageForVendor(vendor);
  if (!coveredThrough || coveredThrough <= deadline) return null;

  return {
    kind: 'salary',
    key: `salary:${employment.id}:${expectedMonth}`,
    name: employment.employer_name || employment.salary_match_pattern,
    searchText: employment.salary_match_pattern,
    member: employment.member || null,
    employmentId: Number(employment.id),
    patternId: null,
    expectedDate,
    deadline,
    daysLate: daysBetween(expectedDate, today),
    expectedAmount: Math.round(median(recent.slice(-3).map((month) => month.amount))),
    lastReceivedDate: last.date,
    vendor,
    coveredThrough,
  };
}

function isUserBacked(pattern) {
  return pattern.source !== 'detected'
    || Boolean(pattern.confirmed)
    || (pattern.corrections || []).some((correction) => correction.action === 'override_pattern');
}

/**
 * Which expected-deposit kind a pattern is, or null when it is not one:
 * regular income (not a salary already covered by a payroll rule), or a
 * regular transfer into an investment category.
 */
function patternKind(pattern, categoryType, employments) {
  if (pattern.direction === 'income' && categoryType === 'income') {
    const isRuleSalary = employments.some((employment) => matchesSalaryDeposit(employment, {
      name: pattern.displayName,
      vendor: pattern.vendor ?? employment.salary_match_vendor,
      account_number: employment.salary_match_account_number,
      price: 1,
    }));
    return isRuleSalary ? null : 'income';
  }
  if (pattern.direction === 'expense' && categoryType === 'investment') return 'investment';
  return null;
}

function isExpectedPattern(pattern, today) {
  if (pattern.state !== 'active' || !pattern.nextExpectedDate) return false;
  const interval = FREQUENCY_DAYS[pattern.frequency];
  if (!interval) return false;
  if (isUserBacked(pattern)) return true;
  if (Number(pattern.confidence) < MIN_PATTERN_CONFIDENCE) return false;
  if (Number(pattern.occurrenceCount) < 3) return false;
  const lastSeen = dateOnly(pattern.lastSeenDate);
  return !lastSeen || daysBetween(lastSeen, today) <= interval * MISSED_CYCLES_BEFORE_LAPSE;
}

function missingPatternDeposit(pattern, kind, { today, coverageForVendor }) {
  const expectedDate = dateOnly(pattern.nextExpectedDate);
  if (!expectedDate) return null;
  const deadline = addDays(expectedDate, PATTERN_GRACE_DAYS[pattern.frequency]);
  if (today <= deadline) return null;

  const coveredThrough = coverageForVendor(pattern.vendor);
  if (!coveredThrough || coveredThrough <= deadline) return null;

  return {
    kind,
    key: `pattern:${pattern.id}:${expectedDate}`,
    name: pattern.displayName,
    searchText: pattern.displayName,
    member: null,
    employmentId: null,
    patternId: Number(pattern.id),
    frequency: pattern.frequency,
    expectedDate,
    deadline,
    daysLate: daysBetween(expectedDate, today),
    expectedAmount: Math.round(Math.abs(Number(pattern.amount) || 0)),
    lastReceivedDate: dateOnly(pattern.lastSeenDate),
    vendor: pattern.vendor || null,
    coveredThrough,
  };
}

/**
 * Pure detection over already-loaded data.
 * @returns {{ missing: object[], trackedPatternIds: Set<number> }}
 *   `trackedPatternIds` are the patterns this detector owns, so other alert
 *   sources (subscription missed charges) can skip them.
 */
function findMissingDeposits({
  today,
  employments = [],
  salaryDeposits = [],
  patterns = [],
  categoryTypes = new Map(),
  vendorCoverage = new Map(),
}) {
  const latestCoverage = [...vendorCoverage.values()].reduce(laterDate, null);
  // A pattern spread over several accounts has no single vendor; the newest
  // data of any account is the best available evidence.
  const coverageForVendor = (vendor) => (vendor ? vendorCoverage.get(vendor) || null : latestCoverage);
  const context = { today, coverageForVendor };

  const missing = [];
  employments.forEach((employment) => {
    const alert = missingSalary(employment, salaryDeposits, context);
    if (alert) missing.push(alert);
  });

  const trackedPatternIds = new Set();
  patterns.forEach((pattern) => {
    const kind = patternKind(pattern, categoryTypes.get(pattern.categoryDefinitionId) || null, employments);
    if (!kind || !isExpectedPattern(pattern, today)) return;
    trackedPatternIds.add(Number(pattern.id));
    const alert = missingPatternDeposit(pattern, kind, context);
    if (alert) missing.push(alert);
  });

  return { missing, trackedPatternIds };
}

function isMissingTableError(error) {
  return /no such table/i.test(String(error?.message || ''));
}

async function loadEmployments() {
  try {
    const result = await database.query(`
      SELECT id, member, employer_name, salary_match_pattern, salary_match_vendor, salary_match_account_number
      FROM household_employment
      WHERE is_active = 1 AND salary_match_pattern IS NOT NULL AND TRIM(salary_match_pattern) <> ''
    `);
    return rowsOf(result);
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

async function loadSalaryDeposits(employments, today) {
  if (employments.length === 0) return [];
  const params = [addDays(today, -SALARY_LOOKBACK_DAYS)];
  const filters = ['substr(date, 1, 10) >= $1', 'price > 0'];
  const vendors = [...new Set(employments.map((employment) => employment.salary_match_vendor))];
  if (vendors.every(Boolean)) {
    filters.push(`vendor IN (${vendors.map((_, index) => `$${index + 2}`).join(', ')})`);
    params.push(...vendors);
  }
  const result = await database.query(`
    SELECT identifier, vendor, account_number, date, name, price
    FROM transactions
    WHERE ${filters.join(' AND ')}
  `, params);
  return rowsOf(result);
}

async function loadCategoryTypes() {
  const result = await database.query('SELECT id, category_type FROM category_definitions');
  return new Map(rowsOf(result).map((row) => [Number(row.id), row.category_type]));
}

/** Latest date each institution has data for: its newest transaction or last successful sync. */
async function loadVendorCoverage(today) {
  const coverage = new Map();
  const transactions = await database.query(`
    SELECT vendor, MAX(date) AS last_date
    FROM transactions
    WHERE date <= $1
    GROUP BY vendor
  `, [`${today}T23:59:59.999Z`]);
  rowsOf(transactions).forEach((row) => {
    if (row.vendor) coverage.set(row.vendor, dateOnly(row.last_date));
  });
  try {
    const syncs = await database.query(`
      SELECT vendor, MAX(last_scrape_success) AS last_date
      FROM vendor_credentials
      WHERE last_scrape_success IS NOT NULL
      GROUP BY vendor
    `);
    rowsOf(syncs).forEach((row) => {
      if (row.vendor) coverage.set(row.vendor, laterDate(coverage.get(row.vendor), dateOnly(row.last_date)));
    });
  } catch {
    // Imported-only ledgers have no credentials; transaction coverage is enough.
  }
  return coverage;
}

function loadPatterns() {
  if (process.env.NODE_ENV === 'test' && financialTruth === actualFinancialTruth) return [];
  return financialTruth.getProjectionSnapshot()?.patterns || [];
}

async function detectMissingDeposits({ today = new Date().toISOString().slice(0, 10) } = {}) {
  const employments = await loadEmployments();
  const [salaryDeposits, categoryTypes, vendorCoverage] = await Promise.all([
    loadSalaryDeposits(employments, today),
    loadCategoryTypes(),
    loadVendorCoverage(today),
  ]);
  return findMissingDeposits({
    today,
    employments,
    salaryDeposits,
    patterns: loadPatterns(),
    categoryTypes,
    vendorCoverage,
  });
}

module.exports = {
  detectMissingDeposits,
  findMissingDeposits,
  __setDatabase(db) {
    database = db || actualDatabase;
  },
  __setFinancialTruth(service) {
    financialTruth = service || actualFinancialTruth;
  },
  __resetDependencies() {
    database = actualDatabase;
    financialTruth = actualFinancialTruth;
  },
  _internal: { salaryMonths },
};
module.exports.default = module.exports;
