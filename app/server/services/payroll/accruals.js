'use strict';

/**
 * Monthly payroll contribution accruals.
 *
 * Pension, severance and keren hishtalmut are deducted from the payslip, so
 * they never appear as bank transactions. For every month a member's salary
 * deposit arrives, each active plan produces one ESTIMATED contribution for
 * its linked investment account. Rows are shaped like linked investment
 * transactions (see investments/linked-transaction-rollforward.js) so the
 * existing roll-forward adds them on top of the last real statement; they are
 * never written to the transactions table, so cash flow and spending
 * analytics cannot double count them.
 *
 * Estimates are only produced for ILS accounts: salaries are in ILS, and an
 * ILS amount can be added to the native balance before any FX conversion.
 */

const { PLAN_KINDS, computePlanContribution, matchesSalaryDeposit } = require('./calculator.js');
const { toIsoDateInTimeZone } = require('../investments/linked-transaction-rollforward.js');

const PAYROLL_ESTIMATE_VENDOR = 'payroll_estimate';
const ACCRUAL_CURRENCY = 'ILS';

const PLAN_NAMES = Object.freeze({
  pension: 'Estimated pension contribution',
  severance: 'Estimated severance contribution',
  keren_hishtalmut: 'Estimated keren hishtalmut contribution',
});

function normalizeIds(accountIds) {
  return Array.isArray(accountIds)
    ? [...new Set(accountIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)))]
    : [];
}

function isUsablePlanRow(row) {
  return Boolean(
    row
    && PLAN_KINDS.includes(row.kind)
    && Number(row.plan_is_active) === 1
    && Number(row.employment_is_active) === 1
    && Number.isFinite(Number(row.account_id))
    && Number(row.gross_monthly) > 0
    && row.salary_match_pattern
    && row.start_date
    && String(row.account_currency || ACCRUAL_CURRENCY).toUpperCase() === ACCRUAL_CURRENCY,
  );
}

async function fetchActivePlans(client, accountIds) {
  const placeholders = accountIds.map((_, index) => `$${index + 1}`).join(', ');
  const result = await client.query(
    `SELECT
       p.id AS plan_id,
       p.kind,
       p.account_id,
       p.employee_pct,
       p.employer_pct,
       p.salary_cap,
       p.start_date,
       p.is_active AS plan_is_active,
       e.id AS employment_id,
       e.member,
       e.gross_monthly,
       e.salary_match_pattern,
       e.salary_match_vendor,
       e.salary_match_account_number,
       e.is_active AS employment_is_active,
       ia.currency AS account_currency
     FROM payroll_contribution_plans p
     JOIN household_employment e ON e.id = p.employment_id
     JOIN investment_accounts ia ON ia.id = p.account_id
     WHERE p.account_id IN (${placeholders})
       AND p.is_active = 1
       AND e.is_active = 1`,
    accountIds,
  );
  return (Array.isArray(result?.rows) ? result.rows : []).filter(isUsablePlanRow);
}

async function fetchSalaryDeposits(client, plans, { startDate, endDate }) {
  const params = [startDate];
  const filters = ['substr(t.date, 1, 10) >= $1', 't.price > 0'];
  if (endDate) {
    params.push(endDate);
    filters.push(`substr(t.date, 1, 10) <= $${params.length}`);
  }
  // Narrow by bank when every salary rule names one.
  const vendors = [...new Set(plans.map((plan) => plan.salary_match_vendor))];
  if (vendors.every(Boolean)) {
    const start = params.length;
    params.push(...vendors);
    filters.push(`t.vendor IN (${vendors.map((_, index) => `$${start + index + 1}`).join(', ')})`);
  }
  const result = await client.query(
    `SELECT t.identifier, t.vendor, t.account_number, t.date, t.transaction_datetime, t.name, t.price
       FROM transactions t
      WHERE ${filters.join(' AND ')}
      ORDER BY t.date ASC, t.identifier ASC`,
    params,
  );
  return Array.isArray(result?.rows) ? result.rows : [];
}

/**
 * First salary deposit of each month for one employment rule.
 * @returns {Map<string, {effectiveDate: string, deposit: object}>} keyed by YYYY-MM
 */
function firstDepositByMonth(employment, deposits) {
  const months = new Map();
  deposits.forEach((deposit) => {
    if (!matchesSalaryDeposit(employment, deposit)) return;
    const effectiveDate = toIsoDateInTimeZone(deposit.transaction_datetime || deposit.date);
    if (!effectiveDate) return;
    const month = effectiveDate.slice(0, 7);
    const existing = months.get(month);
    if (!existing || effectiveDate < existing.effectiveDate) {
      months.set(month, { effectiveDate, deposit });
    }
  });
  return months;
}

/**
 * Pure: estimated contribution rows for the given plans and salary deposits.
 */
function buildAccrualRows(plans, deposits, { endDate = null } = {}) {
  const rows = [];
  const monthsByEmployment = new Map();

  plans.forEach((plan) => {
    if (!isUsablePlanRow(plan)) return;
    if (!monthsByEmployment.has(plan.employment_id)) {
      monthsByEmployment.set(plan.employment_id, firstDepositByMonth(plan, deposits));
    }
    const contribution = computePlanContribution(plan.gross_monthly, plan);
    if (!(contribution.total > 0)) return;

    monthsByEmployment.get(plan.employment_id).forEach(({ effectiveDate, deposit }, month) => {
      if (effectiveDate < plan.start_date) return;
      if (endDate && effectiveDate > endDate) return;
      rows.push({
        account_id: Number(plan.account_id),
        identifier: `payroll:${plan.plan_id}:${month}`,
        vendor: PAYROLL_ESTIMATE_VENDOR,
        date: deposit.date,
        transaction_datetime: deposit.transaction_datetime || null,
        name: PLAN_NAMES[plan.kind],
        memo: null,
        price: -contribution.total,
        original_currency: ACCRUAL_CURRENCY,
        charged_currency: ACCRUAL_CURRENCY,
        is_pikadon_related: 0,
        category_type: 'investment',
        category_name: null,
        category_name_en: null,
        category_name_fr: null,
        is_counted_as_income: 0,
        is_estimated: 1,
        payroll_plan_id: plan.plan_id,
        payroll_kind: plan.kind,
        payroll_member: plan.member,
        payroll_employee_amount: contribution.employee,
        payroll_employer_amount: contribution.employer,
        salary_transaction_identifier: deposit.identifier,
        salary_transaction_vendor: deposit.vendor,
      });
    });
  });

  return rows.sort((left, right) => (
    left.account_id - right.account_id
    || String(left.date).localeCompare(String(right.date))
    || left.identifier.localeCompare(right.identifier)
  ));
}

/**
 * Estimated payroll contribution rows for the given investment accounts.
 * Never throws: a database without the payroll tables (or any lookup
 * failure) simply yields no estimates, so balances fall back to statements.
 */
async function fetchPayrollAccrualRows(client, accountIds = [], options = {}) {
  const ids = normalizeIds(accountIds);
  if (!client || ids.length === 0) return [];
  try {
    const plans = await fetchActivePlans(client, ids);
    if (plans.length === 0) return [];

    const earliestStart = plans.map((plan) => String(plan.start_date).slice(0, 10)).sort()[0];
    const startDate = options.startDate && options.startDate > earliestStart ? options.startDate : earliestStart;
    const endDate = options.endDate || null;
    // One day of slack: the effective (Israel-time) date can be a day after
    // the stored UTC date.
    const queryStart = new Date(Date.parse(`${startDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const deposits = await fetchSalaryDeposits(client, plans, { startDate: queryStart, endDate });
    return buildAccrualRows(plans, deposits, { endDate }).filter((row) => (
      !options.startDate || toIsoDateInTimeZone(row.transaction_datetime || row.date) >= options.startDate
    ));
  } catch (error) {
    if (!/no such table/i.test(String(error?.message))) {
      console.warn('[payroll] accrual lookup failed; showing statement balances only:', error?.message);
    }
    return [];
  }
}

module.exports = {
  PAYROLL_ESTIMATE_VENDOR,
  buildAccrualRows,
  fetchPayrollAccrualRows,
};
module.exports.default = module.exports;
