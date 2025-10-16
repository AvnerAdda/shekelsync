/**
 * Central registry of investment account patterns
 * Used for matching account names to transaction descriptions
 */

export const ACCOUNT_PATTERNS = {
  savings: {
    hebrew: [
      'פיקדון',
      'הפקדה לפיקדון',
      'פירעון פיקדון',
      'רווח מפיקדון',
      'חיוב מס בפרעון פיקדון',
      'פיקדון מפתח',
      'פיקדון חודשי',
      'פיקדון קבוע',
      'פיקדון נזיל'
    ],
    english: [
      'pikadon',
      'deposit',
      'fixed deposit',
      'time deposit',
      'cd account'
    ],
    keywords: ['פיקדון', 'pikadon', 'deposit']
  },
  
  study_fund: {
    hebrew: [
      'קופת גמל',
      'קופ"ג',
      'קופת גמל ל חיוב',
      'גמל להשקעה',
      'גמל לקצבה'
    ],
    english: [
      'koupat guemel',
      'koupat gemel',
      'kupat gemel',
      'study fund',
      'gemel'
    ],
    keywords: ['קופת גמל', 'גמל', 'gemel', 'koupat']
  },
  
  provident: {
    hebrew: [
      'קרן השתלמות',
      'קרן',
      'קה"ש',
      'השתלמות'
    ],
    english: [
      'keren hishtalmut',
      'provident fund',
      'hishtalmut',
      'keren'
    ],
    keywords: ['קרן השתלמות', 'השתלמות', 'hishtalmut']
  },
  
  pension: {
    hebrew: [
      'פנסיה',
      'קרן פנסיה',
      'פנסיה משלימה',
      'פנסיה חובה'
    ],
    english: [
      'pension',
      'pension fund',
      'retirement'
    ],
    keywords: ['פנסיה', 'pension']
  },
  
  brokerage: {
    hebrew: [
      'ברוקר',
      'תיק ניירות ערך',
      'מניות'
    ],
    english: [
      'interactive brokers',
      'interactive',
      'ib',
      'broker',
      'brokerage',
      'trading account',
      'etoro',
      'trade station'
    ],
    keywords: ['interactive', 'ib', 'broker', 'ברוקר']
  },
  
  crypto: {
    hebrew: [
      'קריפטו',
      'ביטקוין',
      'מטבע דיגיטלי'
    ],
    english: [
      'bits of gold',
      'crypto',
      'cryptocurrency',
      'bitcoin',
      'ethereum',
      'kraken',
      'coinbase',
      'binance'
    ],
    keywords: ['bits of gold', 'crypto', 'קריפטו', 'bitcoin']
  },
  
  mutual_fund: {
    hebrew: [
      'קרן נאמנות',
      'קרנות',
      'תעודת סל'
    ],
    english: [
      'mutual fund',
      'etf',
      'index fund'
    ],
    keywords: ['קרן נאמנות', 'mutual fund', 'etf']
  }
};

/**
 * Get all patterns for a specific account type
 */
export function getPatternsForType(accountType) {
  const patterns = ACCOUNT_PATTERNS[accountType];
  if (!patterns) return [];
  
  return [
    ...(patterns.hebrew || []),
    ...(patterns.english || []),
  ];
}

/**
 * Get only keywords (most important patterns) for an account type
 */
export function getKeywordsForType(accountType) {
  return ACCOUNT_PATTERNS[accountType]?.keywords || [];
}

/**
 * Get all patterns across all account types (for fuzzy search)
 */
export function getAllPatterns() {
  const all = [];
  for (const [type, patterns] of Object.entries(ACCOUNT_PATTERNS)) {
    all.push(...getPatternsForType(type).map(p => ({ pattern: p, type })));
  }
  return all;
}
