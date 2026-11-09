'use strict';

/**
 * Every contribution source that rolls an investment balance forward past
 * its last statement: bank transactions linked to the account, plus
 * estimated payroll contributions (pension, severance, keren hishtalmut).
 */

const { fetchLinkedInvestmentTransactions } = require('./linked-transaction-rollforward.js');
const { fetchPayrollAccrualRows } = require('../payroll/accruals.js');

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

module.exports = { fetchInvestmentContributionRows };
module.exports.default = module.exports;
