import { subMonths } from 'date-fns';
import { BANK_CATEGORY_NAME } from '@/lib/category-constants.js';

/**
 * Normalises start/end date range based on query params.
 * Falls back to last `months` months when explicit dates are not provided.
 */
export function resolveDateRange({ startDate, endDate, months = 3 }) {
  let start;
  let end;

  if (startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
  } else {
    end = new Date();
    start = subMonths(end, parseInt(months, 10));
  }

  return { start, end };
}

/**
 * Builds price filter and amount expression based on transaction type.
 */
export function buildTypeFilters(type = 'expense') {
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
export function standardizeResponse(data, metadata = {}) {
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
export function standardizeError(message, code = 'INTERNAL_ERROR', details = {}) {
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
