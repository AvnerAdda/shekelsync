'use strict';

/**
 * Pure payroll-contribution math and salary-deposit matching.
 *
 * Contributions are a percentage of the GROSS salary (the bank only sees the
 * net deposit), optionally capped (the keren hishtalmut tax-exempt salary
 * ceiling). Shared by the settings preview and the monthly accrual engine.
 */

const PLAN_KINDS = Object.freeze(['pension', 'severance', 'keren_hishtalmut']);
const MEMBERS = Object.freeze(['self', 'spouse']);

// 2026 tax-exempt keren hishtalmut salary ceiling for employees (frozen
// through 2027). Users can edit it per plan.
const KEREN_HISHTALMUT_SALARY_CAP = 15712;

const PLAN_DEFAULTS = Object.freeze({
  pension: Object.freeze({ employee_pct: 6, employer_pct: 6.5, salary_cap: null }),
  severance: Object.freeze({ employee_pct: 0, employer_pct: 6, salary_cap: null }),
  keren_hishtalmut: Object.freeze({ employee_pct: 2.5, employer_pct: 7.5, salary_cap: KEREN_HISHTALMUT_SALARY_CAP }),
});

// Investment account types offered first for each plan kind. Every
// long-term savings type stays selectable: users label these funds
// inconsistently (e.g. a keren hishtalmut saved as a provident account).
const PREFERRED_ACCOUNT_TYPES = Object.freeze({
  pension: Object.freeze(['pension']),
  severance: Object.freeze(['pension']),
  keren_hishtalmut: Object.freeze(['provident']),
});
const LONG_TERM_SAVINGS_ACCOUNT_TYPES = Object.freeze(['pension', 'provident', 'study_fund']);

// A keren hishtalmut can be withdrawn tax-free six years after the fund was
// opened (earlier only at retirement age or for qualifying study).
const KEREN_HISHTALMUT_LOCK_YEARS = 6;

/**
 * Tax-free withdrawal date for a keren hishtalmut plan: six years after the
 * fund was opened, falling back to when the plan started.
 * @returns {string|null} YYYY-MM-DD
 */
function kerenHishtalmutWithdrawableFrom(plan) {
  if (!plan || plan.kind !== 'keren_hishtalmut') return null;
  const opened = String(plan.opened_date || plan.start_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opened)) return null;
  const [year, month, day] = opened.split('-').map(Number);
  // Date.UTC rolls 29 Feb into 1 Mar on non-leap target years.
  return new Date(Date.UTC(year + KEREN_HISHTALMUT_LOCK_YEARS, month - 1, day)).toISOString().slice(0, 10);
}

function roundCurrency(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function toNumberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Monthly contribution for one plan.
 * @returns {{ kind, base, employee, employer, total }}
 */
function computePlanContribution(grossMonthly, plan) {
  const gross = Math.max(0, toNumberOrZero(grossMonthly));
  const cap = Number(plan?.salary_cap);
  const base = Number.isFinite(cap) && cap > 0 ? Math.min(gross, cap) : gross;
  const employee = roundCurrency((base * Math.max(0, toNumberOrZero(plan?.employee_pct))) / 100);
  const employer = roundCurrency((base * Math.max(0, toNumberOrZero(plan?.employer_pct))) / 100);
  return {
    kind: plan?.kind ?? null,
    base: roundCurrency(base),
    employee,
    employer,
    total: roundCurrency(employee + employer),
  };
}

/**
 * Monthly contributions for every active plan of one employment.
 */
function computeContributionBreakdown(grossMonthly, plans = []) {
  const activePlans = (Array.isArray(plans) ? plans : [])
    .filter((plan) => plan && Number(plan.is_active ?? 1) === 1);
  const items = activePlans.map((plan) => computePlanContribution(grossMonthly, plan));
  const totals = items.reduce(
    (sum, item) => ({
      employee: sum.employee + item.employee,
      employer: sum.employer + item.employer,
      total: sum.total + item.total,
    }),
    { employee: 0, employer: 0, total: 0 },
  );
  return {
    items,
    totals: {
      employee: roundCurrency(totals.employee),
      employer: roundCurrency(totals.employer),
      total: roundCurrency(totals.total),
    },
  };
}

// Digits and punctuation are dropped on both sides so a deposit named
// "משכורת 10/26" or "מ.ש.כ אינטל" keeps matching month after month.
function normalizeMatchText(value) {
  return `${value ?? ''}`
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\p{N}\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether a bank transaction is this employment's salary deposit.
 * Name must contain the pattern; vendor and account number, when set,
 * must match exactly.
 */
function matchesSalaryDeposit(employment, transaction) {
  if (!employment || !transaction) return false;
  if (!(Number(transaction.price) > 0)) return false;

  const pattern = normalizeMatchText(employment.salary_match_pattern);
  if (!pattern) return false;
  if (!normalizeMatchText(transaction.name).includes(pattern)) return false;

  if (employment.salary_match_vendor && transaction.vendor !== employment.salary_match_vendor) {
    return false;
  }
  if (
    employment.salary_match_account_number
    && `${transaction.account_number ?? ''}` !== `${employment.salary_match_account_number}`
  ) {
    return false;
  }
  return true;
}

module.exports = {
  KEREN_HISHTALMUT_LOCK_YEARS,
  KEREN_HISHTALMUT_SALARY_CAP,
  LONG_TERM_SAVINGS_ACCOUNT_TYPES,
  MEMBERS,
  PLAN_DEFAULTS,
  PLAN_KINDS,
  PREFERRED_ACCOUNT_TYPES,
  computeContributionBreakdown,
  computePlanContribution,
  kerenHishtalmutWithdrawableFrom,
  matchesSalaryDeposit,
  normalizeMatchText,
};
module.exports.default = module.exports;
