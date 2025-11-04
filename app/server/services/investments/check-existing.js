const database = require('../database.js');
const { getAllPatterns } = require('../../../config/investment-patterns.js');

async function getExistingInvestments() {
  const vendorResult = await database.query(
    `SELECT DISTINCT
        t.vendor,
        t.name,
        cd.id as category_definition_id,
        cd.name as category_name,
        parent.name as parent_name,
        COUNT(*) as transaction_count,
        SUM(ABS(t.price)) as total_amount
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      WHERE (t.category_type = 'investment' OR cd.category_type = 'investment')
        AND (t.status IS NULL OR t.status != 'canceled')
      GROUP BY t.vendor, t.name, cd.id, cd.name, parent.name
      ORDER BY total_amount DESC`,
  );

  const rulesResult = await database.query(
    `SELECT
        cr.name_pattern,
        cr.category_definition_id,
        cd.name as category_name,
        parent.name as parent_name
      FROM categorization_rules cr
      LEFT JOIN category_definitions cd ON cr.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      WHERE cr.is_active = true
        AND (
          cd.category_type = 'investment'
          OR LOWER(cd.name) LIKE '%השתלמות%'
          OR LOWER(cd.name) LIKE '%פנסיה%'
          OR LOWER(cd.name) LIKE '%קופת גמל%'
          OR LOWER(cd.name) LIKE '%מניות%'
          OR LOWER(cd.name) LIKE '%ברוקר%'
          OR LOWER(cd.name) LIKE '%קריפטו%'
          OR LOWER(cr.name_pattern) LIKE '%interactive%'
          OR LOWER(cr.name_pattern) LIKE '%bits of gold%'
          OR LOWER(cr.name_pattern) LIKE '%פיקדון%'
          OR LOWER(cr.name_pattern) LIKE '%קופת גמל%'
        )`,
  );

  const linkedAccountsResult = await database.query(
    `SELECT 
        ia.id,
        ia.account_name,
        ia.account_type,
        COUNT(tal.id) as link_count
      FROM investment_accounts ia
      LEFT JOIN transaction_account_links tal ON ia.id = tal.account_id
      WHERE tal.id IS NOT NULL
      GROUP BY ia.id, ia.account_name, ia.account_type
      HAVING COUNT(tal.id) > 0`,
  );

  const vendors = vendorResult.rows.map((row) => ({
    vendor: row.vendor,
    name: row.name,
    categoryDefinitionId: row.category_definition_id,
    categoryName: row.category_name,
    parentName: row.parent_name,
    transactionCount: parseInt(row.transaction_count, 10),
    totalAmount: parseFloat(row.total_amount),
  }));

  const rules = rulesResult.rows.map((row) => ({
    pattern: row.name_pattern,
    categoryDefinitionId: row.category_definition_id,
    categoryName: row.category_name,
    parentName: row.parent_name,
  }));

  const allPatterns = getAllPatterns();
  const patternsByType = {};
  for (const { pattern, type } of allPatterns) {
    if (!patternsByType[type]) {
      patternsByType[type] = [];
    }
    patternsByType[type].push(pattern);
  }

  const linkedAccounts = linkedAccountsResult.rows.map((row) => ({
    id: row.id,
    accountName: row.account_name,
    accountType: row.account_type,
    linkCount: parseInt(row.link_count, 10),
  }));

  return {
    vendors,
    rules,
    patterns: patternsByType,
    linkedAccounts,
  };
}

module.exports = {
  getExistingInvestments,
};
module.exports.default = module.exports;
