'use strict';

/**
 * Every contribution source that rolls an investment balance forward past
 * its last statement: bank transactions linked to the account, plus
 * estimated payroll contributions (pension, severance, keren hishtalmut).
 */

const { fetchLinkedInvestmentTransactions } = require('./linked-transaction-rollforward.js');
const {
  computeCostBasisCarry,
  fetchPayrollAccrualRows,
  fetchStatementCostHistory,
} = require('../payroll/accruals.js');

/**
 * @param {object} client database client (query)
 * @param {number[]} accountIds
 * @param {{startDate?: string, endDate?: string, includeLinked?: boolean}} [options]
 *   includeLinked=false keeps only payroll estimates (always ILS, so safe to
 *   add before currency normalization, unlike linked bank transactions).
 */
async function fetchInvestmentContributionRows(client, accountIds = [], options = {}) {
  const { includeLinked = true, ...range } = options || {};
  const linked = includeLinked
    ? await fetchLinkedInvestmentTransactions(client, accountIds, range)
    : [];
  const payroll = await fetchPayrollAccrualRows(client, accountIds, range);
  return payroll.length > 0 ? [...linked, ...payroll] : linked;
}

/**
 * Cost-basis carry (see payroll/accruals.js computeCostBasisCarry) for the
 * accounts that received payroll estimates. Queries statement history only
 * when there is at least one estimate, so accounts without payroll plans cost
 * nothing extra.
 * @returns {Promise<Map<number, {carry: number, statementDate: string, schedule: Array}>>}
 */
async function fetchPayrollCostBasisCarry(client, contributionRows = []) {
  const estimated = (Array.isArray(contributionRows) ? contributionRows : [])
    .filter((row) => Number(row?.is_estimated) === 1);
  if (estimated.length === 0) return new Map();
  try {
    const accountIds = [...new Set(estimated.map((row) => Number(row.account_id)))];
    const statements = await fetchStatementCostHistory(client, accountIds);
    return computeCostBasisCarry(statements, estimated);
  } catch (error) {
    console.warn('[payroll] cost-basis carry failed; using statement cost basis:', error?.message);
    return new Map();
  }
}

/**
 * Adds each account's carried payroll contributions to its cost basis.
 * Mutates and returns the accounts.
 */
function applyCostBasisCarry(accounts, carries, { idField = 'id', costBasisField = 'cost_basis' } = {}) {
  if (!Array.isArray(accounts) || !(carries instanceof Map) || carries.size === 0) return accounts;
  accounts.forEach((account) => {
    const entry = carries.get(Number(account?.[idField]));
    if (!entry || !(entry.carry > 0)) return;
    const cost = Number(account[costBasisField]);
    if (account[costBasisField] === null || account[costBasisField] === undefined || !Number.isFinite(cost)) return;
    account[costBasisField] = cost + entry.carry;
    account.estimated_cost_basis_carry = entry.carry;
  });
  return accounts;
}

module.exports = {
  applyCostBasisCarry,
  fetchInvestmentContributionRows,
  fetchPayrollCostBasisCarry,
};
module.exports.default = module.exports;
