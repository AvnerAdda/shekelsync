const CATEGORY_KEYS = ['cash', 'liquid', 'illiquid', 'restricted', 'stability', 'other'];

const ACCOUNT_TYPE_CATEGORY = {
  bank_balance: 'cash',
  cash: 'cash',
  foreign_bank: 'cash',
  foreign_investment: 'cash',
  brokerage: 'liquid',
  crypto: 'liquid',
  mutual_fund: 'liquid',
  bonds: 'liquid',
  savings: 'liquid',
  real_estate: 'illiquid',
  pension: 'restricted',
  provident: 'restricted',
  study_fund: 'restricted',
  insurance: 'stability',
  other: 'other',
};

function isInvestmentCategoryKey(value) {
  return typeof value === 'string' && CATEGORY_KEYS.includes(value);
}

function normalizeInvestmentCategory(category, accountType) {
  if (accountType === 'real_estate') {
    return 'illiquid';
  }

  if (isInvestmentCategoryKey(category)) {
    return category;
  }

  const fallbackCategory = ACCOUNT_TYPE_CATEGORY[accountType];
  return isInvestmentCategoryKey(fallbackCategory) ? fallbackCategory : 'other';
}

function classifyInvestmentAccountType(accountType) {
  if (!Object.prototype.hasOwnProperty.call(ACCOUNT_TYPE_CATEGORY, accountType)) {
    return {
      isLiquid: null,
      investmentCategory: null,
    };
  }

  const investmentCategory = ACCOUNT_TYPE_CATEGORY[accountType];
  return {
    isLiquid: investmentCategory === 'cash' || investmentCategory === 'liquid',
    investmentCategory,
  };
}

module.exports = {
  ACCOUNT_TYPE_CATEGORY,
  CATEGORY_KEYS,
  classifyInvestmentAccountType,
  isInvestmentCategoryKey,
  normalizeInvestmentCategory,
};

module.exports.default = module.exports;
