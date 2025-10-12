// Credit card vendors
export const CREDIT_CARD_VENDORS = ['visaCal', 'max', 'isracard', 'amex'];

// Bank vendors (excluding discount/mercantile which have special requirements)
export const BANK_VENDORS = ['hapoalim', 'leumi', 'mizrahi', 'otsarHahayal', 'beinleumi', 'massad', 'yahav', 'union'];

// Special bank vendors that use id + num + password (like credit cards but with num)
export const SPECIAL_BANK_VENDORS = ['discount', 'mercantile'];

// All vendors
export const ALL_VENDORS = [...CREDIT_CARD_VENDORS, ...BANK_VENDORS, ...SPECIAL_BANK_VENDORS]; 