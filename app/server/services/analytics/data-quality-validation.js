const database = require('../../services/database.js');
const { getUnpairedTransactionCount } = require('../accounts/unpaired.js');
const { getVendorCodesByTypes } = require('../institutions.js');
const { dialect } = require('../../../lib/sql-dialect.js');

function buildVendorClause(vendors) {
  if (!vendors || vendors.length === 0) {
    return null;
  }

  if (dialect.useSqlite) {
    const placeholders = vendors.map(() => '?').join(',');
    return {
      clause: `vendor IN (${placeholders})`,
      params: vendors,
    };
  }

  return {
    clause: 'vendor = ANY($1)',
    params: [vendors],
  };
}

async function countCredentialsByVendors(vendors) {
  const clauseDetails = buildVendorClause(vendors);
  if (!clauseDetails) {
    return 0;
  }

  const result = await database.query(
    `SELECT COUNT(*) AS count FROM vendor_credentials WHERE ${clauseDetails.clause}`,
    clauseDetails.params,
  );

  return Number.parseInt(result.rows[0]?.count || 0, 10);
}

async function countTotalCredentials() {
  const result = await database.query('SELECT COUNT(*) AS count FROM vendor_credentials');
  return Number.parseInt(result.rows[0]?.count || 0, 10);
}

/**
 * Validates data quality and returns warnings for missing or incomplete data
 * @returns {Promise<{hasIssues: boolean, warnings: Array}>}
 */
async function validateDataQuality() {
  const warnings = [];

  try {
    // Check 1: Bank and Credit Card Credentials
    const [bankVendors = [], creditVendors = []] = await Promise.all([
      getVendorCodesByTypes(database, ['bank']),
      getVendorCodesByTypes(database, ['credit_card']),
    ]);

    const [bankAccountCount, creditCardCount, totalCount] = await Promise.all([
      countCredentialsByVendors(bankVendors),
      countCredentialsByVendors(creditVendors),
      countTotalCredentials(),
    ]);

    const hasBankAccounts = bankAccountCount > 0;
    const hasCreditCards = creditCardCount > 0;

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
