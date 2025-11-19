/**
 * Balance Sync Service
 *
 * Syncs bank account balances from vendor_credentials to investment_holdings.
 * Creates investment accounts and assets for bank balances, and tracks historical snapshots.
 */

const {
  getInstitutionByVendorCode,
  mapVendorCodeToInstitutionId,
} = require('../institutions.js');

/**
 * Get or create an investment account for a bank balance
 * @param {object} client - Database client (in transaction)
 * @param {object} credential - Vendor credential object
 * @param {string} accountNumber - Bank account number
 * @param {object} logger - Logger instance
 * @returns {Promise<object>} Investment account record
 */
async function getOrCreateBankBalanceAccount(client, credential, accountNumber, logger = console) {
  const { vendor, nickname, id: credentialId, institution_id } = credential;

  // Check if account already exists for this credential
  const existingQuery = `
    SELECT ia.*
    FROM investment_accounts ia
    WHERE ia.account_type = 'bank_balance'
      AND ia.institution_id = $1
      AND (ia.account_number = $2 OR ia.notes LIKE $3)
    LIMIT 1
  `;

  const existing = await client.query(existingQuery, [
    institution_id,
    accountNumber || '',
    `%credential_id:${credentialId}%`,
  ]);

  if (existing.rows.length > 0) {
    logger?.debug?.(`Found existing investment account ${existing.rows[0].id} for credential ${credentialId}`);
    return existing.rows[0];
  }

  // Get institution details for naming
  const institution = await getInstitutionByVendorCode(client, vendor);
  const institutionName = institution?.display_name_en || institution?.display_name_he || vendor;

  const accountName = nickname
    ? `${nickname} - Balance`
    : `${institutionName} - Balance${accountNumber ? ` (${accountNumber})` : ''}`;

  // Create new investment account
  const insertQuery = `
    INSERT INTO investment_accounts (
      account_name,
      account_type,
      institution_id,
      account_number,
      currency,
      is_liquid,
      investment_category,
      notes,
      is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `;

  const notes = `Auto-created for bank balance tracking. credential_id:${credentialId}`;

  const result = await client.query(insertQuery, [
    accountName,
    'bank_balance',
    institution_id,
    accountNumber || null,
    'ILS',
    true,
    'cash',
    notes,
    true,
  ]);

  logger?.info?.(`✓ Created investment account ${result.rows[0].id} for ${accountName}`);
  return result.rows[0];
}

/**
 * Get or create an investment asset for a bank balance
 * @param {object} client - Database client (in transaction)
 * @param {number} accountId - Investment account ID
 * @param {string} assetName - Asset name
 * @param {object} logger - Logger instance
 * @returns {Promise<object>} Investment asset record
 */
async function getOrCreateBankBalanceAsset(client, accountId, assetName, logger = console) {
  // Check if asset already exists
  const existingQuery = `
    SELECT *
    FROM investment_assets
    WHERE account_id = $1
      AND asset_type = 'cash'
    LIMIT 1
  `;

  const existing = await client.query(existingQuery, [accountId]);

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // Create new asset
  const insertQuery = `
    INSERT INTO investment_assets (
      account_id,
      asset_name,
      asset_type,
      units,
      currency,
      is_active
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;

  const result = await client.query(insertQuery, [
    accountId,
    assetName,
    'cash',
    0, // Will be updated with balance
    'ILS',
    true,
  ]);

  logger?.debug?.(`Created investment asset ${result.rows[0].id} for account ${accountId}`);
  return result.rows[0];
}

/**
 * Calculate month-start balance by subtracting unpaired transactions from current balance
 * @param {object} client - Database client
 * @param {string} vendor - Vendor code
 * @param {string} accountNumber - Bank account number
 * @param {number} currentBalance - Current balance
 * @param {string} monthStartDate - Month start date (YYYY-MM-01)
 * @param {object} logger - Logger instance
 * @returns {Promise<number>} Calculated month-start balance
 */
async function calculateMonthStartBalance(client, vendor, accountNumber, currentBalance, monthStartDate, logger = console) {
  // Query to sum UNPAIRED bank transactions since month start
  // Excludes:
  // 1. Credit card repayment transactions (פרעון כרטיס אשראי)
  // 2. Transactions linked to investment accounts (in transaction_account_links)
  const query = `
    SELECT COALESCE(SUM(price), 0) as transaction_sum
    FROM transactions t
    WHERE t.vendor = $1
      AND ($2 IS NULL OR t.account_number = $2)
      AND t.date >= $3
      -- Exclude credit card repayment category
      AND t.category_definition_id NOT IN (
        SELECT id FROM category_definitions
        WHERE name = 'פרעון כרטיס אשראי'
      )
      -- Exclude transactions linked to investment accounts
      AND (t.identifier, t.vendor) NOT IN (
        SELECT transaction_identifier, transaction_vendor
        FROM transaction_account_links
      )
  `;

  const result = await client.query(query, [vendor, accountNumber || null, monthStartDate]);
  const transactionSum = parseFloat(result.rows[0].transaction_sum || 0);

  const monthStartBalance = currentBalance - transactionSum;

  logger?.debug?.(
    `Month-start balance calculation for ${vendor} (${accountNumber || 'all'}): ` +
    `current=${currentBalance}, transactions_since=${transactionSum}, month_start=${monthStartBalance}`
  );

  return monthStartBalance;
}

/**
 * Check if a snapshot exists for a given date
 * @param {object} client - Database client
 * @param {number} accountId - Investment account ID
 * @param {string} snapshotDate - Snapshot date (YYYY-MM-DD)
 * @returns {Promise<boolean>} True if snapshot exists
 */
async function snapshotExists(client, accountId, snapshotDate) {
  const query = `
    SELECT 1 FROM investment_holdings_history
    WHERE account_id = $1 AND snapshot_date = $2
    LIMIT 1
  `;

  const result = await client.query(query, [accountId, snapshotDate]);
  return result.rows.length > 0;
}

/**
 * Sync bank balance to investment holdings
 * Main entry point called from scraper after balance update
 *
 * @param {object} client - Database client (must be in transaction)
 * @param {object} credential - Vendor credential object with institution_id
 * @param {number} currentBalance - Current balance from scraper
 * @param {string} accountNumber - Bank account number (optional)
 * @param {object} logger - Logger instance
 * @returns {Promise<object>} Sync result with account and snapshot info
 */
async function syncBankBalanceToInvestments(client, credential, currentBalance, accountNumber, logger = console) {
  try {
    logger?.info?.(`[Balance Sync] Starting for ${credential.vendor} (balance: ₪${currentBalance})`);

    // Step 1: Get or create investment account
    const investmentAccount = await getOrCreateBankBalanceAccount(client, credential, accountNumber, logger);

    // Step 2: Get or create investment asset
    const institution = await getInstitutionByVendorCode(client, credential.vendor);
    const assetName = `Bank Balance - ${institution?.display_name_en || credential.vendor}`;
    const investmentAsset = await getOrCreateBankBalanceAsset(client, investmentAccount.id, assetName, logger);

    // Step 3: Update asset units to current balance
    await client.query(
      `UPDATE investment_assets
       SET units = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [currentBalance, investmentAsset.id]
    );

    const today = new Date().toISOString().split('T')[0];
    const currentMonth = today.substring(0, 7); // YYYY-MM
    const monthStartDate = `${currentMonth}-01`;

    // Step 4: Check if we need to create a month-start snapshot
    const monthStartExists = await snapshotExists(client, investmentAccount.id, monthStartDate);

    let monthStartSnapshot = null;
    if (!monthStartExists && monthStartDate !== today) {
      // Calculate month-start balance
      const monthStartBalance = await calculateMonthStartBalance(
        client,
        credential.vendor,
        accountNumber,
        currentBalance,
        monthStartDate,
        logger
      );

      // Insert month-start snapshot
      await client.query(
        `INSERT INTO investment_holdings_history (
          account_id, total_value, cost_basis, snapshot_date, notes
        ) VALUES ($1, $2, $2, $3, $4)
        ON CONFLICT (account_id, snapshot_date) DO NOTHING`,
        [
          investmentAccount.id,
          monthStartBalance,
          monthStartDate,
          'Auto-calculated month-start balance',
        ]
      );

      await client.query(
        `INSERT INTO investment_holdings (
          account_id, current_value, cost_basis, as_of_date, asset_type, notes
        ) VALUES ($1, $2, $2, $3, $4, $5)
        ON CONFLICT (account_id, as_of_date) DO UPDATE
        SET current_value = EXCLUDED.current_value,
            cost_basis = EXCLUDED.cost_basis,
            updated_at = CURRENT_TIMESTAMP`,
        [
          investmentAccount.id,
          monthStartBalance,
          monthStartDate,
          'cash',
          'Month-start snapshot',
        ]
      );

      monthStartSnapshot = { date: monthStartDate, balance: monthStartBalance };
      logger?.info?.(`✓ Created month-start snapshot: ${monthStartDate} = ₪${monthStartBalance}`);
    }

    // Step 5: Upsert current balance snapshot
    await client.query(
      `INSERT INTO investment_holdings_history (
        account_id, total_value, cost_basis, snapshot_date, notes
      ) VALUES ($1, $2, $2, $3, $4)
      ON CONFLICT (account_id, snapshot_date)
      DO UPDATE SET
        total_value = EXCLUDED.total_value,
        cost_basis = EXCLUDED.cost_basis`,
      [
        investmentAccount.id,
        currentBalance,
        today,
        'Current balance from scraper',
      ]
    );

    await client.query(
      `INSERT INTO investment_holdings (
        account_id, current_value, cost_basis, as_of_date, asset_type, notes
      ) VALUES ($1, $2, $2, $3, $4, $5)
      ON CONFLICT (account_id, as_of_date)
      DO UPDATE SET
        current_value = EXCLUDED.current_value,
        cost_basis = EXCLUDED.cost_basis,
        updated_at = CURRENT_TIMESTAMP`,
      [
        investmentAccount.id,
        currentBalance,
        today,
        'cash',
        'Current balance',
      ]
    );

    logger?.info?.(`✓ Synced current balance: ${today} = ₪${currentBalance}`);

    return {
      success: true,
      investmentAccountId: investmentAccount.id,
      currentBalance,
      monthStartSnapshot,
      snapshotDate: today,
    };
  } catch (error) {
    logger?.error?.(`[Balance Sync] Error:`, error);
    throw error;
  }
}

module.exports = {
  syncBankBalanceToInvestments,
  getOrCreateBankBalanceAccount,
  calculateMonthStartBalance,
};

module.exports.default = module.exports;
