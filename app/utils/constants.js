// Credit card vendors
const CREDIT_CARD_VENDORS = ['visaCal', 'max', 'isracard', 'amex'];

// Bank vendors (excluding discount/mercantile which have special requirements)
const BANK_VENDORS = ['hapoalim', 'leumi', 'mizrahi', 'otsarHahayal', 'beinleumi', 'massad', 'yahav', 'union'];

// Special bank vendors that use id + num + password (like credit cards but with num)
const SPECIAL_BANK_VENDORS = ['discount', 'mercantile'];

// Other bank vendors with unique authentication
const OTHER_BANK_VENDORS = ['beyahadBishvilha', 'behatsdaa', 'pagi', 'oneZero'];

// All vendors
const ALL_VENDORS = [...CREDIT_CARD_VENDORS, ...BANK_VENDORS, ...SPECIAL_BANK_VENDORS, ...OTHER_BANK_VENDORS];

// Sync threshold - accounts not synced in this time are considered stale
const STALE_SYNC_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

// Rate limit - prevent scraping the same credential more than once per 24 hours
const SCRAPE_RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours
const SCRAPE_RATE_LIMIT_MAX_ATTEMPTS = 2;

// Unified Account Type Taxonomy for enhanced AccountsModal
// Updated with website color palette (primary green and secondary peach)
const ACCOUNT_CATEGORIES = {
  BANKING: {
    id: 'banking',
    label: 'Banking & Transactions',
    label_he: 'בנקאות ועסקאות',
    description: 'Accounts with automatic transaction scraping',
    icon: 'AccountBalance',
    color: '#c8facf',
    subcategories: {
      BANK: {
        id: 'bank',
        label: 'Bank Accounts',
        label_he: 'חשבונות בנק',
        icon: 'AccountBalance',
        color: '#c8facf',
        vendors: BANK_VENDORS.concat(SPECIAL_BANK_VENDORS)
      },
      CREDIT: {
        id: 'credit',
        label: 'Credit Cards',
        label_he: 'כרטיסי אשראי',
        icon: 'CreditCard',
        color: '#9cf5aa',
        vendors: CREDIT_CARD_VENDORS
      }
    }
  },
  INVESTMENTS: {
    id: 'investments',
    label: 'Investments & Savings',
    label_he: 'השקעות וחסכונות',
    description: 'Manually tracked investment and savings accounts',
    icon: 'TrendingUp',
    color: '#78e88b',
    subcategories: {
      LIQUID: {
        id: 'liquid',
        label: 'Liquid Investments',
        label_he: 'השקעות נזילות',
        icon: 'TrendingUp',
        color: '#b5f8bf',
        types: ['brokerage', 'crypto', 'mutual_fund', 'savings']
      },
      RESTRICTED: {
        id: 'restricted',
        label: 'Long-term Savings',
        label_he: 'חסכונות לטווח ארוך',
        icon: 'Lock',
        color: '#54d96c',
        types: ['pension', 'provident', 'study_fund']
      },
      STABILITY: {
        id: 'stability',
        label: 'Insurance & Stability',
        label_he: 'ביטוח ויציבות',
        icon: 'Security',
        color: '#ffd3a8',
        types: ['insurance']
      },
      ALTERNATIVE: {
        id: 'alternative',
        label: 'Alternative Assets',
        label_he: 'נכסים אלטרנטיביים',
        icon: 'Business',
        color: '#facfc8',
        types: ['bonds', 'real_estate', 'other']
      }
    }
  },
  OTHER: {
    id: 'other',
    label: 'Cash & Other',
    label_he: 'מזומן ואחר',
    description: 'Cash, foreign accounts, and other assets',
    icon: 'AttachMoney',
    color: '#d3d3d3',
    subcategories: {
      CASH: {
        id: 'cash',
        label: 'Cash & Foreign',
        label_he: 'מזומן וחוץ לארץ',
        icon: 'AttachMoney',
        color: '#d3d3d3',
        types: ['cash', 'foreign_bank', 'foreign_investment']
      }
    }
  }
};

// Investment account types (from PortfolioSetupModal)
const INVESTMENT_ACCOUNT_TYPES = [
  { value: 'pension', label: 'Pension Fund', label_he: 'קרן פנסיה', category: 'restricted' },
  { value: 'provident', label: 'Provident Fund', label_he: 'קרן השתלמות', category: 'restricted' },
  { value: 'study_fund', label: 'Study Fund', label_he: 'קופת גמל', category: 'restricted' },
  { value: 'savings', label: 'Savings', label_he: 'פיקדון', category: 'liquid' },
  { value: 'brokerage', label: 'Brokerage', label_he: 'ברוקר', category: 'liquid' },
  { value: 'crypto', label: 'Crypto', label_he: 'קריפטו', category: 'liquid' },
  { value: 'mutual_fund', label: 'Mutual Funds', label_he: 'קרנות נאמנות', category: 'liquid' },
  { value: 'bonds', label: 'Bonds', label_he: 'אג"ח', category: 'alternative' },
  { value: 'real_estate', label: 'Real Estate', label_he: 'נדל"ן', category: 'alternative' },
  { value: 'insurance', label: 'Insurance', label_he: 'ביטוח', category: 'stability' },
  { value: 'bank_balance', label: 'Bank Balance', label_he: 'יתרת בנק', category: 'other' },
  { value: 'cash', label: 'Cash', label_he: 'מזומן', category: 'other' },
  { value: 'foreign_bank', label: 'Foreign Bank', label_he: 'בנק חוץ', category: 'other' },
  { value: 'foreign_investment', label: 'Foreign Investment', label_he: 'השקעה חוץ', category: 'other' },
  { value: 'other', label: 'Other', label_he: 'אחר', category: 'alternative' },
];

// Helper functions
const getAccountCategory = (accountType) => {
  if (CREDIT_CARD_VENDORS.includes(accountType)) return 'banking';
  if (BANK_VENDORS.includes(accountType) || SPECIAL_BANK_VENDORS.includes(accountType)) return 'banking';

  const investmentType = INVESTMENT_ACCOUNT_TYPES.find(type => type.value === accountType);
  if (investmentType) {
    if (investmentType.category === 'other') return 'other';
    return 'investments';
  }

  return 'other';
};

const getAccountSubcategory = (accountType) => {
  if (CREDIT_CARD_VENDORS.includes(accountType)) return 'credit';
  if (BANK_VENDORS.includes(accountType) || SPECIAL_BANK_VENDORS.includes(accountType)) return 'bank';

  const investmentType = INVESTMENT_ACCOUNT_TYPES.find(type => type.value === accountType);
  if (investmentType) return investmentType.category;

  return 'cash';
};

// ========== FINANCIAL INSTITUTIONS HELPERS ==========
// These helpers work with the institution_nodes tree (leaves are institutions)

/**
 * Get institution by vendor code from database
 * @param {object} db - Database connection
 * @param {string} vendorCode - Vendor code (e.g., 'hapoalim', 'visaCal')
 * @returns {Promise<object|null>} Institution record or null
 */
async function getInstitutionByVendorCode(db, vendorCode) {
  try {
    const result = await db.query(
      `SELECT * FROM institution_nodes
        WHERE vendor_code = $1 AND is_active = 1 AND node_type = 'institution'`,
      [vendorCode]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('[getInstitutionByVendorCode] Error:', error);
    return null;
  }
}

/**
 * Get institution by ID from database
 * @param {object} db - Database connection
 * @param {number} institutionId - Institution ID
 * @returns {Promise<object|null>} Institution record or null
 */
async function getInstitutionById(db, institutionId) {
  try {
    const result = await db.query(
      `SELECT * FROM institution_nodes
        WHERE id = $1 AND node_type = 'institution'`,
      [institutionId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('[getInstitutionById] Error:', error);
    return null;
  }
}

/**
 * Get all institutions by type
 * @param {object} db - Database connection
 * @param {string} institutionType - Type filter ('bank', 'credit_card', 'investment', etc.)
 * @returns {Promise<array>} Array of institution records
 */
async function getInstitutionsByType(db, institutionType) {
  try {
    const result = await db.query(
      `SELECT * FROM institution_nodes
         WHERE institution_type = $1 AND is_active = 1 AND node_type = 'institution'
         ORDER BY display_order`,
      [institutionType]
    );
    return result.rows;
  } catch (error) {
    console.error('[getInstitutionsByType] Error:', error);
    return [];
  }
}

/**
 * Get all institutions by category
 * @param {object} db - Database connection
 * @param {string} category - Category filter ('banking', 'investments', 'insurance', etc.)
 * @returns {Promise<array>} Array of institution records
 */
async function getInstitutionsByCategory(db, category) {
  try {
    const result = await db.query(
      `SELECT * FROM institution_nodes
         WHERE category = $1 AND is_active = 1 AND node_type = 'institution'
         ORDER BY display_order`,
      [category]
    );
    return result.rows;
  } catch (error) {
    console.error('[getInstitutionsByCategory] Error:', error);
    return [];
  }
}

/**
 * Get all scrapable institutions
 * @param {object} db - Database connection
 * @returns {Promise<array>} Array of scrapable institution records
 */
async function getScrapableInstitutions(db) {
  try {
    const result = await db.query(
      `SELECT * FROM institution_nodes
         WHERE is_scrapable = 1 AND is_active = 1 AND node_type = 'institution'
         ORDER BY display_order`,
      []
    );
    return result.rows;
  } catch (error) {
    console.error('[getScrapableInstitutions] Error:', error);
    return [];
  }
}

/**
 * Get all active institutions
 * @param {object} db - Database connection
 * @returns {Promise<array>} Array of all active institution records
 */
async function getAllInstitutions(db) {
  try {
    const result = await db.query(
      `SELECT * FROM institution_nodes
         WHERE is_active = 1 AND node_type = 'institution'
         ORDER BY category, display_order`,
      []
    );
    return result.rows;
  } catch (error) {
    console.error('[getAllInstitutions] Error:', error);
    return [];
  }
}

/**
 * Get full institution tree (roots, groups, leaves) ordered by hierarchy_path.
 * Useful for grouped UI selectors.
 * @param {object} db - Database connection
 * @returns {Promise<array>} Array of institution node records
 */
async function getInstitutionTree(db) {
  try {
    const result = await db.query(
      `SELECT *
         FROM institution_nodes
        WHERE is_active = 1
        ORDER BY hierarchy_path`
    );
    return result.rows;
  } catch (error) {
    console.error('[getInstitutionTree] Error:', error);
    return [];
  }
}

// CommonJS exports for Node.js/Electron backend compatibility
module.exports = {
  CREDIT_CARD_VENDORS,
  BANK_VENDORS,
  SPECIAL_BANK_VENDORS,
  OTHER_BANK_VENDORS,
  ALL_VENDORS,
  STALE_SYNC_THRESHOLD_MS,
  SCRAPE_RATE_LIMIT_MS,
  SCRAPE_RATE_LIMIT_MAX_ATTEMPTS,
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
  getInstitutionTree,
};
