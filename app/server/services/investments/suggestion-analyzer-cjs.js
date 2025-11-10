/**
 * Investment Account Suggestion Analyzer (CommonJS version for Electron)
 * Intelligently parses transaction descriptions to suggest investment account creation
 */

const database = require('../database.js');
const { ACCOUNT_PATTERNS } = require('../../../config/investment-patterns-cjs.js');

/**
 * Known Israeli financial institutions for extraction
 */
const INSTITUTIONS = {
  pension: ['מנורה', 'הפניקס', 'מגדל', 'כלל', 'הראל', 'הכשרה', 'אלטשולר', 'מיטב', 'אנליסט', 'אקסלנס',
            'manulife', 'phoenix', 'migdal', 'clal', 'harel', 'excellence', 'psagot'],
  provident: ['מנורה', 'הפניקס', 'מגדל', 'כלל', 'הראל', 'מיטב', 'אלטשולר',
              'manulife', 'phoenix', 'migdal', 'clal', 'harel', 'meitav'],
  study_fund: ['מנורה', 'הפניקס', 'מגדל', 'כלל', 'הראל', 'מיטב',
               'manulife', 'phoenix', 'migdal', 'clal', 'harel'],
  brokerage: ['interactive brokers', 'ib', 'etoro', 'trade station', 'פסגות', 'אקסלנס',
              'excellence', 'psagot', 'leader', 'לידר'],
  crypto: ['bits of gold', 'kraken', 'coinbase', 'binance', 'bit2c'],
  savings: ['בנק הפועלים', 'בנק לאומי', 'בנק מזרחי', 'בנק דיסקונט', 'בנק מרכנתיל',
            'hapoalim', 'leumi', 'mizrahi', 'discount', 'mercantile']
};

/**
 * Calculate confidence score for account type detection
 */
function calculateConfidence(description, accountType) {
  const lowerDesc = description.toLowerCase();
  const patterns = ACCOUNT_PATTERNS[accountType];

  if (!patterns) return 0;

  let score = 0;
  let maxScore = 0;

  // Keyword matches are worth more
  const keywords = patterns.keywords || [];
  maxScore += keywords.length * 2;
  keywords.forEach(keyword => {
    if (lowerDesc.includes(keyword.toLowerCase())) {
      score += 2;
    }
  });

  // Hebrew pattern matches
  const hebrewPatterns = patterns.hebrew || [];
  maxScore += hebrewPatterns.length;
  hebrewPatterns.forEach(pattern => {
    if (lowerDesc.includes(pattern.toLowerCase())) {
      score += 1;
    }
  });

  // English pattern matches
  const englishPatterns = patterns.english || [];
  maxScore += englishPatterns.length;
  englishPatterns.forEach(pattern => {
    if (lowerDesc.includes(pattern.toLowerCase())) {
      score += 1;
    }
  });

  // Normalize to 0-1 range
  const confidence = maxScore > 0 ? (score / maxScore) : 0;

  // Boost confidence if exact keyword match
  const hasExactKeyword = keywords.some(kw => lowerDesc === kw.toLowerCase());
  return hasExactKeyword ? Math.min(confidence + 0.2, 1.0) : confidence;
}

/**
 * Extract institution name from transaction description
 */
function extractInstitution(description, accountType) {
  const lowerDesc = description.toLowerCase();
  const institutions = INSTITUTIONS[accountType] || [];

  for (const institution of institutions) {
    if (lowerDesc.includes(institution.toLowerCase())) {
      // Return capitalized version
      return institution.charAt(0).toUpperCase() + institution.slice(1);
    }
  }

  return null;
}

/**
 * Get Hebrew label for account type
 */
function getAccountTypeLabel(accountType) {
  const labels = {
    pension: 'קרן פנסיה',
    provident: 'קרן השתלמות',
    study_fund: 'קופת גמל לחינוך',
    brokerage: 'חשבון ברוקר',
    crypto: 'מטבעות דיגיטליים',
    savings: 'חשבון חיסכון',
    mutual_fund: 'קרנות נאמנות',
    bonds: 'אג"ח',
    real_estate: 'נדל"ן',
    other: 'השקעות אחרות'
  };

  return labels[accountType] || accountType;
}

/**
 * Extract clean account name from transaction description
 */
function extractAccountName(description, accountType, institution) {
  let cleaned = description.trim();

  // Remove common transaction prefixes in Hebrew
  const prefixesToRemove = [
    'העברה ל',
    'העברה מ',
    'הפקדה ל',
    'משיכה מ',
    'חיוב ',
    'זיכוי ',
    'transfer to ',
    'transfer from ',
    'payment to ',
    'from '
  ];

  for (const prefix of prefixesToRemove) {
    const regex = new RegExp(`^${prefix}`, 'i');
    cleaned = cleaned.replace(regex, '');
  }

  // Remove common suffixes
  const suffixesToRemove = [
    ' - חיוב',
    ' - זיכוי',
    ' חשבון',
    ' account'
  ];

  for (const suffix of suffixesToRemove) {
    const regex = new RegExp(`${suffix}$`, 'i');
    cleaned = cleaned.replace(regex, '');
  }

  // Trim extra whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // If we have an institution, combine with account type
  if (institution) {
    return `${getAccountTypeLabel(accountType)} - ${institution}`;
  }

  // Otherwise return cleaned description (max 50 chars)
  return cleaned.length > 50 ? cleaned.substring(0, 47) + '...' : cleaned;
}

/**
 * Detect account type from transaction description
 */
function detectAccountType(description) {
  if (!description) return null;

  const lowerDesc = description.toLowerCase();
  let bestMatch = null;
  let bestConfidence = 0;
  let bestReason = '';

  // Try each account type
  for (const [accountType, patterns] of Object.entries(ACCOUNT_PATTERNS)) {
    const confidence = calculateConfidence(description, accountType);

    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestMatch = accountType;

      // Determine match reason
      const matchedKeywords = (patterns.keywords || []).filter(kw =>
        lowerDesc.includes(kw.toLowerCase())
      );

      if (matchedKeywords.length > 0) {
        bestReason = `Matched keywords: ${matchedKeywords.join(', ')}`;
      } else {
        bestReason = `Matched pattern for ${accountType}`;
      }
    }
  }

  // REMOVED confidence threshold - return best match even if low confidence
  if (bestMatch) {
    return {
      accountType: bestMatch,
      confidence: bestConfidence,
      matchReason: bestReason
    };
  }

  return null;
}

/**
 * Analyze a single transaction for investment account suggestion
 * Now uses the actual category from database instead of only pattern matching
 */
function analyzeTransaction(transaction) {
  const detection = detectAccountType(transaction.description);

  // Use pattern detection if available, otherwise use the category from database
  let accountType, institution, accountName, confidence, matchReason;

  if (detection) {
    accountType = detection.accountType;
    institution = extractInstitution(transaction.description, detection.accountType);
    accountName = extractAccountName(transaction.description, detection.accountType, institution);
    confidence = detection.confidence;
    matchReason = detection.matchReason;
  } else {
    // Fallback: use the category name from database
    accountType = 'other';
    institution = null;
    accountName = transaction.category_name || transaction.description.substring(0, 50);
    confidence = 0.5; // Medium confidence when using database category
    matchReason = `Category: ${transaction.category_name}`;
  }

  return {
    transactionIdentifier: transaction.identifier,
    transactionVendor: transaction.vendor,
    transactionName: transaction.description,
    transactionDate: transaction.date,
    transactionAmount: transaction.price,
    categoryName: transaction.category_name, // Add actual category from DB
    suggestedAccountType: accountType,
    suggestedInstitution: institution,
    suggestedAccountName: accountName,
    confidence: confidence,
    matchReason: matchReason
  };
}

/**
 * Get all investment-categorized transactions without linked accounts
 */
async function getUnlinkedInvestmentTransactions(thresholdDays = 90) {
  const query = `
    SELECT
      t.identifier,
      t.vendor,
      t.name as description,
      t.date,
      t.price,
      cd.name as category_name,
      cd.category_type
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN transaction_account_links tal ON t.identifier = tal.transaction_identifier
      AND t.vendor = tal.transaction_vendor
    WHERE
      cd.category_type = 'investment'
      AND tal.id IS NULL
      AND date(t.date) >= date('now', '-' || $1 || ' days')
    ORDER BY t.date DESC
  `;

  const result = await database.query(query, [thresholdDays]);
  return result.rows;
}

/**
 * Group transactions by category name from database
 * This shows ALL unlinked investment transactions grouped by their actual category
 */
function groupSuggestionsByAccount(suggestions) {
  const groups = new Map();

  for (const suggestion of suggestions) {
    // Group by actual category name from database, not pattern-detected type
    const groupKey = suggestion.categoryName || 'Unknown';

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        categoryName: suggestion.categoryName,
        suggestedAccountType: suggestion.suggestedAccountType,
        suggestedInstitution: suggestion.suggestedInstitution,
        suggestedAccountName: suggestion.categoryName || suggestion.suggestedAccountName,
        avgConfidence: 0,
        transactions: [],
        totalAmount: 0,
        transactionCount: 0,
        dateRange: { earliest: suggestion.transactionDate, latest: suggestion.transactionDate }
      });
    }

    const group = groups.get(groupKey);
    group.transactions.push(suggestion);
    group.transactionCount++;
    group.totalAmount += Math.abs(suggestion.transactionAmount || 0);

    // Update date range
    if (suggestion.transactionDate < group.dateRange.earliest) {
      group.dateRange.earliest = suggestion.transactionDate;
    }
    if (suggestion.transactionDate > group.dateRange.latest) {
      group.dateRange.latest = suggestion.transactionDate;
    }

    // Calculate average confidence
    const confidenceSum = group.transactions.reduce((sum, t) => sum + (t.confidence || 0), 0);
    group.avgConfidence = confidenceSum / group.transactions.length;
  }

  // Convert map to array and sort by transaction count (most transactions first)
  return Array.from(groups.values()).sort((a, b) => b.transactionCount - a.transactionCount);
}

/**
 * Main function: Analyze all unlinked investment transactions
 * Returns ALL unlinked transactions grouped by their database category
 */
async function analyzeInvestmentTransactions(thresholdDays = 90) {
  const transactions = await getUnlinkedInvestmentTransactions(thresholdDays);

  console.log(`Found ${transactions.length} unlinked investment txns`);

  if (transactions.length === 0) {
    return [];
  }

  // Analyze each transaction - ALL transactions are now included
  const suggestions = transactions.map(analyzeTransaction);

  // Group by database category name
  const grouped = groupSuggestionsByAccount(suggestions);

  console.log(`Created ${grouped.length} suggestion groups`);

  return grouped;
}

module.exports = {
  analyzeInvestmentTransactions,
  getUnlinkedInvestmentTransactions,
  detectAccountType,
  analyzeTransaction
};
