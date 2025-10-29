import { matchCategorizationRule } from './category-helpers.js';

/**
 * Default category IDs for bank transactions
 */
const DEFAULT_INCOME_CATEGORY_ID = 72; // הכנסות (Income)
const DEFAULT_EXPENSE_CATEGORY_ID = 1;  // הוצאות (Expenses)

/**
 * Smart auto-categorization for bank transactions based on transaction name and price.
 *
 * Logic:
 * 1. First, try to match transaction name against categorization rules (checks if transaction name contains a category name)
 * 2. If no match, use price to determine default category:
 *    - Positive price (> 0) → Income category (72)
 *    - Negative price (< 0) → Expense category (1)
 *
 * @param {string} transactionName - The transaction description/name
 * @param {number} price - The transaction amount (positive = income, negative = expense)
 * @param {import('pg').PoolClient} client - Database client
 * @returns {Promise<{
 *   categoryDefinitionId: number,
 *   categoryType: string,
 *   confidence: number,
 *   source: 'rule_match' | 'price_based'
 * }>}
 */
export async function autoCategorizeBankTransaction(transactionName, price, client) {
  // Step 1: Try to match against categorization rules or category names
  const ruleMatch = await matchCategorizationRule(transactionName, client);

  if (ruleMatch && ruleMatch.category_definition_id) {
    // Get category info to determine category_type
    const categoryInfo = await client.query(
      `SELECT category_type FROM category_definitions WHERE id = $1`,
      [ruleMatch.category_definition_id]
    );

    return {
      categoryDefinitionId: ruleMatch.category_definition_id,
      categoryType: categoryInfo.rows[0]?.category_type || 'expense',
      confidence: 0.9,
      source: 'rule_match'
    };
  }

  // Step 2: No rule match - use price to determine category
  if (price > 0) {
    return {
      categoryDefinitionId: DEFAULT_INCOME_CATEGORY_ID,
      categoryType: 'income',
      confidence: 0.7,
      source: 'price_based'
    };
  } else {
    return {
      categoryDefinitionId: DEFAULT_EXPENSE_CATEGORY_ID,
      categoryType: 'expense',
      confidence: 0.7,
      source: 'price_based'
    };
  }
}

/**
 * Check if a transaction name contains any category name from the database.
 * This helps identify when a transaction explicitly mentions its category.
 *
 * @param {string} transactionName - The transaction description
 * @param {import('pg').PoolClient} client - Database client
 * @returns {Promise<{id: number, name: string, category_type: string} | null>}
 */
export async function findCategoryInTransactionName(transactionName, client) {
  if (!transactionName) return null;

  const cleanName = transactionName.toLowerCase().trim();

  // Search for category names (both Hebrew and English) that appear in the transaction name
  const result = await client.query(
    `SELECT id, name, name_en, category_type
     FROM category_definitions
     WHERE (
       LOWER($1) LIKE '%' || LOWER(name) || '%'
       OR LOWER($1) LIKE '%' || LOWER(name_en) || '%'
     )
     AND parent_id IS NOT NULL
     ORDER BY LENGTH(name) DESC
     LIMIT 1`,
    [cleanName]
  );

  return result.rows[0] || null;
}
