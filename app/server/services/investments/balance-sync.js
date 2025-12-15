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

  logger?.debug?.(`[Balance Sync] Looking for existing account: vendor=${vendor}, credentialId=${credentialId}, accountNumber=${accountNumber}`);

  // Check if account already exists for this credential
  // Try multiple matching strategies to avoid duplicates
  
  // Strategy 1: Match by credential_id in notes (most reliable for existing accounts)
  let existing = await client.query(
    `SELECT ia.*
     FROM investment_accounts ia
     WHERE ia.account_type = 'bank_balance'
       AND ia.notes LIKE $1
     LIMIT 1`,
    [`%credential_id:${credentialId}%`]
  );

  if (existing.rows.length > 0) {
    logger?.debug?.(`[Balance Sync] Found existing account by credential_id: ${existing.rows[0].id}`);
    return existing.rows[0];
  }

  // Strategy 2: Match by institution_id and account_number
  if (institution_id && accountNumber) {
    existing = await client.query(
      `SELECT ia.*
       FROM investment_accounts ia
       WHERE ia.account_type = 'bank_balance'
         AND ia.institution_id = $1
         AND ia.account_number = $2
       LIMIT 1`,
      [institution_id, accountNumber]
    );

    if (existing.rows.length > 0) {
      logger?.debug?.(`[Balance Sync] Found existing account by institution+account_number: ${existing.rows[0].id}`);
      // Update notes to include credential_id for future lookups
      await client.query(
        `UPDATE investment_accounts 
         SET notes = COALESCE(notes, '') || ' credential_id:' || $1
         WHERE id = $2`,
        [credentialId, existing.rows[0].id]
      );
      return existing.rows[0];
    }
  }

  // Strategy 3: Match by institution_id only (if single bank account per institution)
  if (institution_id) {
    existing = await client.query(
      `SELECT ia.*, COUNT(*) OVER() as total_count
       FROM investment_accounts ia
       WHERE ia.account_type = 'bank_balance'
         AND ia.institution_id = $1
       LIMIT 1`,
      [institution_id]
    );

    // Only use this match if there's exactly one account for this institution
    if (existing.rows.length > 0 && existing.rows[0].total_count === '1') {
      logger?.debug?.(`[Balance Sync] Found single existing account by institution: ${existing.rows[0].id}`);
      // Update notes to include credential_id for future lookups
      await client.query(
        `UPDATE investment_accounts 
         SET notes = COALESCE(notes, '') || ' credential_id:' || $1
         WHERE id = $2`,
        [credentialId, existing.rows[0].id]
      );
      return existing.rows[0];
    }
  }

  logger?.info?.(`[Balance Sync] No existing account found, creating new one for ${vendor}`);

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
    SELECT 1 FROM investment_holdings
    WHERE account_id = $1 AND as_of_date = $2
    LIMIT 1
  `;

  const result = await client.query(query, [accountId, snapshotDate]);
  return result.rows.length > 0;
}

/**
 * Get the last snapshot for an account
 * @param {object} client - Database client
 * @param {number} accountId - Investment account ID
 * @returns {Promise<object|null>} Last snapshot or null
 */
async function getLastSnapshot(client, accountId) {
  const query = `
    SELECT as_of_date as snapshot_date, current_value as total_value, cost_basis
    FROM investment_holdings
    WHERE account_id = $1
    ORDER BY as_of_date DESC
    LIMIT 1
  `;

  const result = await client.query(query, [accountId]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Forward-fill missing dates between last snapshot and today
 * This ensures portfolio history is continuous and doesn't show gaps/drops
 * @param {object} client - Database client
 * @param {number} accountId - Investment account ID
 * @param {string} today - Today's date (YYYY-MM-DD)
 * @param {object} logger - Logger instance
 * @returns {Promise<number>} Number of dates filled
 */
async function forwardFillMissingDates(client, accountId, today, logger = console) {
  const lastSnapshot = await getLastSnapshot(client, accountId);

  if (!lastSnapshot) {
    logger?.debug?.(`[Forward Fill] No previous snapshot found for account ${accountId}`);
    return 0;
  }

  const lastDate = new Date(lastSnapshot.snapshot_date);
  const todayDate = new Date(today);

  // Calculate days difference
  const daysDiff = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));

  if (daysDiff <= 1) {
    // No gap to fill (same day or consecutive day)
    return 0;
  }

  const { total_value, cost_basis } = lastSnapshot;
  let filledCount = 0;

  // Fill each missing date with the last known values
  for (let i = 1; i < daysDiff; i++) {
    const fillDate = new Date(lastDate);
    fillDate.setDate(fillDate.getDate() + i);
    const fillDateStr = fillDate.toISOString().split('T')[0];

    // Insert into investment_holdings (use ON CONFLICT to avoid duplicates)
    await client.query(
      `INSERT INTO investment_holdings (
        account_id, current_value, cost_basis, as_of_date, asset_type, notes
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (account_id, as_of_date) DO NOTHING`,
      [
        accountId,
        total_value,
        cost_basis,
        fillDateStr,
        'cash',
        'Forward-filled from previous snapshot',
      ]
    );

    filledCount++;
  }

  if (filledCount > 0) {
    logger?.info?.(`[Forward Fill] Filled ${filledCount} missing dates for account ${accountId} (${lastSnapshot.snapshot_date} to ${today})`);
  }

  return filledCount;
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
    logger?.info?.(`[Balance Sync] Starting for ${credential.vendor} (balance: ₪${currentBalance}, account: ${accountNumber || 'N/A'})`);
    logger?.debug?.(`[Balance Sync] Credential details: id=${credential.id}, dbId=${credential.dbId}, institution_id=${credential.institution_id}`);

    // Validate inputs
    if (currentBalance === undefined || currentBalance === null) {
      logger?.warn?.(`[Balance Sync] Skipping sync - no balance provided for ${credential.vendor}`);
      return { success: true, skipped: true, reason: 'No balance provided' };
    }

    // Step 1: Get or create investment account
    logger?.debug?.(`[Balance Sync] Step 1: Getting or creating investment account...`);
    const investmentAccount = await getOrCreateBankBalanceAccount(client, credential, accountNumber, logger);
    logger?.debug?.(`[Balance Sync] Investment account: id=${investmentAccount.id}, name=${investmentAccount.account_name}`);

    // Step 2: Get or create investment asset
    logger?.debug?.(`[Balance Sync] Step 2: Getting or creating investment asset...`);
    const institution = await getInstitutionByVendorCode(client, credential.vendor);
    const assetName = `Bank Balance - ${institution?.display_name_en || credential.vendor}`;
    const investmentAsset = await getOrCreateBankBalanceAsset(client, investmentAccount.id, assetName, logger);
    logger?.debug?.(`[Balance Sync] Investment asset: id=${investmentAsset.id}, name=${assetName}`);

    // Step 3: Update asset units to current balance
    logger?.debug?.(`[Balance Sync] Step 3: Updating asset units to ${currentBalance}...`);
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
    logger?.debug?.(`[Balance Sync] Step 4: Checking month-start snapshot for ${monthStartDate}...`);
    const monthStartExists = await snapshotExists(client, investmentAccount.id, monthStartDate);
    logger?.debug?.(`[Balance Sync] Month-start snapshot exists: ${monthStartExists}`);

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

      // Insert month-start snapshot into investment_holdings
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
          'Auto-calculated month-start balance',
        ]
      );

      monthStartSnapshot = { date: monthStartDate, balance: monthStartBalance };
      logger?.info?.(`✓ Created month-start snapshot: ${monthStartDate} = ₪${monthStartBalance}`);
    }

    // Step 5: Forward-fill any missing dates between last snapshot and today
    // This ensures the portfolio graph shows consistent values and doesn't appear to "lose" money
    logger?.debug?.(`[Balance Sync] Step 5: Forward-filling missing dates...`);
    const filledDates = await forwardFillMissingDates(client, investmentAccount.id, today, logger);
    logger?.debug?.(`[Balance Sync] Forward-filled ${filledDates} dates`);

    // Step 6: Upsert current balance snapshot
    logger?.debug?.(`[Balance Sync] Step 6: Upserting current balance snapshot for ${today}...`);
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
        'Current balance from scraper',
      ]
    );

    logger?.info?.(`✓ Synced current balance: ${today} = ₪${currentBalance}`);

    return {
      success: true,
      investmentAccountId: investmentAccount.id,
      currentBalance,
      monthStartSnapshot,
      snapshotDate: today,
      filledDates,
    };
  } catch (error) {
    logger?.error?.(`[Balance Sync] Error during sync for ${credential.vendor}:`, error.message);
    logger?.error?.(`[Balance Sync] Error stack:`, error.stack);
    // Don't throw - return error info so scraping can continue
    return {
      success: false,
      error: error.message,
      vendor: credential.vendor,
      accountNumber,
    };
  }
}

/**
 * Forward-fill today's date for all bank balance accounts associated with a credential
 * Called when scrape returns no account data but we want to maintain portfolio continuity
 *
 * @param {object} client - Database client
 * @param {object} credential - Credential object with id and vendor
 * @param {object} logger - Logger instance
 * @returns {Promise<object>} Result with counts
 */
async function forwardFillForCredential(client, credential, logger = console) {
  const today = new Date().toISOString().split('T')[0];
  const credentialId = credential.dbId || credential.id;

  logger?.info?.(`[Forward Fill] Forward-filling bank balance accounts for credential ${credentialId} (${credential.vendor})`);

  // Find all bank balance investment accounts for this credential
  const accountsResult = await client.query(
    `SELECT id, account_name
     FROM investment_accounts
     WHERE account_type = 'bank_balance'
       AND is_active = 1
       AND (
         notes LIKE $1
         OR (institution_id IN (
           SELECT institution_id FROM vendor_credentials WHERE id = $2
         ))
       )`,
    [`%credential_id:${credentialId}%`, credentialId]
  );

  if (accountsResult.rows.length === 0) {
    logger?.debug?.(`[Forward Fill] No bank balance accounts found for credential ${credentialId}`);
    return { success: true, accountsUpdated: 0, datesForwardFilled: 0 };
  }

  let totalFilled = 0;
  let accountsUpdated = 0;

  for (const account of accountsResult.rows) {
    // Fill gaps in history
    const filled = await forwardFillMissingDates(client, account.id, today, logger);
    
    // Also ensure today has a record with the last known value
    // This is important for the "last update date" to show correctly
    const lastSnapshot = await getLastSnapshot(client, account.id);
    if (lastSnapshot) {
      // Insert today's snapshot with the last known value (if not already present)
      await client.query(
        `INSERT INTO investment_holdings (
          account_id, current_value, cost_basis, as_of_date, asset_type, notes
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (account_id, as_of_date) DO NOTHING`,
        [
          account.id,
          lastSnapshot.total_value,
          lastSnapshot.cost_basis,
          today,
          'cash',
          'Forward-filled (no new data from bank)',
        ]
      );

      logger?.debug?.(`[Forward Fill] Ensured today's snapshot for account ${account.id} (value: ${lastSnapshot.total_value})`);
      accountsUpdated++;
      totalFilled += filled + 1; // +1 for today's entry
    } else if (filled > 0) {
      accountsUpdated++;
      totalFilled += filled;
    }
  }

  logger?.info?.(`[Forward Fill] Updated ${accountsUpdated} accounts, filled ${totalFilled} dates`);

  return {
    success: true,
    accountsUpdated,
    datesForwardFilled: totalFilled,
  };
}

module.exports = {
  syncBankBalanceToInvestments,
  getOrCreateBankBalanceAccount,
  calculateMonthStartBalance,
  forwardFillMissingDates,
  forwardFillForCredential,
  getLastSnapshot,
};

module.exports.default = module.exports;
