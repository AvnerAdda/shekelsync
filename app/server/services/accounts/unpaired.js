const database = require('../database.js');
const pairingsService = require('./pairings.js');

const BANK_VENDORS = [
  'hapoalim',
  'leumi',
  'discount',
  'mizrahi',
  'beinleumi',
  'union',
  'yahav',
  'otsarHahayal',
  'mercantile',
  'massad',
];

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
  // SQLite doesn't support ANY operator, so we build IN clause with placeholders
  const placeholders = BANK_VENDORS.map((_, i) => `$${i + 1}`).join(', ');

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
        fi.id as institution_id,
        fi.display_name_he as institution_name_he,
        fi.display_name_en as institution_name_en,
        fi.logo_url as institution_logo,
        fi.institution_type as institution_type
      FROM transactions t
      LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
      LEFT JOIN vendor_credentials vc ON t.vendor = vc.vendor
      LEFT JOIN financial_institutions fi ON vc.institution_id = fi.id
      WHERE t.category_definition_id IN (25, 75)
        AND t.vendor IN (
          SELECT DISTINCT vendor
          FROM vendor_credentials
          WHERE vendor IN (${placeholders})
        )
      ORDER BY t.date DESC
    `,
    BANK_VENDORS,
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
