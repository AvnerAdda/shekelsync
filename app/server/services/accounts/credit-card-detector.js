const database = require('../database.js');

// Credit card vendor keywords for detection (Hebrew and English)
const VENDOR_KEYWORDS = {
  visaCal: ['כ.א.ל', 'cal', 'ויזה כאל', 'visa cal'],
  max: ['מקס', 'max'],
  isracard: ['ישראכרט', 'isracard'],
  amex: ['אמקס', 'אמריקן אקספרס', 'amex', 'american express'],
  leumi: ['לאומי כרט', 'leumi card'],
  diners: ['דיינרס', 'diners'],
};

// Vendor display labels
const VENDOR_LABELS = {
  visaCal: 'Visa Cal',
  max: 'Max',
  isracard: 'Isracard',
  amex: 'American Express',
  leumi: 'Leumi Card',
  diners: 'Diners',
};

/**
 * Extract potential last 4 digits from transaction name
 * @param {string} transactionName - Transaction description
 * @returns {string|null} - Last 4 digits found or null
 */
function extractCardNumber(transactionName) {
  if (!transactionName) return null;

  // Match 4-digit sequences (potential card numbers)
  const matches = transactionName.match(/\d{4}/g);

  // Return the last occurrence (usually the card number)
  return matches && matches.length > 0 ? matches[matches.length - 1] : null;
}

/**
 * Detect credit card vendor from transaction name
 * @param {string} transactionName - Transaction description
 * @returns {string|null} - Detected vendor code or null
 */
function detectVendorFromName(transactionName) {
  if (!transactionName) return null;

  const nameLower = transactionName.toLowerCase();

  for (const [vendor, keywords] of Object.entries(VENDOR_KEYWORDS)) {
    if (keywords.some(keyword => nameLower.includes(keyword.toLowerCase()))) {
      return vendor;
    }
  }

  return null;
}

/**
 * Calculate confidence score for a credit card suggestion
 * @param {object} params - Detection parameters
 * @returns {number} - Confidence score
 */
function calculateConfidence(params) {
  const {
    transactionCount = 0,
    hasCategoryMatch = false,
    hasKeywordMatch = false,
    hasCardNumber = false,
    uniqueKeywords = 0
  } = params;

  let score = 0;

  // Category match (ID 25 or 75) - strong signal
  if (hasCategoryMatch) {
    score += 3;
  }

  // Keyword match
  if (hasKeywordMatch) {
    score += uniqueKeywords; // 1 point per unique keyword matched
  }

  // Last 4 digits found
  if (hasCardNumber) {
    score += 2;
  }

  // Multiple transactions boost
  score += Math.min(Math.floor(transactionCount / 5), 5);

  return score;
}

/**
 * Detect credit card suggestions from bank transactions
 * @returns {Promise<object>} - Suggestions object with array of detected credit cards
 */
async function detectCreditCardSuggestions() {
  const client = await database.getClient();

  try {
    // Build keyword conditions for SQL query
    const allKeywords = Object.values(VENDOR_KEYWORDS).flat();
    const keywordConditions = allKeywords.map(
      (_, idx) => `LOWER(t.name) LIKE '%' || LOWER($${idx + 1}) || '%'`
    ).join(' OR ');

    const query = `
      SELECT
        t.identifier,
        t.vendor,
        t.name,
        t.price,
        t.date,
        t.category_definition_id,
        cd.name AS category_name
      FROM transactions t
      LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
      WHERE (
        t.category_definition_id IN (25, 75)
        OR (${keywordConditions})
      )
      ORDER BY t.date DESC
      LIMIT 500
    `;

    const result = await client.query(query, allKeywords);

    // Group transactions by detected vendor
    const vendorGroups = {};

    result.rows.forEach((row) => {
      const detectedVendor = detectVendorFromName(row.name);

      if (!detectedVendor) return; // Skip if no vendor detected

      if (!vendorGroups[detectedVendor]) {
        vendorGroups[detectedVendor] = {
          vendor: detectedVendor,
          vendorLabel: VENDOR_LABELS[detectedVendor] || detectedVendor,
          transactions: [],
          lastFourDigits: new Set(),
          matchedKeywords: new Set(),
          hasCategoryMatch: false,
        };
      }

      const group = vendorGroups[detectedVendor];

      // Add transaction
      group.transactions.push({
        name: row.name,
        price: row.price,
        date: row.date,
        categoryId: row.category_definition_id,
        categoryName: row.category_name,
      });

      // Extract last 4 digits
      const cardNumber = extractCardNumber(row.name);
      if (cardNumber) {
        group.lastFourDigits.add(cardNumber);
      }

      // Track matched keywords
      const nameLower = row.name.toLowerCase();
      VENDOR_KEYWORDS[detectedVendor].forEach(keyword => {
        if (nameLower.includes(keyword.toLowerCase())) {
          group.matchedKeywords.add(keyword);
        }
      });

      // Check for category match
      if (row.category_definition_id === 25 || row.category_definition_id === 75) {
        group.hasCategoryMatch = true;
      }
    });

    // Build suggestions array - one suggestion per card number
    const suggestions = [];

    Object.values(vendorGroups).forEach(group => {
      if (group.lastFourDigits.size === 0) {
        // No card numbers detected, create one suggestion for the vendor
        const transactionCount = group.transactions.length;
        const sampleTransactions = group.transactions.slice(0, 2).map(t => t.name);

        const confidence = calculateConfidence({
          transactionCount,
          hasCategoryMatch: group.hasCategoryMatch,
          hasKeywordMatch: group.matchedKeywords.size > 0,
          hasCardNumber: false,
          uniqueKeywords: group.matchedKeywords.size,
        });

        let detectionMethod = 'unknown';
        if (group.hasCategoryMatch && group.matchedKeywords.size > 0) {
          detectionMethod = 'keyword_and_category';
        } else if (group.hasCategoryMatch) {
          detectionMethod = 'category';
        } else if (group.matchedKeywords.size > 0) {
          detectionMethod = 'keyword';
        }

        suggestions.push({
          vendor: group.vendor,
          vendorLabel: group.vendorLabel,
          lastFourDigits: null,
          transactionCount,
          sampleTransactions,
          confidence,
          detectionMethod,
        });
      } else {
        // Create one suggestion per detected card number
        Array.from(group.lastFourDigits).forEach(cardNumber => {
          // Filter transactions that contain this specific card number
          const cardTransactions = group.transactions.filter(t =>
            t.name.includes(cardNumber)
          );
          const transactionCount = cardTransactions.length;
          const sampleTransactions = cardTransactions.slice(0, 2).map(t => t.name);

          const confidence = calculateConfidence({
            transactionCount,
            hasCategoryMatch: group.hasCategoryMatch,
            hasKeywordMatch: group.matchedKeywords.size > 0,
            hasCardNumber: true,
            uniqueKeywords: group.matchedKeywords.size,
          });

          let detectionMethod = 'unknown';
          if (group.hasCategoryMatch && group.matchedKeywords.size > 0) {
            detectionMethod = 'keyword_and_category';
          } else if (group.hasCategoryMatch) {
            detectionMethod = 'category';
          } else if (group.matchedKeywords.size > 0) {
            detectionMethod = 'keyword';
          }

          suggestions.push({
            vendor: group.vendor,
            vendorLabel: group.vendorLabel,
            lastFourDigits: cardNumber,
            transactionCount,
            sampleTransactions,
            confidence,
            detectionMethod,
          });
        });
      }
    });

    // Filter by low threshold (1+) and sort by confidence
    const filteredSuggestions = suggestions
      .filter(s => s.confidence >= 1)
      .sort((a, b) => b.confidence - a.confidence);

    return {
      suggestions: filteredSuggestions,
      totalSuggestions: filteredSuggestions.length,
    };
  } finally {
    client.release();
  }
}

module.exports = {
  detectCreditCardSuggestions,
  extractCardNumber,
  detectVendorFromName,
  calculateConfidence,
};

module.exports.default = module.exports;
