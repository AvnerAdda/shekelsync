const database = require('../database.js');
const pairingsService = require('./pairings.js');
const { getCreditCardRepaymentCategoryCondition } = require('./repayment-category.js');

const KEYWORDS = [
  'ויזה', 'visa',
  'כ.א.ל', 'cal',
  'מקס', 'max',
  'ישראכרט', 'isracard',
  'אמקס', 'אמריקן אקספרס', 'amex', 'american express',
  'לאומי כרט', 'leumi card',
  'דיינרס', 'diners',
  'hapoalim', 'leumi', 'mizrahi', 'discount',
  'otsarHahayal', 'beinleumi', 'massad', 'yahav', 'union',
];

function ensureRequired(value, name) {
  if (!value) {
    const error = new Error(`${name} is required`);
    error.status = 400;
    throw error;
  }
}

function matchesPairing(transaction, pairing) {
  if (transaction.vendor !== pairing.bankVendor) {
    return false;
  }

  if (pairing.bankAccountNumber && transaction.accountNumber !== pairing.bankAccountNumber) {
    return false;
  }

  if (!pairing.matchPatterns || pairing.matchPatterns.length === 0) {
    return false;
  }

  const txnNameLower = (transaction.name || '').toLowerCase();
  return pairing.matchPatterns.some((pattern) =>
    txnNameLower.includes(String(pattern || '').toLowerCase()),
  );
}

function filterWithActivePairings(transactions, activePairings) {
  if (!activePairings || activePairings.length === 0) {
    return transactions;
  }

  return transactions.filter((txn) => {
    const normalizedTxn = {
      vendor: txn.vendor,
      accountNumber: txn.account_number,
      name: txn.name,
    };

    const hasMatch = activePairings.some((pairing) =>
      matchesPairing(normalizedTxn, pairing),
    );

    return !hasMatch;
  });
}

async function findSettlementCandidates(params = {}) {
  ensureRequired(params.credit_card_account_number, 'credit_card_account_number');
  ensureRequired(params.bank_vendor, 'bank_vendor');

  const creditCardAccountNumber = params.credit_card_account_number;
  const bankVendor = params.bank_vendor;
  const bankAccountNumber = params.bank_account_number || null;

  const client = await database.getClient();

  try {
    const activePairings = await pairingsService.getActivePairings(client);
    const repaymentCategoryCondition = getCreditCardRepaymentCategoryCondition('cd');

    const keywordConditions = KEYWORDS.map(
      (_, idx) => `LOWER(t.name) LIKE '%' || LOWER($${idx + 3}) || '%'`,
    ).join(' OR ');

    let query = `
      SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.name,
        t.price,
        t.category_definition_id,
        t.account_number,
        cd.name AS category_name,
        cd.name_en AS category_name_en,
        COALESCE(fi_cred.id, fi_vendor.id) as institution_id,
        COALESCE(fi_cred.vendor_code, fi_vendor.vendor_code, t.vendor) as institution_vendor_code,
        COALESCE(fi_cred.display_name_he, fi_vendor.display_name_he, t.vendor) as institution_name_he,
        COALESCE(fi_cred.display_name_en, fi_vendor.display_name_en, t.vendor) as institution_name_en,
        COALESCE(fi_cred.logo_url, fi_vendor.logo_url) as institution_logo,
        COALESCE(fi_cred.institution_type, fi_vendor.institution_type) as institution_type,
        CASE
          WHEN LOWER(t.name) LIKE '%' || LOWER($1) || '%' THEN 'account_number_match'
          WHEN ${repaymentCategoryCondition} THEN 'category_match'
          WHEN ${keywordConditions} THEN 'keyword_match'
          ELSE 'unknown'
        END AS match_reason
      FROM transactions t
      LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
      LEFT JOIN vendor_credentials vc ON t.vendor = vc.vendor
      LEFT JOIN institution_nodes fi_cred ON vc.institution_id = fi_cred.id AND fi_cred.node_type = 'institution'
      LEFT JOIN institution_nodes fi_vendor ON t.vendor = fi_vendor.vendor_code AND fi_vendor.node_type = 'institution'
      WHERE t.vendor = $2
        AND (
          LOWER(t.name) LIKE '%' || LOWER($1) || '%'
          OR ${repaymentCategoryCondition}
          OR ${keywordConditions}
        )
    `;

    const paramsList = [creditCardAccountNumber, bankVendor, ...KEYWORDS];

    if (bankAccountNumber) {
      paramsList.push(bankAccountNumber);
      query += ` AND t.account_number = $${paramsList.length}`;
    }

    query += ' ORDER BY t.date DESC LIMIT 500';

    const result = await client.query(query, paramsList);

    const candidates = filterWithActivePairings(result.rows, activePairings).map((row) => {
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
        date: row.date,
        name: row.name,
        price: row.price,
        categoryId: row.category_definition_id,
        categoryName: row.category_name || row.category_name_en,
        accountNumber: row.account_number,
        matchReason: row.match_reason,
        institution,
      };
    });

    const stats = candidates.reduce(
      (acc, candidate) => {
        acc.total += 1;
        acc.byMatchReason[candidate.matchReason] = (acc.byMatchReason[candidate.matchReason] || 0) + 1;
        if (candidate.price < 0) acc.totalNegative += 1;
        if (candidate.price > 0) acc.totalPositive += 1;
        return acc;
      },
      {
        total: 0,
        byMatchReason: {},
        totalNegative: 0,
        totalPositive: 0,
      },
    );

    return {
      candidates,
      stats,
      filters: {
        creditCardAccountNumber,
        bankVendor,
        bankAccountNumber,
      },
    };
  } finally {
    client.release();
  }
}

module.exports = {
  findSettlementCandidates,
};

module.exports.default = module.exports;
