// Credit card vendors
export const CREDIT_CARD_VENDORS = ['visaCal', 'max', 'isracard', 'amex'];

// Bank vendors (excluding discount/mercantile which have special requirements)
export const BANK_VENDORS = ['hapoalim', 'leumi', 'mizrahi', 'otsarHahayal', 'beinleumi', 'massad', 'yahav', 'union'];

// Special bank vendors that use id + num + password (like credit cards but with num)
export const SPECIAL_BANK_VENDORS = ['discount', 'mercantile'];

// All vendors
export const ALL_VENDORS = [...CREDIT_CARD_VENDORS, ...BANK_VENDORS, ...SPECIAL_BANK_VENDORS];

// Sync threshold - accounts not synced in this time are considered stale
export const STALE_SYNC_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

// Unified Account Type Taxonomy for enhanced AccountsModal
// Updated with website color palette (primary green and secondary peach)
export const ACCOUNT_CATEGORIES = {
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
export const INVESTMENT_ACCOUNT_TYPES = [
  { value: 'pension', label: 'Pension Fund', label_he: 'קרן פנסיה', category: 'restricted' },
  { value: 'provident', label: 'Provident Fund', label_he: 'קרן השתלמות', category: 'restricted' },
  { value: 'study_fund', label: 'Study Fund', label_he: 'קופת גמל', category: 'restricted' },
  { value: 'savings', label: 'Savings', label_he: 'פיקדון', category: 'liquid' },
  { value: 'brokerage', label: 'Brokerage', label_he: 'ברוקר', category: 'liquid' },
  { value: 'crypto', label: 'Crypto', label_he: 'קריפטו', category: 'liquid' },
  { value: 'mutual_fund', label: 'Mutual Funds', label_he: 'קרנות נאמנות', category: 'liquid' },
  { value: 'bonds', label: 'Bonds', label_he: 'אג"ח', category: 'alternative' },
  { value: 'real_estate', label: 'Real Estate', label_he: 'נדל"ן', category: 'alternative' },
  { value: 'cash', label: 'Cash', label_he: 'מזומן', category: 'other' },
  { value: 'foreign_bank', label: 'Foreign Bank', label_he: 'בנק חוץ', category: 'other' },
  { value: 'foreign_investment', label: 'Foreign Investment', label_he: 'השקעה חוץ', category: 'other' },
  { value: 'other', label: 'Other', label_he: 'אחר', category: 'alternative' },
];

// Helper functions
export const getAccountCategory = (accountType) => {
  if (CREDIT_CARD_VENDORS.includes(accountType)) return 'banking';
  if (BANK_VENDORS.includes(accountType) || SPECIAL_BANK_VENDORS.includes(accountType)) return 'banking';

  const investmentType = INVESTMENT_ACCOUNT_TYPES.find(type => type.value === accountType);
  if (investmentType) {
    if (investmentType.category === 'other') return 'other';
    return 'investments';
  }

  return 'other';
};

export const getAccountSubcategory = (accountType) => {
  if (CREDIT_CARD_VENDORS.includes(accountType)) return 'credit';
  if (BANK_VENDORS.includes(accountType) || SPECIAL_BANK_VENDORS.includes(accountType)) return 'bank';

  const investmentType = INVESTMENT_ACCOUNT_TYPES.find(type => type.value === accountType);
  if (investmentType) return investmentType.category;

  return 'cash';
}; 