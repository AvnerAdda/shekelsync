'use strict';

/**
 * Household employment + payroll contribution plans (pension, severance,
 * keren hishtalmut) for each household member, and salary-deposit
 * candidates used to tell the app which bank deposit is whose salary.
 */

const actualDatabase = require('../database.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');
const { PAYROLL_INDEX_STATEMENTS, PAYROLL_TABLE_STATEMENTS } = require('./schema.js');
const {
  LONG_TERM_SAVINGS_ACCOUNT_TYPES,
  MEMBERS,
  PLAN_DEFAULTS,
  PLAN_KINDS,
  PREFERRED_ACCOUNT_TYPES,
  computeContributionBreakdown,
  kerenHishtalmutWithdrawableFrom,
  matchesSalaryDeposit,
  normalizeMatchText,
} = require('./calculator.js');

const SALARY_KEYWORDS = ['salary', 'salaire', 'משכורת', 'שכר'];
const CANDIDATE_WINDOW_MONTHS = 6;
const CANDIDATE_MIN_AMOUNT = 1000;
const CANDIDATE_LIMIT = 12;
const MAX_GROSS_MONTHLY = 10_000_000;
const MAX_TEXT_LENGTH = 200;

let database = actualDatabase;
let now = () => new Date();
let schemaPromise = null;

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      for (const statement of PAYROLL_TABLE_STATEMENTS) await database.query(statement);
      for (const statement of PAYROLL_INDEX_STATEMENTS) await database.query(statement);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

async function withTransaction(run) {
  const client = typeof database.getClient === 'function'
    ? await database.getClient()
    : { query: (...args) => database.query(...args), release: () => {} };
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original error.
    }
    throw error;
  } finally {
    client.release?.();
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function assertMember(member) {
  if (!MEMBERS.includes(member)) {
    throw serviceError(400, `member must be one of: ${MEMBERS.join(', ')}`);
  }
  return member;
}

function optionalText(value, field) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > MAX_TEXT_LENGTH) {
    throw serviceError(400, `${field} must be at most ${MAX_TEXT_LENGTH} characters`);
  }
  return text;
}

function optionalNumber(value, field, { min, max, exclusiveMin = false }) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  const belowMin = exclusiveMin ? parsed <= min : parsed < min;
  if (!Number.isFinite(parsed) || belowMin || parsed > max) {
    throw serviceError(400, `${field} must be a number between ${min} and ${max}`);
  }
  return parsed;
}

function optionalDate(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const date = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw serviceError(400, `${field} must be a YYYY-MM-DD date`);
  }
  return date;
}

function toFlag(value, fallback = 1) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

function todayIso() {
  return now().toISOString().slice(0, 10);
}

function normalizeEmploymentPayload(payload = {}) {
  return {
    employer_name: optionalText(payload.employer_name, 'employer_name'),
    gross_monthly: optionalNumber(payload.gross_monthly, 'gross_monthly', { min: 0, max: MAX_GROSS_MONTHLY }),
    salary_match_pattern: optionalText(payload.salary_match_pattern, 'salary_match_pattern'),
    salary_match_vendor: optionalText(payload.salary_match_vendor, 'salary_match_vendor'),
    salary_match_account_number: optionalText(payload.salary_match_account_number, 'salary_match_account_number'),
    is_active: toFlag(payload.is_active, 1),
  };
}

function normalizePlanPayload(plan = {}) {
  const kind = plan.kind;
  if (!PLAN_KINDS.includes(kind)) {
    throw serviceError(400, `plan kind must be one of: ${PLAN_KINDS.join(', ')}`);
  }
  const defaults = PLAN_DEFAULTS[kind];
  const pct = (value, field, fallback) => {
    const parsed = optionalNumber(value, `${kind}.${field}`, { min: 0, max: 100 });
    return parsed === null ? fallback : parsed;
  };
  const accountId = optionalNumber(plan.account_id, `${kind}.account_id`, { min: 0, max: Number.MAX_SAFE_INTEGER, exclusiveMin: true });
  return {
    kind,
    account_id: accountId === null ? null : Math.trunc(accountId),
    employee_pct: pct(plan.employee_pct, 'employee_pct', defaults.employee_pct),
    employer_pct: pct(plan.employer_pct, 'employer_pct', defaults.employer_pct),
    salary_cap: plan.salary_cap === undefined
      ? defaults.salary_cap
      : optionalNumber(plan.salary_cap, `${kind}.salary_cap`, { min: 0, max: MAX_GROSS_MONTHLY, exclusiveMin: true }),
    start_date: optionalDate(plan.start_date, `${kind}.start_date`),
    opened_date: kind === 'keren_hishtalmut' ? optionalDate(plan.opened_date, `${kind}.opened_date`) : null,
    is_active: toFlag(plan.is_active, 1),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function presentPlan(row) {
  const withdrawableFrom = kerenHishtalmutWithdrawableFrom(row);
  return {
    id: row.id,
    kind: row.kind,
    account_id: row.account_id ?? null,
    employee_pct: Number(row.employee_pct) || 0,
    employer_pct: Number(row.employer_pct) || 0,
    salary_cap: row.salary_cap === null || row.salary_cap === undefined ? null : Number(row.salary_cap),
    start_date: row.start_date ?? null,
    opened_date: row.opened_date ?? null,
    is_active: Number(row.is_active) === 1 ? 1 : 0,
    withdrawable_from: withdrawableFrom,
    is_withdrawable: withdrawableFrom ? withdrawableFrom <= todayIso() : null,
  };
}

function presentEmployment(row) {
  if (!row) return null;
  return {
    id: row.id,
    member: row.member,
    employer_name: row.employer_name ?? null,
    gross_monthly: row.gross_monthly === null || row.gross_monthly === undefined ? null : Number(row.gross_monthly),
    salary_match_pattern: row.salary_match_pattern ?? null,
    salary_match_vendor: row.salary_match_vendor ?? null,
    salary_match_account_number: row.salary_match_account_number ?? null,
    is_active: Number(row.is_active) === 1 ? 1 : 0,
    updated_at: row.updated_at ?? null,
  };
}

async function fetchHousehold(client) {
  const profile = (await client.query('SELECT id, username, marital_status FROM user_profile LIMIT 1')).rows[0] || null;
  const spouse = profile?.id
    ? ((await client.query('SELECT name FROM spouse_profile WHERE user_profile_id = $1 LIMIT 1', [profile.id])).rows[0] || null)
    : null;
  return {
    self: { displayName: profile?.username || null, available: true },
    spouse: {
      displayName: spouse?.name || null,
      available: profile?.marital_status === 'Married',
    },
  };
}

async function fetchEligibleAccounts(client) {
  const placeholders = LONG_TERM_SAVINGS_ACCOUNT_TYPES.map((_, index) => `$${index + 1}`).join(', ');
  const result = await client.query(
    `SELECT id, account_name, account_type, institution
       FROM investment_accounts
      WHERE is_active = 1 AND account_type IN (${placeholders})
      ORDER BY account_name COLLATE NOCASE ASC, id ASC`,
    [...LONG_TERM_SAVINGS_ACCOUNT_TYPES],
  );
  return (result.rows || []).map((row) => ({
    id: row.id,
    account_name: row.account_name,
    account_type: row.account_type,
    institution: row.institution ?? null,
  }));
}

async function fetchEmployments(client) {
  const employments = (await client.query('SELECT * FROM household_employment ORDER BY id ASC')).rows || [];
  const plans = (await client.query('SELECT * FROM payroll_contribution_plans ORDER BY id ASC')).rows || [];
  return employments.map((row) => ({
    employment: presentEmployment(row),
    plans: plans.filter((plan) => plan.employment_id === row.id).map(presentPlan),
  }));
}

function buildMemberView(member, household, stored) {
  const employment = stored?.employment ?? null;
  const plans = stored?.plans ?? [];
  return {
    member,
    displayName: household[member].displayName,
    available: household[member].available,
    employment,
    plans,
    breakdown: computeContributionBreakdown(employment?.is_active ? employment.gross_monthly : 0, plans),
  };
}

async function getPayrollSetup() {
  await ensureSchema();
  const household = await fetchHousehold(database);
  const stored = await fetchEmployments(database);
  const accounts = await fetchEligibleAccounts(database);
  return {
    members: MEMBERS.map((member) => buildMemberView(
      member,
      household,
      stored.find((entry) => entry.employment.member === member),
    )),
    accounts,
    defaults: {
      plans: PLAN_DEFAULTS,
      preferredAccountTypes: PREFERRED_ACCOUNT_TYPES,
    },
  };
}

async function getMemberSetup(member) {
  const setup = await getPayrollSetup();
  return setup.members.find((entry) => entry.member === member);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function assertAccountsExist(client, plans) {
  const ids = [...new Set(plans.map((plan) => plan.account_id).filter((id) => id !== null))];
  if (ids.length === 0) return;
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
  const found = (await client.query(
    `SELECT id, account_type FROM investment_accounts WHERE id IN (${placeholders})`,
    ids,
  )).rows;
  const missing = ids.filter((id) => !found.some((row) => Number(row.id) === id));
  if (missing.length > 0) {
    throw serviceError(400, `Unknown investment account: ${missing.join(', ')}`);
  }
  const ineligible = found.filter((row) => !LONG_TERM_SAVINGS_ACCOUNT_TYPES.includes(row.account_type));
  if (ineligible.length > 0) {
    throw serviceError(400, `Account ${ineligible.map((row) => row.id).join(', ')} is not a pension or savings fund account`);
  }
}

async function saveEmployment(member, payload = {}) {
  assertMember(member);
  await ensureSchema();
  const employment = normalizeEmploymentPayload(payload);
  const rawPlans = Array.isArray(payload.plans) ? payload.plans : [];
  const plans = rawPlans.map(normalizePlanPayload);
  const kinds = plans.map((plan) => plan.kind);
  if (new Set(kinds).size !== kinds.length) {
    throw serviceError(400, 'Each plan kind may appear only once');
  }

  await withTransaction(async (client) => {
    await assertAccountsExist(client, plans);

    const existing = (await client.query(
      'SELECT id FROM household_employment WHERE member = $1',
      [member],
    )).rows[0];

    let employmentId;
    const values = [
      employment.employer_name,
      employment.gross_monthly,
      employment.salary_match_pattern,
      employment.salary_match_vendor,
      employment.salary_match_account_number,
      employment.is_active,
    ];
    if (existing) {
      employmentId = existing.id;
      await client.query(
        `UPDATE household_employment
            SET employer_name = $1, gross_monthly = $2, salary_match_pattern = $3,
                salary_match_vendor = $4, salary_match_account_number = $5, is_active = $6,
                updated_at = datetime('now')
          WHERE id = $7`,
        [...values, employmentId],
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO household_employment (
           member, employer_name, gross_monthly, salary_match_pattern,
           salary_match_vendor, salary_match_account_number, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [member, ...values],
      );
      employmentId = inserted.rows[0].id;
    }

    const existingPlans = (await client.query(
      'SELECT id, kind, start_date FROM payroll_contribution_plans WHERE employment_id = $1',
      [employmentId],
    )).rows || [];

    for (const plan of plans) {
      const current = existingPlans.find((row) => row.kind === plan.kind);
      // Accrual starts when the plan is first switched on unless the user
      // says otherwise; later saves keep the original start.
      const startDate = plan.start_date
        ?? current?.start_date
        ?? (plan.is_active ? todayIso() : null);
      const planValues = [
        plan.account_id,
        plan.employee_pct,
        plan.employer_pct,
        plan.salary_cap,
        startDate,
        plan.is_active,
        plan.opened_date,
      ];
      if (current) {
        await client.query(
          `UPDATE payroll_contribution_plans
              SET account_id = $1, employee_pct = $2, employer_pct = $3, salary_cap = $4,
                  start_date = $5, is_active = $6, opened_date = $7, updated_at = datetime('now')
            WHERE id = $8`,
          [...planValues, current.id],
        );
      } else {
        await client.query(
          `INSERT INTO payroll_contribution_plans (
             account_id, employee_pct, employer_pct, salary_cap, start_date, is_active,
             opened_date, employment_id, kind
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [...planValues, employmentId, plan.kind],
        );
      }
    }
  });

  return getMemberSetup(member);
}

async function deleteEmployment(member) {
  assertMember(member);
  await ensureSchema();
  await withTransaction(async (client) => {
    const existing = (await client.query(
      'SELECT id FROM household_employment WHERE member = $1',
      [member],
    )).rows[0];
    if (!existing) return;
    await client.query('DELETE FROM payroll_contribution_plans WHERE employment_id = $1', [existing.id]);
    await client.query('DELETE FROM household_employment WHERE id = $1', [existing.id]);
  });
  return getMemberSetup(member);
}

// ---------------------------------------------------------------------------
// Salary deposit candidates
// ---------------------------------------------------------------------------

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function looksLikeSalary(row) {
  const haystack = [
    row.name,
    row.category_name,
    row.category_name_en,
    row.parent_category_name,
    row.parent_category_name_en,
  ].map(normalizeMatchText).join(' ');
  return SALARY_KEYWORDS.some((keyword) => haystack.includes(normalizeMatchText(keyword)));
}

// Six calendar months including the current one.
function candidateWindowStart(reference) {
  return new Date(Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth() - (CANDIDATE_WINDOW_MONTHS - 1),
    1,
  )).toISOString().slice(0, 10);
}

/**
 * Recurring incoming deposits from the last six months, grouped by
 * (vendor, account, normalized name), most salary-like first. Each candidate
 * carries the match rule to store and which member already claims it.
 */
async function getSalaryCandidates() {
  await ensureSchema();
  const result = await database.query(
    `SELECT
       t.identifier,
       t.vendor,
       t.vendor_nickname,
       t.account_number,
       t.date,
       t.name,
       t.price,
       COALESCE(cd.name, '') AS category_name,
       COALESCE(cd.name_en, '') AS category_name_en,
       COALESCE(parent_cd.name, '') AS parent_category_name,
       COALESCE(parent_cd.name_en, '') AS parent_category_name_en
     FROM transactions t
     LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
     LEFT JOIN category_definitions parent_cd ON parent_cd.id = cd.parent_id
     WHERE substr(t.date, 1, 10) >= $1
       AND t.price >= $2
       AND (
         (cd.category_type = 'income' AND COALESCE(cd.is_counted_as_income, 1) = 1)
         OR cd.category_type IS NULL
         OR COALESCE(cd.name, '') = $3
       )
     ORDER BY t.date ASC`,
    [candidateWindowStart(now()), CANDIDATE_MIN_AMOUNT, BANK_CATEGORY_NAME],
  );

  const groups = new Map();
  for (const row of result.rows || []) {
    const pattern = normalizeMatchText(row.name);
    if (!pattern) continue;
    const key = `${row.vendor}|${row.account_number ?? ''}|${pattern}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: row.name,
        pattern,
        vendor: row.vendor,
        vendorNickname: row.vendor_nickname ?? null,
        accountNumber: row.account_number ?? null,
        amounts: [],
        months: new Set(),
        lastDate: null,
        salaryLike: false,
      });
    }
    const group = groups.get(key);
    group.name = row.name;
    group.amounts.push(Number(row.price) || 0);
    group.months.add(String(row.date).slice(0, 7));
    group.lastDate = String(row.date).slice(0, 10);
    group.salaryLike = group.salaryLike || looksLikeSalary(row);
  }

  const employments = (await fetchEmployments(database))
    .map((entry) => entry.employment)
    .filter((employment) => employment.salary_match_pattern);

  return {
    candidates: [...groups.values()]
      .filter((group) => group.salaryLike || group.months.size >= 2)
      .map((group) => {
        const sample = {
          name: group.name,
          price: 1,
          vendor: group.vendor,
          account_number: group.accountNumber,
        };
        const claimedBy = employments.find((employment) => matchesSalaryDeposit(employment, sample))?.member ?? null;
        return {
          key: group.key,
          name: group.name,
          vendor: group.vendor,
          vendorNickname: group.vendorNickname,
          accountNumber: group.accountNumber,
          match: {
            salary_match_pattern: group.pattern,
            salary_match_vendor: group.vendor,
            salary_match_account_number: group.accountNumber,
          },
          monthCount: group.months.size,
          depositCount: group.amounts.length,
          medianAmount: Math.round(median(group.amounts)),
          lastDate: group.lastDate,
          looksLikeSalary: group.salaryLike,
          claimedBy,
        };
      })
      .sort((left, right) => (
        Number(right.looksLikeSalary) - Number(left.looksLikeSalary)
        || right.monthCount - left.monthCount
        || right.medianAmount - left.medianAmount
      ))
      .slice(0, CANDIDATE_LIMIT),
  };
}

module.exports = {
  deleteEmployment,
  ensureSchema,
  getPayrollSetup,
  getSalaryCandidates,
  saveEmployment,
  __setDependencies(overrides = {}) {
    if (overrides.database) database = overrides.database;
    if (overrides.now) now = overrides.now;
    schemaPromise = null;
  },
  __resetDependencies() {
    database = actualDatabase;
    now = () => new Date();
    schemaPromise = null;
  },
};
module.exports.default = module.exports;
