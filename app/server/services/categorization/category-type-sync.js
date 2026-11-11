// A transaction's stored category_type must match its category. Older syncs filed bank
// rows (salary, mortgage, deposits) under income and investment categories but kept the
// bank category's "expense", so modules that read the stored type counted salary as spending.
const CATEGORY_TYPE_REPAIR_SQL = `
  UPDATE transactions
     SET category_type = (SELECT cd.category_type FROM category_definitions cd WHERE cd.id = transactions.category_definition_id)
   WHERE category_type = 'expense'
     AND category_definition_id IN (
       SELECT id FROM category_definitions WHERE category_type IN ('income', 'investment')
     )`;

async function repairTransactionCategoryTypes(client) {
  const result = await client.query(CATEGORY_TYPE_REPAIR_SQL);
  return Number(result?.rowCount ?? result?.changes ?? 0);
}

module.exports = { CATEGORY_TYPE_REPAIR_SQL, repairTransactionCategoryTypes };
module.exports.default = module.exports;
