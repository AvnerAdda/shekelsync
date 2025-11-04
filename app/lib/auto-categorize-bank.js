const { matchCategorizationRule } = require('./category-helpers.js');

async function autoCategorizeBankTransaction({
  transactionName,
  accountNumber,
  client,
}) {
  if (!transactionName) {
    return { success: false };
  }

  const match = await matchCategorizationRule(transactionName, client);
  if (!match) {
    return { success: false };
  }

  return {
    success: true,
    categoryDefinitionId: match.category_definition_id || null,
    parentCategory: match.parent_category || null,
    subcategory: match.subcategory || null,
    confidence: 0.8,
  };
}

module.exports = {
  autoCategorizeBankTransaction,
};
