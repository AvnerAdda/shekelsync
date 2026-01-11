const CREDIT_CARD_REPAYMENT_CATEGORY_MATCH = {
  name: ['פרעון כרטיס אשראי', 'החזר כרטיס אשראי'],
  name_en: ['Credit Card Repayment', 'Card repayment', 'Credit card repayment'],
  name_fr: ['Remboursement de carte de crédit'],
};

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

function buildSqlInList(values) {
  return values.map((value) => `'${escapeSqlString(value)}'`).join(', ');
}

function getCreditCardRepaymentCategoryCondition(alias = 'cd') {
  const predicates = [];
  if (CREDIT_CARD_REPAYMENT_CATEGORY_MATCH.name.length > 0) {
    predicates.push(`${alias}.name IN (${buildSqlInList(CREDIT_CARD_REPAYMENT_CATEGORY_MATCH.name)})`);
  }
  if (CREDIT_CARD_REPAYMENT_CATEGORY_MATCH.name_en.length > 0) {
    predicates.push(`${alias}.name_en IN (${buildSqlInList(CREDIT_CARD_REPAYMENT_CATEGORY_MATCH.name_en)})`);
  }
  if (CREDIT_CARD_REPAYMENT_CATEGORY_MATCH.name_fr.length > 0) {
    predicates.push(`${alias}.name_fr IN (${buildSqlInList(CREDIT_CARD_REPAYMENT_CATEGORY_MATCH.name_fr)})`);
  }
  return predicates.length > 0 ? `(${predicates.join(' OR ')})` : '(0)';
}

module.exports = {
  CREDIT_CARD_REPAYMENT_CATEGORY_MATCH,
  getCreditCardRepaymentCategoryCondition,
};

module.exports.default = module.exports;
