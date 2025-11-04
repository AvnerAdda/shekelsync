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
        cd.name AS category_name
      FROM transactions t
      LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
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
