const database = require('../database.js');

let dateFnsPromise;

function loadDateFns() {
  if (!dateFnsPromise) {
    dateFnsPromise = import('date-fns');
  }
  return dateFnsPromise;
}

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function getLastTransactionDate(params = {}) {
  const { startOfMonth, subMonths } = await loadDateFns();
  const vendor = params.vendor || params.vendorId;
  const credentialNickname = params.credentialNickname || params.nickname;

  if (!vendor) {
    throw serviceError(400, 'Vendor parameter is required');
  }

  // Build query based on whether we're filtering by credential nickname
  let query;
  let queryParams;

  if (credentialNickname) {
    // Query by vendor AND vendor_nickname for per-credential accuracy
    query = `
      SELECT MAX(COALESCE(transaction_datetime, date)) AS last_transaction_date
      FROM transactions
      WHERE vendor = $1 AND vendor_nickname = $2
    `;
    queryParams = [vendor, credentialNickname];
  } else {
    // Backward compatibility: query by vendor only
    query = `
      SELECT MAX(COALESCE(transaction_datetime, date)) AS last_transaction_date
      FROM transactions
      WHERE vendor = $1
    `;
    queryParams = [vendor];
  }

  const result = await database.query(query, queryParams);
  const lastTransactionDate = result.rows[0]?.last_transaction_date;

  if (!lastTransactionDate) {
    // No transactions found: start from 3 months ago, beginning of month
    const fallbackStart = startOfMonth(subMonths(new Date(), 3));
    const credentialInfo = credentialNickname ? ` for ${credentialNickname}` : '';
    return {
      lastTransactionDate: fallbackStart.toISOString(),
      hasTransactions: false,
      message: `No previous transactions found${credentialInfo}, starting from 3 months ago (${fallbackStart.toLocaleDateString()})`,
    };
  }

  // Start from the day after the last transaction
  const baseDate = new Date(lastTransactionDate);
  const nextDay = new Date(baseDate);
  nextDay.setDate(nextDay.getDate() + 1);

  const credentialInfo = credentialNickname ? ` for ${credentialNickname}` : '';
  return {
    lastTransactionDate: nextDay.toISOString(),
    hasTransactions: true,
    message: `Starting from day after last transaction${credentialInfo}: ${baseDate.toLocaleDateString()}`,
  };
}

module.exports = {
  getLastTransactionDate,
};

module.exports.default = module.exports;
