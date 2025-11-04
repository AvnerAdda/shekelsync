const { BANK_CATEGORY_NAME } = require('../category-constants.js');

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function subtractMonths(date, amount) {
  const original = new Date(date.getTime());
  const result = new Date(date.getTime());

  const targetMonth = result.getMonth() - amount;
  result.setDate(1);
  result.setMonth(targetMonth);

  const day = Math.min(original.getDate(), daysInMonth(result.getFullYear(), result.getMonth()));
  result.setDate(day);
  return result;
}

/**
 * Normalises start/end date range based on query params.
 * Falls back to last `months` months when explicit dates are not provided.
 */
function resolveDateRange({ startDate, endDate, months = 3 }) {
  let start;
  let end;

  if (startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
  } else {
    end = new Date();
    start = subtractMonths(end, parseInt(months, 10));
  }

  return { start, end };
}

/**
 * Builds price filter and amount expression based on transaction type.
 */
function buildTypeFilters(type = 'expense') {
  const bankExclusion = `
    category_definition_id NOT IN (
      SELECT id FROM category_definitions WHERE name = '${BANK_CATEGORY_NAME}'
    )
  `;

  const configs = {
    expense: {
      priceFilter: 'price < 0',
      amountExpression: 'ABS(price)',
      categoryFilter: bankExclusion,
    },
    income: {
      priceFilter: 'price > 0',
      amountExpression: 'price',
      categoryFilter: "category_type = 'income'",
    },
    investment: {
      priceFilter: '',
      amountExpression: 'ABS(price)',
      categoryFilter: "category_type = 'investment'",
    },
  };

  return configs[type] || configs.expense;
}

/**
 * Standardizes API response format.
 */
function standardizeResponse(data, metadata = {}) {
  return {
    success: true,
    data,
    metadata: {
      timestamp: new Date().toISOString(),
      ...metadata,
    },
  };
}

/**
 * Standardizes error response format.
 */
function standardizeError(message, code = 'INTERNAL_ERROR', details = {}) {
  return {
    success: false,
    error: {
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
    },
  };
}

module.exports = {
  resolveDateRange,
  buildTypeFilters,
  standardizeResponse,
  standardizeError,
};
module.exports.default = module.exports;
