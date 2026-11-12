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

const {
  PLAN_KINDS,
  computePlanContribution,
  kerenHishtalmutWithdrawableFrom,
  matchesSalaryDeposit,
} = require('./calculator.js');
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

function isUsablePlanRow(row, { requireAccount = true } = {}) {
  const hasAccount = row?.account_id !== null && row?.account_id !== undefined
    && Number.isFinite(Number(row.account_id));
  return Boolean(
    row
    && PLAN_KINDS.includes(row.kind)
    && Number(row.plan_is_active) === 1
    && Number(row.employment_is_active) === 1
    && (hasAccount || !requireAccount)
    && Number(row.gross_monthly) > 0
    && row.salary_match_pattern
    && row.start_date
    && String(row.account_currency || ACCRUAL_CURRENCY).toUpperCase() === ACCRUAL_CURRENCY,
  );
}

/**
 * @param {number[]|null} accountIds plans linked to these accounts, or every
 *   active plan (linked or not) when null.
 */
async function fetchActivePlans(client, accountIds) {
  const allPlans = accountIds === null;
  const placeholders = allPlans ? '' : accountIds.map((_, index) => `$${index + 1}`).join(', ');
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
     ${allPlans ? 'LEFT JOIN' : 'JOIN'} investment_accounts ia ON ia.id = p.account_id
     WHERE ${allPlans ? '1 = 1' : `p.account_id IN (${placeholders})`}
       AND p.is_active = 1
       AND e.is_active = 1`,
    allPlans ? [] : accountIds,
  );
  return (Array.isArray(result?.rows) ? result.rows : [])
    .filter((row) => isUsablePlanRow(row, { requireAccount: !allPlans }));
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
function buildAccrualRows(plans, deposits, { endDate = null, requireAccount = true } = {}) {
  const rows = [];
  const monthsByEmployment = new Map();

  plans.forEach((plan) => {
    if (!isUsablePlanRow(plan, { requireAccount })) return;
    if (!monthsByEmployment.has(plan.employment_id)) {
      monthsByEmployment.set(plan.employment_id, firstDepositByMonth(plan, deposits));
    }
    const contribution = computePlanContribution(plan.gross_monthly, plan);
    if (!(contribution.total > 0)) return;

    monthsByEmployment.get(plan.employment_id).forEach(({ effectiveDate, deposit }, month) => {
      if (effectiveDate < plan.start_date) return;
      if (endDate && effectiveDate > endDate) return;
      rows.push({
        account_id: plan.account_id === null || plan.account_id === undefined ? null : Number(plan.account_id),
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
    (left.account_id ?? 0) - (right.account_id ?? 0)
    || String(left.date).localeCompare(String(right.date))
    || left.identifier.localeCompare(right.identifier)
  ));
}

/**
 * Estimated payroll contribution rows for the given investment accounts.
 * Never throws: a database without the payroll tables (or any lookup
 * failure) simply yields no estimates, so balances fall back to statements.
 */
function isMissingTableError(error) {
  return /no such table/i.test(String(error?.message));
}

async function accrueForPlans(client, plans, options = {}, { requireAccount = true } = {}) {
  if (plans.length === 0) return [];
  const earliestStart = plans.map((plan) => String(plan.start_date).slice(0, 10)).sort()[0];
  const startDate = options.startDate && options.startDate > earliestStart ? options.startDate : earliestStart;
  const endDate = options.endDate || null;
  // Read from the start of the month (minus a day: the Israel-time effective
  // date can be a day after the stored UTC date) so "first salary of the
  // month" is decided on the whole month even when the range starts mid-month.
  const queryStart = new Date(Date.parse(`${startDate.slice(0, 7)}-01T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const deposits = await fetchSalaryDeposits(client, plans, { startDate: queryStart, endDate });
  return buildAccrualRows(plans, deposits, { endDate, requireAccount }).filter((row) => (
    !options.startDate || toIsoDateInTimeZone(row.transaction_datetime || row.date) >= options.startDate
  ));
}

async function fetchPayrollAccrualRows(client, accountIds = [], options = {}) {
  const ids = normalizeIds(accountIds);
  if (!client || ids.length === 0) return [];
  try {
    return await accrueForPlans(client, await fetchActivePlans(client, ids), options);
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.warn('[payroll] accrual lookup failed; showing statement balances only:', error?.message);
    }
    return [];
  }
}

/**
 * Every household payroll contribution in a period, whether or not the plan
 * is linked to an investment account (the saving happens either way). Used
 * for savings-rate style metrics. Never throws.
 * @returns {Promise<Array<{date, member, kind, total, employee, employer}>>}
 */
async function fetchHouseholdPayrollContributions(client, options = {}) {
  if (!client) return [];
  try {
    const rows = await accrueForPlans(client, await fetchActivePlans(client, null), options, { requireAccount: false });
    return rows.map((row) => ({
      date: row.date,
      member: row.payroll_member,
      kind: row.payroll_kind,
      total: Math.abs(Number(row.price) || 0),
      employee: row.payroll_employee_amount,
      employer: row.payroll_employer_amount,
    }));
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.warn('[payroll] household contribution lookup failed:', error?.message);
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cost-basis carry between statements
// ---------------------------------------------------------------------------

/**
 * Statement totals per account and date: SUM(cost_basis) of the account's
 * non-pikadon holdings on each as_of_date.
 * @returns {Map<number, Array<{date: string, costBasis: number|null}>>}
 */
async function fetchStatementCostHistory(client, accountIds) {
  const ids = normalizeIds(accountIds);
  if (!client || ids.length === 0) return new Map();
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
  const result = await client.query(
    `SELECT account_id,
            substr(as_of_date, 1, 10) AS statement_date,
            SUM(cost_basis) AS cost_basis,
            COUNT(cost_basis) AS cost_count
       FROM investment_holdings
      WHERE account_id IN (${placeholders})
        AND COALESCE(holding_type, 'standard') <> 'pikadon'
        AND COALESCE(status, 'active') <> 'superseded'
      GROUP BY account_id, substr(as_of_date, 1, 10)
      ORDER BY account_id ASC, statement_date ASC`,
    ids,
  );
  const history = new Map();
  (Array.isArray(result?.rows) ? result.rows : []).forEach((row) => {
    const accountId = Number(row.account_id);
    if (!Number.isFinite(accountId) || !row.statement_date) return;
    if (!history.has(accountId)) history.set(accountId, []);
    history.get(accountId).push({
      date: String(row.statement_date),
      costBasis: Number(row.cost_count) > 0 && Number.isFinite(Number(row.cost_basis))
        ? Number(row.cost_basis)
        : null,
    });
  });
  return history;
}

/**
 * Statements usually repeat the previous cost basis (the fund reports a
 * balance, not what was paid in), so payroll contributions between two
 * statements would otherwise show up as gains. When a statement keeps the
 * previous cost basis, the estimated contributions since that previous
 * statement are carried into it. A statement whose cost basis was changed by
 * hand is trusted as-is and resets the carry.
 *
 * Pure.
 * @returns {Map<number, {carry: number, statementDate: string, schedule: Array<{date: string, carry: number}>}>}
 */
function computeCostBasisCarry(statementsByAccount, estimateRows = []) {
  const estimatesByAccount = new Map();
  (Array.isArray(estimateRows) ? estimateRows : []).forEach((row) => {
    if (Number(row?.is_estimated) !== 1) return;
    const accountId = Number(row.account_id);
    const effectiveDate = toIsoDateInTimeZone(row.transaction_datetime || row.date);
    const amount = Math.abs(Number(row.price) || 0);
    if (!Number.isFinite(accountId) || !effectiveDate || amount <= 0) return;
    if (!estimatesByAccount.has(accountId)) estimatesByAccount.set(accountId, []);
    estimatesByAccount.get(accountId).push({ effectiveDate, amount });
  });

  const carries = new Map();
  estimatesByAccount.forEach((estimates, accountId) => {
    const statements = (statementsByAccount.get(accountId) || [])
      .filter((statement) => statement.costBasis !== null)
      .sort((left, right) => left.date.localeCompare(right.date));
    if (statements.length === 0) return;

    let carry = 0;
    const schedule = [{ date: statements[0].date, carry: 0 }];
    for (let index = 1; index < statements.length; index += 1) {
      const previous = statements[index - 1];
      const current = statements[index];
      if (Math.abs(current.costBasis - previous.costBasis) < 0.5) {
        carry += estimates
          .filter((estimate) => estimate.effectiveDate > previous.date && estimate.effectiveDate <= current.date)
          .reduce((sum, estimate) => sum + estimate.amount, 0);
      } else {
        carry = 0;
      }
      schedule.push({ date: current.date, carry: Math.round(carry * 100) / 100 });
    }

    if (schedule.some((entry) => entry.carry > 0)) {
      const latest = schedule[schedule.length - 1];
      carries.set(accountId, { carry: latest.carry, statementDate: latest.date, schedule });
    }
  });
  return carries;
}

/**
 * Adds the carried contributions to each statement point's cost basis.
 * Points must be the statement-derived history, before roll-forward.
 */
function applyCostBasisCarryToHistory(points, schedule) {
  if (!Array.isArray(points) || !Array.isArray(schedule) || schedule.length === 0) return points;
  const sorted = [...schedule].sort((left, right) => left.date.localeCompare(right.date));
  return points.map((point) => {
    const pointDate = String(point?.date || '').slice(0, 10);
    let carry = 0;
    for (const entry of sorted) {
      if (entry.date <= pointDate) carry = entry.carry;
      else break;
    }
    if (!(carry > 0)) return point;
    const costBasis = (Number(point.costBasis) || 0) + carry;
    const currentValue = Number(point.currentValue) || 0;
    const gainLoss = currentValue - costBasis;
    return {
      ...point,
      costBasis,
      gainLoss,
      roi: costBasis > 0 ? (gainLoss / costBasis) * 100 : 0,
      estimatedCostBasisCarry: carry,
    };
  });
}

// ---------------------------------------------------------------------------
// Keren hishtalmut liquidity
// ---------------------------------------------------------------------------

/**
 * Tax-free withdrawal date per investment account linked to an active keren
 * hishtalmut plan (earliest when several members share one account). Never
 * throws.
 * @returns {Promise<Map<number, {withdrawableFrom: string, member: string}>>}
 */
async function fetchKerenHishtalmutLiquidity(client, accountIds = []) {
  const ids = normalizeIds(accountIds);
  if (!client || ids.length === 0) return new Map();
  try {
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
    const result = await client.query(
      `SELECT p.account_id, p.kind, p.start_date, p.opened_date, e.member
         FROM payroll_contribution_plans p
         JOIN household_employment e ON e.id = p.employment_id
        WHERE p.kind = 'keren_hishtalmut'
          AND p.is_active = 1
          AND p.account_id IN (${placeholders})`,
      ids,
    );
    const liquidity = new Map();
    (Array.isArray(result?.rows) ? result.rows : []).forEach((row) => {
      const accountId = Number(row.account_id);
      const withdrawableFrom = kerenHishtalmutWithdrawableFrom(row);
      if (!Number.isFinite(accountId) || !withdrawableFrom) return;
      const existing = liquidity.get(accountId);
      if (!existing || withdrawableFrom < existing.withdrawableFrom) {
        liquidity.set(accountId, { withdrawableFrom, member: row.member });
      }
    });
    return liquidity;
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.warn('[payroll] keren hishtalmut liquidity lookup failed:', error?.message);
    }
    return new Map();
  }
}

module.exports = {
  PAYROLL_ESTIMATE_VENDOR,
  applyCostBasisCarryToHistory,
  buildAccrualRows,
  computeCostBasisCarry,
  fetchHouseholdPayrollContributions,
  fetchKerenHishtalmutLiquidity,
  fetchPayrollAccrualRows,
  fetchStatementCostHistory,
};
module.exports.default = module.exports;
