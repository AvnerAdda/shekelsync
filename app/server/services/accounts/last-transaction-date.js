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

  if (!vendor) {
    throw serviceError(400, 'Vendor parameter is required');
  }

  const result = await database.query(
    `
      SELECT MAX(COALESCE(transaction_datetime, date)) AS last_transaction_date
      FROM transactions
      WHERE vendor = $1
    `,
    [vendor],
  );

  const lastTransactionDate = result.rows[0]?.last_transaction_date;

  if (!lastTransactionDate) {
    const fallbackStart = startOfMonth(subMonths(new Date(), 3));
    return {
      lastTransactionDate: fallbackStart.toISOString(),
      hasTransactions: false,
      message: 'No previous transactions found, starting from 3 months ago',
    };
  }

  const baseDate = new Date(lastTransactionDate);
  const nextDay = new Date(baseDate);
  nextDay.setDate(nextDay.getDate() + 1);

  return {
    lastTransactionDate: nextDay.toISOString(),
    hasTransactions: true,
    message: `Starting from day after last transaction: ${baseDate.toLocaleDateString()}`,
  };
}

module.exports = {
  getLastTransactionDate,
};

module.exports.default = module.exports;
