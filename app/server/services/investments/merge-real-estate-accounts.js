const {
  applyContributionRollforward,
  fetchLinkedInvestmentTransactions,
  toIsoDateInTimeZone,
} = require('./linked-transaction-rollforward.js');

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

// Carry each account's valuation forward at every snapshot/contribution date.
// Summing only the latest rows would erase the combined account's history.
function buildMergedSnapshots(accounts, holdings, transactions) {
  const dates = new Set(holdings.map((row) => row.as_of_date));
  const datedTransactions = transactions.map((row) => ({
    ...row,
    effectiveDate: toIsoDateInTimeZone(row.transaction_datetime || row.date),
  }));
  datedTransactions.forEach((row) => {
    if (row.effectiveDate) dates.add(row.effectiveDate);
  });
  return [...dates].sort().map((date) => {
    const balances = accounts.map((account) => {
      const snapshot = holdings.filter((row) => (
        Number(row.account_id) === Number(account.id) && row.as_of_date <= date
      )).at(-1);
      return {
        id: account.id,
        current_value: snapshot ? Number(snapshot.current_value) : null,
        cost_basis: snapshot?.cost_basis == null ? null : Number(snapshot.cost_basis),
        as_of_date: snapshot?.as_of_date || null,
      };
    });
    applyContributionRollforward(balances, datedTransactions.filter((row) => row.effectiveDate <= date));
    return {
      as_of_date: date,
      current_value: Math.round(balances.reduce((sum, row) => sum + (row.current_value || 0), 0) * 1e8) / 1e8,
      cost_basis: Math.round(balances.reduce((sum, row) => sum + (row.cost_basis ?? row.current_value ?? 0), 0) * 1e8) / 1e8,
    };
  });
}

async function mergeRealEstateAccounts(database, payload = {}) {
  const { target_account_id: targetId, source_account_ids: sourceIds } = payload;
  if (!Number.isSafeInteger(targetId) || targetId <= 0
    || !Array.isArray(sourceIds) || sourceIds.length === 0
    || sourceIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
    || new Set([targetId, ...sourceIds]).size !== sourceIds.length + 1) {
    fail(400, 'Choose one target account and distinct source accounts');
  }
  const ids = [targetId, ...sourceIds];
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
  const sourcePlaceholders = sourceIds.map((_, index) => `$${index + 2}`).join(',');
  const client = await database.getClient();
  let inTransaction = false;
  try {
    await client.query('BEGIN IMMEDIATE');
    inTransaction = true;
    const { rows: accounts } = await client.query(
      `SELECT * FROM investment_accounts WHERE id IN (${placeholders})`, ids,
    );
    if (accounts.length !== ids.length) fail(404, 'Investment account not found');
    if (accounts.some((row) => row.account_type !== 'real_estate' || !row.is_active)) {
      fail(400, 'Only active real estate accounts can be merged');
    }
    if (new Set(accounts.map((row) => row.currency)).size !== 1) {
      fail(400, 'Real estate accounts must use the same currency');
    }
    const { rows: properties } = await client.query(
      `SELECT account_id FROM real_estate_properties WHERE account_id IN (${placeholders})`, ids,
    );
    if (properties.some((row) => Number(row.account_id) !== targetId)) {
      fail(400, 'Keep the account with the property profile as the target. Separate property profiles cannot be merged');
    }
    const { rows: holdings } = await client.query(
      `SELECT * FROM investment_holdings WHERE account_id IN (${placeholders}) ORDER BY as_of_date, id`, ids,
    );
    if (holdings.some((row) => row.holding_type === 'pikadon')) {
      fail(400, 'Term deposits cannot be merged into a real estate account');
    }
    const transactions = await fetchLinkedInvestmentTransactions(client, ids);
    const snapshots = buildMergedSnapshots(accounts, holdings, transactions);
    for (const snapshot of snapshots) {
      await client.query(`
        INSERT INTO investment_holdings
          (account_id, current_value, cost_basis, as_of_date, asset_type, holding_type, status, notes)
        VALUES ($1, $2, $3, $4, 'real_estate', 'standard', 'active', 'Merged real estate valuation')
        ON CONFLICT (account_id, as_of_date) WHERE holding_type = 'standard'
        DO UPDATE SET current_value = EXCLUDED.current_value, cost_basis = EXCLUDED.cost_basis,
          notes = EXCLUDED.notes, updated_at = CURRENT_TIMESTAMP
      `, [targetId, snapshot.current_value, snapshot.cost_basis, snapshot.as_of_date]);
    }
    // Original source snapshots stay archived on the inactive source accounts.
    for (const table of ['transaction_account_links', 'investment_assets', 'investment_positions']) {
      await client.query(
        `UPDATE ${table} SET account_id = $1 WHERE account_id IN (${sourcePlaceholders})`,
        [targetId, ...sourceIds],
      );
    }
    await client.query(`
      INSERT INTO account_transaction_patterns (account_id, pattern, pattern_type, is_active, match_count, last_matched)
      SELECT $1, pattern, pattern_type, MAX(is_active), SUM(match_count), MAX(last_matched)
      FROM account_transaction_patterns WHERE account_id IN (${sourcePlaceholders})
      GROUP BY pattern, pattern_type
      ON CONFLICT (account_id, pattern) DO UPDATE SET
        is_active = MAX(account_transaction_patterns.is_active, EXCLUDED.is_active),
        match_count = account_transaction_patterns.match_count + EXCLUDED.match_count,
        last_matched = MAX(COALESCE(account_transaction_patterns.last_matched, ''), COALESCE(EXCLUDED.last_matched, ''))
    `, [targetId, ...sourceIds]);
    await client.query(
      `UPDATE account_transaction_patterns SET is_active = false WHERE account_id IN (${sourcePlaceholders})`,
      [targetId, ...sourceIds],
    );
    await client.query(
      `UPDATE pending_transaction_suggestions SET suggested_account_id = $1 WHERE suggested_account_id IN (${sourcePlaceholders})`,
      [targetId, ...sourceIds],
    );
    await client.query(`
      UPDATE investment_accounts SET is_active = false,
        notes = COALESCE(notes || char(10), '') || 'Merged into real estate account ' || $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${sourcePlaceholders})
    `, [targetId, ...sourceIds]);
    await client.query('UPDATE investment_accounts SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [targetId]);
    await client.query('COMMIT');
    inTransaction = false;
    return { success: true, accountId: targetId, mergedAccountIds: sourceIds, latest: snapshots.at(-1) || null };
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { mergeRealEstateAccounts, buildMergedSnapshots };
