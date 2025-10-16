/**
 * Shared utility functions for database queries
 */

// Import existing duplicate filter from analytics utils
export { buildDuplicateFilter, resolveDateRange } from '../analytics/utils.js';


/**
 * Builds price filter and amount expression based on transaction type
 * @param {string} type - Transaction type ('income', 'expense', 'investment')
 * @returns {Object} - Price filter and amount expression
 */
export function buildTypeFilters(type = 'expense') {
  const configs = {
    expense: {
      priceFilter: 'price < 0',
      amountExpression: 'ABS(price)',
      categoryFilter: "category != 'Bank'"
    },
    income: {
      priceFilter: 'price > 0',
      amountExpression: 'price',
      categoryFilter: "category = 'Income' OR category = 'Bank'"
    },
    investment: {
      priceFilter: '',
      amountExpression: 'ABS(price)',
      categoryFilter: "category LIKE '%Investment%'"
    }
  };

  return configs[type] || configs.expense;
}

/**
 * Standardizes API response format
 * @param {Object} data - Response data
 * @param {Object} metadata - Optional metadata
 * @returns {Object} - Standardized response
 */
export function standardizeResponse(data, metadata = {}) {
  return {
    success: true,
    data,
    metadata: {
      timestamp: new Date().toISOString(),
      ...metadata
    }
  };
}

/**
 * Standardizes error response format
 * @param {string} message - Error message
 * @param {string} code - Error code
 * @param {Object} details - Additional error details
 * @returns {Object} - Standardized error response
 */
export function standardizeError(message, code = 'INTERNAL_ERROR', details = {}) {
  return {
    success: false,
    error: {
      code,
      message,
      details,
      timestamp: new Date().toISOString()
    }
  };
}