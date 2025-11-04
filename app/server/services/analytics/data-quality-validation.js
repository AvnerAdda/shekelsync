const database = require('../../services/database.js');
const { getUnpairedTransactionCount } = require('../accounts/unpaired.js');

// Vendor constants
const BANK_VENDORS = [
  'hapoalim',
  'leumi',
  'discount',
  'mizrahi',
  'beinleumi',
  'union',
  'yahav',
  'otsarHahayal',
  'mercantile',
  'massad',
  'beyahadBishvilha',
  'behatsdaa',
  'pagi',
  'oneZero',
];

const CREDIT_CARD_VENDORS = ['visaCal', 'max', 'isracard', 'amex'];

/**
 * Validates data quality and returns warnings for missing or incomplete data
 * @returns {Promise<{hasIssues: boolean, warnings: Array}>}
 */
async function validateDataQuality() {
  const warnings = [];

  try {
    // Check 1: Bank and Credit Card Credentials
    // Use simple OR conditions instead of IN with many parameters for SQLite compatibility
    const bankConditions = BANK_VENDORS.map((v, i) => `vendor = $${i + 1}`).join(' OR ');
    const creditConditions = CREDIT_CARD_VENDORS.map((v, i) => `vendor = $${i + BANK_VENDORS.length + 1}`).join(' OR ');

    const credentialsResult = await database.query(
      `
      SELECT
        SUM(CASE WHEN ${bankConditions} THEN 1 ELSE 0 END) as bank_count,
        SUM(CASE WHEN ${creditConditions} THEN 1 ELSE 0 END) as credit_count,
        COUNT(*) as total_count
      FROM vendor_credentials
      `,
      [...BANK_VENDORS, ...CREDIT_CARD_VENDORS],
    );

    const row = credentialsResult.rows[0] || { bank_count: 0, credit_count: 0, total_count: 0 };
    const hasBankAccounts = parseInt(row.bank_count, 10) > 0;
    const hasCreditCards = parseInt(row.credit_count, 10) > 0;
    const totalCount = parseInt(row.total_count, 10);

    // Critical: No bank accounts
    if (!hasBankAccounts) {
      warnings.push({
        type: 'no_bank_accounts',
        severity: 'critical',
        title: 'No Bank Accounts Connected',
        message:
          'Connect a bank account to track your balance, income, and calculate financial runway. Bank data is essential for accurate financial health scoring.',
        actionLabel: 'Add Bank Account',
        actionTarget: 'accounts_modal',
      });
    }

    // High: No credit cards
    if (!hasCreditCards) {
      warnings.push({
        type: 'no_credit_cards',
        severity: 'high',
        title: 'No Credit Cards Connected',
        message:
          'Add credit card accounts to get complete spending analysis. Most expenses are typically charged to credit cards.',
        actionLabel: 'Add Credit Card',
        actionTarget: 'accounts_modal',
      });
    }

    // Check 2: Unpaired Transactions (only if we have accounts)
    if (totalCount > 0) {
      try {
        const unpairedCount = await getUnpairedTransactionCount();

        if (unpairedCount > 0) {
          warnings.push({
            type: 'unpaired_transactions',
            severity: 'high',
            title: `${unpairedCount} Potential Duplicate Transaction${unpairedCount > 1 ? 's' : ''}`,
            message: `Found ${unpairedCount} unpaired bank transactions that may be duplicates of credit card charges. Review pairings to ensure data accuracy.`,
            count: unpairedCount,
            actionLabel: 'Review Pairings',
            actionTarget: 'pairing_modal',
          });
        }
      } catch (error) {
        console.error('Error checking unpaired transactions:', error);
      }
    }

    // Check 3: Transactions assigned to parent categories (not leaf nodes)
    const parentCategoriesResult = await database.query(
      `
      SELECT
        COUNT(DISTINCT t.identifier) as transaction_count,
        (SELECT COUNT(*) FROM transactions) as total_transactions
      FROM transactions t
      INNER JOIN category_definitions cd ON t.category_definition_id = cd.id
      WHERE cd.id IN (
        SELECT DISTINCT parent_id
        FROM category_definitions
        WHERE parent_id IS NOT NULL
      )
      AND t.category_definition_id IS NOT NULL
      `,
    );

    const parentCatData = parentCategoriesResult.rows[0] || { transaction_count: 0, total_transactions: 0 };
    const parentCategoryCount = parseInt(parentCatData.transaction_count || 0, 10);
    const totalTransactions = parseInt(parentCatData.total_transactions || 0, 10);

    if (parentCategoryCount > 0 && totalTransactions > 0) {
      const percentage = Math.round((parentCategoryCount / totalTransactions) * 100);

      warnings.push({
        type: 'incomplete_categorization',
        severity: 'medium',
        title: 'Incomplete Categorization Detected',
        message: `${parentCategoryCount} transaction${parentCategoryCount > 1 ? 's are' : ' is'} assigned to parent categories instead of specific subcategories (${percentage}% of all transactions). Refine categorization for better insights.`,
        count: parentCategoryCount,
        percentage,
        actionLabel: 'Review Categories',
        actionTarget: 'category_modal',
      });
    }

    // Check 4: No categorization rules exist
    const rulesResult = await database.query(
      `
      SELECT COUNT(*) as rule_count
      FROM categorization_rules
      WHERE is_active = true
      `,
    );

    const ruleData = rulesResult.rows[0] || { rule_count: 0 };
    const ruleCount = parseInt(ruleData.rule_count || 0, 10);

    if (ruleCount === 0 && totalCount > 0) {
      warnings.push({
        type: 'no_rules',
        severity: 'medium',
        title: 'No Auto-Categorization Rules',
        message:
          'Set up categorization rules to automatically assign categories to new transactions. This saves time and ensures consistency.',
        actionLabel: 'Create Rules',
        actionTarget: 'category_modal',
      });
    }

    return {
      hasIssues: warnings.length > 0,
      warnings,
    };
  } catch (error) {
    console.error('Error validating data quality:', error);
    // Return empty warnings on error to not break the page
    return {
      hasIssues: false,
      warnings: [],
    };
  }
}

module.exports = {
  validateDataQuality,
};

module.exports.default = module.exports;
