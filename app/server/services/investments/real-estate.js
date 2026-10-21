const {
  DEFAULT_INVESTMENT_TIME_ZONE,
  toIsoDateInTimeZone,
} = require('./linked-transaction-rollforward.js');
const {
  toNumber,
} = require('./account-holdings-rollup.js');

function buildCumulativeRealEstateSnapshots(rows = [], valuations = []) {
  const adjustments = new Map();

  (rows || []).forEach((row) => {
    const amount = toNumber(row.price);
    if (amount === null || amount === 0) {
      return;
    }

    const transactionDate = row.transaction_datetime || row.date;
    if (!transactionDate) {
      return;
    }

    const date = toIsoDateInTimeZone(
      transactionDate,
      DEFAULT_INVESTMENT_TIME_ZONE,
    );
    if (!date) {
      return;
    }

    const signedAmount = amount < 0 ? Math.abs(amount) : -Math.abs(amount);
    adjustments.set(date, (adjustments.get(date) || 0) + signedAmount);
  });

  const valuationByDate = new Map(valuations.map((row) => [row.as_of_date, row]));
  let runningValue = 0;
  let runningCost = 0;
  return [...new Set([...adjustments.keys(), ...valuationByDate.keys()])]
    .sort()
    .map((date) => {
      const valuation = valuationByDate.get(date);
      const delta = adjustments.get(date) || 0;
      // A valuation already includes transactions on its own date.
      runningValue = valuation ? Number(valuation.current_value) : Math.max(runningValue + delta, 0);
      runningCost = valuation
        ? Number(valuation.cost_basis ?? valuation.current_value)
        : Math.max(runningCost + delta, 0);
      return {
        as_of_date: date,
        current_value: runningValue,
        cost_basis: runningCost,
      };
    });
}

async function loadRealEstateAccount(dbAdapter, accountId) {
  const result = await dbAdapter.query(
    `
      SELECT id, account_type
      FROM investment_accounts
      WHERE id = $1
      LIMIT 1
    `,
    [accountId],
  );

  return result.rows?.[0] || null;
}

async function fetchLinkedRealEstateTransactions(dbAdapter, accountId) {
  const result = await dbAdapter.query(
    `
      SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.transaction_datetime,
        t.name,
        t.price
      FROM transaction_account_links tal
      JOIN transactions t
        ON tal.transaction_identifier = t.identifier
       AND tal.transaction_vendor = t.vendor
      WHERE tal.account_id = $1
      ORDER BY t.date ASC, t.identifier ASC
    `,
    [accountId],
  );

  return Array.isArray(result.rows) ? result.rows : [];
}

async function upsertRealEstateSnapshot(dbAdapter, accountId, snapshot) {
  const result = await dbAdapter.query(
    `
      INSERT INTO investment_holdings (
        account_id, current_value, cost_basis, as_of_date,
        asset_type, holding_type, status, notes
      ) VALUES ($1, $2, $3, $4, 'real_estate', 'standard', 'active', $5)
      ON CONFLICT (account_id, as_of_date) WHERE holding_type = 'standard'
      DO UPDATE SET
        current_value = EXCLUDED.current_value,
        cost_basis = EXCLUDED.cost_basis,
        asset_type = COALESCE(investment_holdings.asset_type, EXCLUDED.asset_type),
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP
      WHERE COALESCE(investment_holdings.notes, '') NOT LIKE 'Real estate simulator valuation%'
        AND COALESCE(investment_holdings.notes, '') NOT LIKE 'Merged real estate valuation%'
      RETURNING *
    `,
    [
      accountId,
      snapshot.current_value,
      snapshot.cost_basis,
      snapshot.as_of_date,
      'Auto-synced from linked real estate transactions',
    ],
  );

  return result.rows?.[0] || null;
}

async function syncRealEstateHolding({ dbAdapter, accountId } = {}) {
  const numericAccountId = Number(accountId);
  if (!dbAdapter || !Number.isFinite(numericAccountId)) {
    return null;
  }

  const account = await loadRealEstateAccount(dbAdapter, numericAccountId);
  if (!account || account.account_type !== 'real_estate') {
    return null;
  }

  const transactions = await fetchLinkedRealEstateTransactions(dbAdapter, numericAccountId);
  let snapshots = buildCumulativeRealEstateSnapshots(transactions);
  if (snapshots.length === 0) {
    return {
      accountId: numericAccountId,
      synced: false,
      snapshots: [],
    };
  }

  const { rows: valuations } = await dbAdapter.query(`
    SELECT current_value, cost_basis, as_of_date
    FROM investment_holdings
    WHERE account_id = $1 AND COALESCE(holding_type, 'standard') = 'standard'
      AND (notes LIKE 'Real estate simulator valuation%' OR notes LIKE 'Merged real estate valuation%')
    ORDER BY as_of_date, id
  `, [numericAccountId]);
  snapshots = buildCumulativeRealEstateSnapshots(transactions, valuations || []);
  const protectedDates = new Set((valuations || []).map((row) => row.as_of_date));
  const rows = [];
  for (const snapshot of snapshots) {
    if (protectedDates.has(snapshot.as_of_date)) continue;
    rows.push(await upsertRealEstateSnapshot(dbAdapter, numericAccountId, snapshot));
  }

  return {
    accountId: numericAccountId,
    synced: true,
    snapshots,
    latest: snapshots[snapshots.length - 1],
    rows,
  };
}

module.exports = {
  buildCumulativeRealEstateSnapshots,
  syncRealEstateHolding,
};

module.exports.default = module.exports;
