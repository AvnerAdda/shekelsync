/**
 * Data Anonymizer Module
 * Anonymizes sensitive financial data before sending to OpenAI
 *
 * Strategy: Light anonymization
 * - Keep: categories, dates, amounts, transaction types
 * - Replace: merchant names with generic labels (Merchant_1, Merchant_2, etc.)
 */

/**
 * Create a new anonymizer instance
 * Each conversation should use its own anonymizer to maintain consistent mappings
 * @returns {Object} Anonymizer instance
 */
function createAnonymizer() {
  const merchantMap = new Map(); // actual -> anonymous
  const reverseMap = new Map();  // anonymous -> actual
  let counter = 0;

  return {
    /**
     * Anonymize a merchant name
     * @param {string} merchantName - The original merchant name
     * @returns {string|null} The anonymized merchant label
     */
    anonymizeMerchant(merchantName) {
      if (!merchantName) return null;

      const trimmed = merchantName.trim();
      if (!trimmed) return null;

      if (merchantMap.has(trimmed)) {
        return merchantMap.get(trimmed);
      }

      counter++;
      const anonymous = `Merchant_${counter}`;
      merchantMap.set(trimmed, anonymous);
      reverseMap.set(anonymous, trimmed);

      return anonymous;
    },

    /**
     * Anonymize a single transaction
     * @param {Object} transaction - The transaction object
     * @returns {Object} Anonymized transaction
     */
    anonymizeTransaction(transaction) {
      if (!transaction) return null;

      return {
        ...transaction,
        name: this.anonymizeMerchant(transaction.name) || transaction.name,
        merchant_name: this.anonymizeMerchant(transaction.merchant_name),
        // Keep these fields as-is
        price: transaction.price,
        date: transaction.date,
        category: transaction.category,
        category_definition_id: transaction.category_definition_id,
        account_number: transaction.account_number ? '****' + transaction.account_number.slice(-4) : null,
      };
    },

    /**
     * Anonymize an array of transactions
     * @param {Array} transactions - Array of transaction objects
     * @returns {Array} Array of anonymized transactions
     */
    anonymizeTransactions(transactions) {
      if (!Array.isArray(transactions)) return [];
      return transactions.map(t => this.anonymizeTransaction(t));
    },

    /**
     * Anonymize merchant spending data
     * @param {Array} merchants - Array of merchant spending objects
     * @returns {Array} Array of anonymized merchant data
     */
    anonymizeMerchants(merchants) {
      if (!Array.isArray(merchants)) return [];

      return merchants.map(m => ({
        name: this.anonymizeMerchant(m.name) || this.anonymizeMerchant(m.merchant_name),
        visits: m.visits || m.visit_count,
        total: m.total || m.total_spent,
      }));
    },

    /**
     * Get the original merchant name from an anonymous label
     * For internal debugging/logging only
     * @param {string} anonymousName - The anonymous label (e.g., "Merchant_1")
     * @returns {string|undefined} The original merchant name
     */
    getOriginal(anonymousName) {
      return reverseMap.get(anonymousName);
    },

    /**
     * Get the full mapping (anonymous -> original)
     * For debugging purposes
     * @returns {Object} The reverse mapping object
     */
    getMapping() {
      return Object.fromEntries(reverseMap);
    },

    /**
     * Get statistics about the anonymization
     * @returns {Object} Statistics object
     */
    getStats() {
      return {
        uniqueMerchants: merchantMap.size,
      };
    },
  };
}

/**
 * Anonymize a financial context object
 * @param {Object} context - The financial context from getFinancialContext
 * @param {Object} anonymizer - The anonymizer instance to use
 * @returns {Object} Anonymized context
 */
function anonymizeContext(context, anonymizer) {
  if (!context) return context;

  return {
    // Preserve all important context fields
    hasData: context.hasData,
    permissions: context.permissions,
    summary: context.summary,
    categories: context.categories,
    budgets: context.budgets,
    monthlyTrends: context.monthlyTrends,
    analytics: context.analytics,
    investments: context.investments,
    // Anonymize transactions
    recentTransactions: anonymizer.anonymizeTransactions(context.recentTransactions),
    // Anonymize merchants
    topMerchants: anonymizer.anonymizeMerchants(context.topMerchants),
  };
}

module.exports = {
  createAnonymizer,
  anonymizeContext,
};
