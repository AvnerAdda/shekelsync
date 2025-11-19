#!/usr/bin/env node
/**
 * Migration Script: Bank Balances to Investment Holdings
 *
 * Migrates existing bank account balances from vendor_credentials
 * to the investment_holdings system.
 *
 * Usage:
 *   node scripts/migrations/migrate_bank_balances.js [--dry-run] [--drop-columns]
 *
 * Options:
 *   --dry-run       Run migration without committing changes
 *   --drop-columns  Drop balance columns from vendor_credentials after migration
 */

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const APP_NODE_MODULES = path.join(PROJECT_ROOT, 'app', 'node_modules');
const Database = require(path.join(APP_NODE_MODULES, 'better-sqlite3'));

// Parse arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const shouldDropColumns = args.includes('--drop-columns');

// Get database path from environment or use default
const dbPath = process.env.SQLITE_DB_PATH || path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite');

console.log('\n=== Bank Balance Migration Script ===\n');
console.log(`Database: ${dbPath}`);
console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
console.log(`Drop columns: ${shouldDropColumns ? 'YES' : 'NO'}\n`);

if (!fs.existsSync(dbPath)) {
  console.error(`❌ Database not found at ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);

try {
  db.pragma('foreign_keys = ON');

  // Always start transaction (will rollback in dry-run mode)
  db.exec('BEGIN');

  // Step 1: Get all bank credentials with balances
  const credentialsWithBalances = db.prepare(`
    SELECT
      vc.*,
      fi.id as institution_id,
      fi.display_name_en,
      fi.display_name_he,
      fi.vendor_code
    FROM vendor_credentials vc
    JOIN financial_institutions fi ON vc.vendor = fi.vendor_code
    WHERE vc.current_balance IS NOT NULL
      AND fi.institution_type = 'bank'
    ORDER BY vc.id
  `).all();

  console.log(`Found ${credentialsWithBalances.length} bank credentials with balances to migrate\n`);

  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  // Step 2: Migrate each credential
  for (const cred of credentialsWithBalances) {
    try {
      console.log(`Processing credential ${cred.id}: ${cred.vendor} (${cred.nickname || 'no nickname'})`);

      // Check if already migrated
      const existingAccount = db.prepare(`
        SELECT id FROM investment_accounts
        WHERE account_type = 'bank_balance'
          AND institution_id = ?
          AND notes LIKE ?
      `).get(cred.institution_id, `%credential_id:${cred.id}%`);

      if (existingAccount) {
        console.log(`  ⚠️  Already migrated (account ${existingAccount.id}) - skipping`);
        skippedCount++;
        continue;
      }

      // Create investment account
      const accountName = cred.nickname
        ? `${cred.nickname} - Balance`
        : `${cred.display_name_en || cred.vendor_code} - Balance${cred.bank_account_number ? ` (${cred.bank_account_number})` : ''}`;

      const notes = `Auto-created for bank balance tracking. credential_id:${cred.id}`;

      const accountInsert = db.prepare(`
        INSERT INTO investment_accounts (
          account_name, account_type, institution_id, account_number,
          currency, is_liquid, investment_category, notes, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const accountResult = accountInsert.run(
        accountName,
        'bank_balance',
        cred.institution_id,
        cred.bank_account_number || null,
        'ILS',
        1, // is_liquid
        'cash',
        notes,
        1 // is_active
      );

      const accountId = accountResult.lastInsertRowid;
      console.log(`  ✓ Created investment account ${accountId}: ${accountName}`);

      // Create investment asset
      const assetName = `Bank Balance - ${cred.display_name_en || cred.vendor_code}`;

      const assetInsert = db.prepare(`
        INSERT INTO investment_assets (
          account_id, asset_name, asset_type, units, currency, is_active
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      const assetResult = assetInsert.run(
        accountId,
        assetName,
        'cash',
        cred.current_balance,
        'ILS',
        1
      );

      console.log(`  ✓ Created investment asset ${assetResult.lastInsertRowid}`);

      // Create current holdings snapshot
      const today = new Date().toISOString().split('T')[0];

      const holdingInsert = db.prepare(`
        INSERT INTO investment_holdings (
          account_id, current_value, cost_basis, as_of_date, asset_type, notes
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      holdingInsert.run(
        accountId,
        cred.current_balance,
        cred.current_balance,
        cred.balance_updated_at ? cred.balance_updated_at.split(' ')[0] : today,
        'cash',
        'Migrated from vendor_credentials'
      );

      console.log(`  ✓ Created investment holding with balance ₪${cred.current_balance}`);

      // Create history snapshot
      const historyInsert = db.prepare(`
        INSERT INTO investment_holdings_history (
          account_id, total_value, cost_basis, snapshot_date, notes
        ) VALUES (?, ?, ?, ?, ?)
      `);

      historyInsert.run(
        accountId,
        cred.current_balance,
        cred.current_balance,
        cred.balance_updated_at ? cred.balance_updated_at.split(' ')[0] : today,
        'Migrated from vendor_credentials'
      );

      console.log(`  ✓ Created holdings history snapshot\n`);

      migratedCount++;
    } catch (error) {
      console.error(`  ❌ Error migrating credential ${cred.id}:`, error.message);
      errorCount++;
    }
  }

  // Step 3: Drop columns if requested (only in live mode)
  if (shouldDropColumns && !isDryRun) {
    console.log('\nDropping balance columns from vendor_credentials...');

    // SQLite doesn't support DROP COLUMN directly, need to recreate table
    // For now, we'll just document this needs to be done manually or in init script
    console.log('⚠️  Column dropping requires table recreation - skipping for safety');
    console.log('    Run the following SQL manually after verifying migration:');
    console.log('    -- Columns to drop: current_balance, balance_updated_at\n');
  }

  // Summary
  console.log('=== Migration Summary ===');
  console.log(`Total credentials: ${credentialsWithBalances.length}`);
  console.log(`Migrated: ${migratedCount}`);
  console.log(`Skipped (already migrated): ${skippedCount}`);
  console.log(`Errors: ${errorCount}\n`);

  if (isDryRun) {
    db.exec('ROLLBACK');
    console.log('✓ Dry run complete - no changes committed\n');
  } else {
    db.exec('COMMIT');
    console.log('✓ Migration committed successfully\n');
  }

  // Verification queries
  if (!isDryRun && migratedCount > 0) {
    console.log('=== Verification ===\n');

    const bankBalanceAccounts = db.prepare(`
      SELECT COUNT(*) as count
      FROM investment_accounts
      WHERE account_type = 'bank_balance'
    `).get();

    console.log(`Bank balance accounts created: ${bankBalanceAccounts.count}`);

    const recentHoldings = db.prepare(`
      SELECT ia.account_name, ih.current_value, ih.as_of_date
      FROM investment_holdings ih
      JOIN investment_accounts ia ON ih.account_id = ia.id
      WHERE ia.account_type = 'bank_balance'
      ORDER BY ih.as_of_date DESC
      LIMIT 5
    `).all();

    if (recentHoldings.length > 0) {
      console.log('\nRecent holdings:');
      recentHoldings.forEach(h => {
        console.log(`  - ${h.account_name}: ₪${h.current_value} (${h.as_of_date})`);
      });
    }

    console.log('\n✓ Migration verification complete\n');
  }

  process.exit(0);
} catch (error) {
  console.error('\n❌ Migration failed:', error);

  if (!isDryRun) {
    try {
      db.exec('ROLLBACK');
      console.log('✓ Changes rolled back\n');
    } catch (rollbackError) {
      console.error('❌ Failed to rollback:', rollbackError);
    }
  }

  process.exit(1);
} finally {
  db.close();
}
