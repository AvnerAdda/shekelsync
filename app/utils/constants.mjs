// ES6 module wrapper for constants.js (CommonJS)
// This file re-exports the CommonJS module as ES6 named exports
// Used by Vite/frontend, while backend uses constants.js directly

import constants from './constants.js';

export const {
  CREDIT_CARD_VENDORS,
  BANK_VENDORS,
  SPECIAL_BANK_VENDORS,
  OTHER_BANK_VENDORS,
  ALL_VENDORS,
  STALE_SYNC_THRESHOLD_MS,
  ACCOUNT_CATEGORIES,
  INVESTMENT_ACCOUNT_TYPES,
  getAccountCategory,
  getAccountSubcategory,
  getInstitutionByVendorCode,
  getInstitutionById,
  getInstitutionsByType,
  getInstitutionsByCategory,
  getScrapableInstitutions,
  getAllInstitutions,
} = constants;

// Re-export the default export as well
export default constants;
