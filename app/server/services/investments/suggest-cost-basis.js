const path = require('path');
const { pathToFileURL } = require('url');
const actualDatabase = require('../database.js');
let database = actualDatabase;

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

let accountMatcherModulePromise = null;

async function loadAccountMatcher() {
  if (!accountMatcherModulePromise) {
    const matcherPath = path.join(__dirname, '..', '..', '..', 'utils', 'account-matcher.js');
    accountMatcherModulePromise = import(pathToFileURL(matcherPath).href);
  }

  return accountMatcherModulePromise;
}

async function suggestCostBasis(params = {}) {
  const { account_id: accountId, account_name: accountName } = params;

  if (!accountId && !accountName) {
    throw serviceError(400, 'Either account_id or account_name is required');
  }

  let accountQuery;
  let accountParams;

  if (accountId) {
    accountQuery = `
      SELECT 
        ia.id AS account_id,
        ia.account_name,
        ia.account_type,
        ih.cost_basis,
        ih.as_of_date
      FROM investment_accounts ia
      LEFT JOIN investment_holdings ih ON ia.id = ih.account_id
      WHERE ia.id = $1
    `;
    accountParams = [accountId];
  } else {
    accountQuery = `
      SELECT 
        ia.id AS account_id,
        ia.account_name,
        ia.account_type,
        ih.cost_basis,
        ih.as_of_date
      FROM investment_accounts ia
      LEFT JOIN investment_holdings ih ON ia.id = ih.account_id
      WHERE LOWER(ia.account_name) = LOWER($1)
      ORDER BY ia.created_at DESC
      LIMIT 1
    `;
    accountParams = [accountName];
  }

  const accountResult = await database.query(accountQuery, accountParams);
  if (accountResult.rows.length === 0) {
    throw serviceError(404, 'Account not found');
  }

  const account = accountResult.rows[0];
  const lastUpdateDate = account.as_of_date || '1900-01-01';
  const currentCostBasis = Number.parseFloat(account.cost_basis) || 0;

  const accountMatcher = await loadAccountMatcher();
  const buildSQLPatterns =
    accountMatcher.buildSQLPatterns || accountMatcher.default?.buildSQLPatterns;

  if (typeof buildSQLPatterns !== 'function') {
    throw new Error('Failed to load investment account pattern matcher');
  }

  const patterns = buildSQLPatterns(account.account_type) || [];

  if (patterns.length === 0 && account.account_name) {
    patterns.push(`%${String(account.account_name).toLowerCase()}%`);
  }

  if (patterns.length === 0) {
    patterns.push('%investment%');
  }

  const patternConditions = patterns
    .map((_, index) => `LOWER(name) LIKE $${index + 2}`)
    .join(' OR ');

  const transactionsQuery = `
    SELECT 
      identifier,
      vendor,
      name,
      price,
      date,
      category_type
    FROM transactions
    WHERE date > $1
      AND category_type = 'investment'
      AND (${patternConditions})
    ORDER BY date DESC
  `;

  const transactionsResult = await database.query(transactionsQuery, [lastUpdateDate, ...patterns]);

  const transactions = transactionsResult.rows.map((row) => ({
    ...row,
    price: Number.parseFloat(row.price) || 0,
  }));

  const netFlow = transactions.reduce((sum, txn) => sum + (txn.price || 0), 0);
  const suggestedCostBasis = currentCostBasis - netFlow;

  const deposits = transactions
    .filter((txn) => txn.price < 0)
    .map((txn) => ({
      ...txn,
      absoluteAmount: Math.abs(txn.price),
    }));

  const withdrawals = transactions.filter((txn) => txn.price > 0);

  const totalDeposits = deposits.reduce((sum, txn) => sum + txn.absoluteAmount, 0);
  const totalWithdrawals = withdrawals.reduce((sum, txn) => sum + txn.price, 0);

  return {
    account: {
      account_id: account.account_id,
      account_name: account.account_name,
      account_type: account.account_type,
      last_update: account.as_of_date,
      current_cost_basis: currentCostBasis,
    },
    suggestion: {
      has_new_transactions: transactions.length > 0,
      transaction_count: transactions.length,
      deposits_count: deposits.length,
      withdrawals_count: withdrawals.length,
      total_deposits: totalDeposits,
      total_withdrawals: totalWithdrawals,
      net_flow: -netFlow,
      suggested_cost_basis: suggestedCostBasis,
      increase: suggestedCostBasis - currentCostBasis,
    },
    transactions: {
      deposits,
      withdrawals,
      all: transactions,
    },
  };
}

module.exports = {
  suggestCostBasis,
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
