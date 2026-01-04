const database = require('../database.js');
const pairingsService = require('./pairings.js');
const { getVendorCodesByTypes } = require('../institutions.js');

let cachedBankVendors = null;
let bankVendorCacheTimestamp = 0;
const VENDOR_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getBankVendors() {
  const now = Date.now();
  if (cachedBankVendors && (now - bankVendorCacheTimestamp) < VENDOR_CACHE_TTL) {
    return cachedBankVendors;
  }

  try {
    const vendors = await getVendorCodesByTypes(database, ['bank']);
    if (vendors && vendors.length > 0) {
      cachedBankVendors = vendors;
      bankVendorCacheTimestamp = now;
      return cachedBankVendors;
    }
  } catch (error) {
    console.warn('[accounts/unpaired] Failed to load bank vendors from registry', error);
  }

  cachedBankVendors = [];
  bankVendorCacheTimestamp = now;
  return cachedBankVendors;
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

function filterUnpairedTransactions(transactions, activePairings) {
  if (!activePairings || activePairings.length === 0) {
    return transactions;
  }

  return transactions.filter((txn) => {
    const normalizedTxn = {
      vendor: txn.vendor,
      accountNumber: txn.account_number,
      name: txn.name,
    };

    return !activePairings.some((pairing) => matchesPairing(normalizedTxn, pairing));
  });
}

async function fetchCandidateTransactions(client) {
  const bankVendors = await getBankVendors();
  if (!bankVendors.length) {
    return [];
  }

  // SQLite doesn't support ANY operator, so we build IN clause with placeholders
  const placeholders = bankVendors.map((_, i) => `$${i + 1}`).join(', ');

  const result = await client.query(
    `
      SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.name,
        t.price,
        t.category_definition_id,
        t.account_number,
        cd.name AS category_name,
        COALESCE(fi_cred.id, fi_vendor.id) as institution_id,
        COALESCE(fi_cred.display_name_he, fi_vendor.display_name_he) as institution_name_he,
        COALESCE(fi_cred.display_name_en, fi_vendor.display_name_en) as institution_name_en,
        COALESCE(fi_cred.logo_url, fi_vendor.logo_url) as institution_logo,
        COALESCE(fi_cred.institution_type, fi_vendor.institution_type) as institution_type
      FROM transactions t
      LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
      LEFT JOIN vendor_credentials vc ON t.vendor = vc.vendor
      LEFT JOIN institution_nodes fi_cred ON vc.institution_id = fi_cred.id AND fi_cred.node_type = 'institution'
      LEFT JOIN institution_nodes fi_vendor ON t.vendor = fi_vendor.vendor_code AND fi_vendor.node_type = 'institution'
      WHERE t.category_definition_id IN (25, 75)
        AND t.vendor IN (
          SELECT DISTINCT vendor
          FROM vendor_credentials
          WHERE vendor IN (${placeholders})
        )
      ORDER BY t.date DESC
    `,
    bankVendors,
  );

  return result.rows;
}

async function getTrulyUnpairedTransactions(params = {}) {
  const includeDetails = params.include_details === 'true' || params.include_details === true;
  const client = await database.getClient();

  try {
    const [activePairings, transactions] = await Promise.all([
      pairingsService.getActivePairings(client),
      fetchCandidateTransactions(client),
    ]);

    const unpaired = filterUnpairedTransactions(transactions, activePairings);

    if (!includeDetails) {
      return {
        count: unpaired.length,
      };
    }

    return {
      count: unpaired.length,
      transactions: unpaired.map((txn) => ({
        identifier: txn.identifier,
        vendor: txn.vendor,
        date: txn.date,
        name: txn.name,
        price: txn.price,
        categoryId: txn.category_definition_id,
        categoryName: txn.category_name,
        accountNumber: txn.account_number,
        institution: txn.institution_id ? {
          id: txn.institution_id,
          display_name_he: txn.institution_name_he,
          display_name_en: txn.institution_name_en,
          logo_url: txn.institution_logo,
          institution_type: txn.institution_type,
        } : null,
      })),
    };
  } finally {
    client.release();
  }
}

async function getUnpairedTransactionCount() {
  const result = await getTrulyUnpairedTransactions({ include_details: false });
  return result.count;
}

module.exports = {
  getTrulyUnpairedTransactions,
  getUnpairedTransactionCount,
};

module.exports.default = module.exports;
