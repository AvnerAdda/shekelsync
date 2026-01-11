const database = require('../database.js');
const { getCreditCardRepaymentCategoryCondition } = require('./repayment-category.js');

// Keywords for credit card matching - includes Hebrew and English variants
const VENDOR_KEYWORDS = {
  max: ['מקס', 'max'],
  visaCal: ['כ.א.ל', 'cal', 'ויזה כאל', 'visa cal'],
  isracard: ['ישראכרט', 'isracard'],
  amex: ['אמקס', 'אמריקן אקספרס', 'amex', 'american express'],
  leumi: ['לאומי כרט', 'leumi card'],
  diners: ['דיינרס', 'diners'],
};

/**
 * Extract search patterns from credit card information
 */
function extractSearchPatterns(params) {
  const patterns = [];

  // Add nickname words if available
  if (params.nickname) {
    const words = params.nickname.split(/\s+/).filter(w => w.length > 2);
    patterns.push(...words);
  }

  // Add card number patterns
  if (params.creditCardAccountNumber && params.creditCardAccountNumber !== 'undefined') {
    patterns.push(params.creditCardAccountNumber);
    // Also add last 4 digits if longer than 4
    if (params.creditCardAccountNumber.length > 4) {
      patterns.push(params.creditCardAccountNumber.slice(-4));
    }
  }

  // Add card6_digits patterns
  if (params.card6_digits) {
    const digits = params.card6_digits.split(';').filter(Boolean);
    digits.forEach(d => {
      const trimmed = d.trim();
      patterns.push(trimmed);
      if (trimmed.length > 4) {
        patterns.push(trimmed.slice(-4));
      }
    });
  }

  // Add vendor-specific keywords
  const vendorKeywords = VENDOR_KEYWORDS[params.creditCardVendor] || [];
  patterns.push(...vendorKeywords);

  // Remove duplicates and empty strings
  return [...new Set(patterns)].filter(p => p && p.length > 0);
}

/**
 * Smart match: Find bank transactions likely related to credit card settlements
 */
async function findSmartMatches(params = {}) {
  const {
    creditCardVendor,
    creditCardAccountNumber,
    bankVendor,
    bankAccountNumber,
    nickname,
    card6_digits,
  } = params;

  if (!creditCardVendor || !bankVendor) {
    const error = new Error('creditCardVendor and bankVendor are required');
    error.status = 400;
    throw error;
  }

  const client = await database.getClient();

  try {
    const repaymentCategoryCondition = getCreditCardRepaymentCategoryCondition('cd');

    // Extract all possible search patterns
    const searchPatterns = extractSearchPatterns({
      creditCardVendor,
      creditCardAccountNumber,
      nickname,
      card6_digits,
    });

    if (searchPatterns.length === 0) {
      return {
        matches: [],
        patterns: [],
        searchPatterns: [],
      };
    }

    // Build dynamic query with multiple LIKE conditions on transaction name
    const nameConditions = searchPatterns.map(
      (_, idx) => `LOWER(t.name) LIKE '%' || LOWER($${idx + 2}) || '%'`
    );

    // Also match on vendor_nickname if nickname is provided
    const vendorNicknameCondition = nickname
      ? `OR t.vendor_nickname = $${searchPatterns.length + 2}`
      : '';

    let query = `
      SELECT
        t.identifier,
        t.vendor,
        t.vendor_nickname,
        t.date,
        t.name,
        t.price,
        t.category_definition_id,
        t.account_number,
        cd.name AS category_name,
        CASE WHEN ${repaymentCategoryCondition} THEN 1 ELSE 0 END as is_repayment,
        COALESCE(fi_cred.id, fi_vendor.id) as institution_id,
        COALESCE(fi_cred.vendor_code, fi_vendor.vendor_code, t.vendor) as institution_vendor_code,
        COALESCE(fi_cred.display_name_he, fi_vendor.display_name_he, t.vendor) as institution_name_he,
        COALESCE(fi_cred.display_name_en, fi_vendor.display_name_en, t.vendor) as institution_name_en,
        COALESCE(fi_cred.logo_url, fi_vendor.logo_url) as institution_logo,
        COALESCE(fi_cred.institution_type, fi_vendor.institution_type) as institution_type
      FROM transactions t
      LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
      LEFT JOIN vendor_credentials vc ON t.vendor = vc.vendor
      LEFT JOIN institution_nodes fi_cred ON vc.institution_id = fi_cred.id AND fi_cred.node_type = 'institution'
      LEFT JOIN institution_nodes fi_vendor ON t.vendor = fi_vendor.vendor_code AND fi_vendor.node_type = 'institution'
      WHERE t.vendor = $1
        AND ((${nameConditions.join(' OR ')}) ${vendorNicknameCondition})
    `;

    const queryParams = [bankVendor, ...searchPatterns];

    // Add nickname parameter if vendor_nickname condition was added
    if (nickname) {
      queryParams.push(nickname);
    }

    if (bankAccountNumber && bankAccountNumber !== 'undefined') {
      queryParams.push(bankAccountNumber);
      query += ` AND t.account_number = $${queryParams.length}`;
    }

    query += ' ORDER BY t.date DESC LIMIT 100';

    const result = await client.query(query, queryParams);

    // Calculate confidence scores for each match
    const matches = result.rows.map((row) => {
      const nameLower = (row.name || '').toLowerCase();
      let confidence = 0;
      const matchedPatterns = [];

      // Boost confidence significantly if vendor_nickname matches exactly
      if (nickname && row.vendor_nickname === nickname) {
        confidence += 5;
        matchedPatterns.push(`vendor_nickname: ${nickname}`);
      }

      searchPatterns.forEach((pattern) => {
        if (nameLower.includes(pattern.toLowerCase())) {
          matchedPatterns.push(pattern);
          // Higher confidence for longer patterns (likely more specific)
          confidence += pattern.length > 4 ? 2 : 1;
        }
      });

      // Boost confidence for settlement categories
      if (row.is_repayment) {
        confidence += 3;
      }

      const institution = row.institution_id ? {
        id: row.institution_id,
        vendor_code: row.institution_vendor_code,
        display_name_he: row.institution_name_he,
        display_name_en: row.institution_name_en,
        logo_url: row.institution_logo,
        institution_type: row.institution_type,
      } : null;

      return {
        identifier: row.identifier,
        vendor: row.vendor,
        vendorNickname: row.vendor_nickname,
        date: row.date,
        name: row.name,
        price: row.price,
        categoryId: row.category_definition_id,
        categoryName: row.category_name,
        accountNumber: row.account_number,
        confidence,
        matchedPatterns,
        institution,
      };
    });

    // Sort by confidence (highest first)
    matches.sort((a, b) => b.confidence - a.confidence);

    // Extract unique patterns found in matches
    const foundPatterns = [...new Set(matches.flatMap(m => m.matchedPatterns))];

    return {
      matches,
      patterns: foundPatterns,
      searchPatterns,
    };
  } finally {
    client.release();
  }
}

module.exports = {
  findSmartMatches,
};

module.exports.default = module.exports;
