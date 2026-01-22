#!/usr/bin/env node

/**
 * Cleanup script to delete orphaned transactions
 *
 * This script finds and deletes transactions whose vendor doesn't exist
 * in vendor_credentials (orphaned transactions from deleted accounts).
 *
 * Run with: node scripts/cleanup-orphaned-transactions.js
 * Dry run:  node scripts/cleanup-orphaned-transactions.js --dry-run
 */

const path = require('node:path');
const database = require(path.join(__dirname, '../app/server/services/database.js'));

async function cleanupOrphanedTransactions(dryRun = false) {
  const client = await database.getClient();

  try {
    console.log('Starting orphaned transactions cleanup...\n');
    console.log(dryRun ? '🔍 DRY RUN MODE - No changes will be made\n' : '');

    // Step 1: Find all vendors in transactions that don't exist in vendor_credentials
    const orphanedVendorsResult = await client.query(`
      SELECT DISTINCT t.vendor, COUNT(*) as transaction_count
      FROM transactions t
      LEFT JOIN vendor_credentials vc ON t.vendor = vc.vendor
      WHERE vc.id IS NULL
      GROUP BY t.vendor
      ORDER BY transaction_count DESC
    `);

    if (orphanedVendorsResult.rows.length === 0) {
      console.log('✓ No orphaned transactions found. All transactions have valid vendor credentials!');
      return { deleted: 0, vendors: [] };
    }

    console.log('Found orphaned transactions for the following vendors:\n');
    let totalOrphaned = 0;
    for (const row of orphanedVendorsResult.rows) {
      console.log(`  - ${row.vendor}: ${row.transaction_count} transaction(s)`);
      totalOrphaned += parseInt(row.transaction_count, 10);
    }
    console.log(`\n  Total: ${totalOrphaned} orphaned transaction(s)\n`);

    if (dryRun) {
      console.log('🔍 DRY RUN: Would delete these transactions. Run without --dry-run to actually delete.');
      return { deleted: 0, wouldDelete: totalOrphaned, vendors: orphanedVendorsResult.rows.map(r => r.vendor) };
    }

    // Step 2: Delete orphaned transactions
    console.log('Deleting orphaned transactions...');

    const deleteResult = await client.query(`
      DELETE FROM transactions
      WHERE vendor IN (
        SELECT DISTINCT t.vendor
        FROM transactions t
        LEFT JOIN vendor_credentials vc ON t.vendor = vc.vendor
        WHERE vc.id IS NULL
      )
    `);

    const deletedCount = deleteResult?.rowCount || 0;

    console.log(`\n✅ Successfully deleted ${deletedCount} orphaned transaction(s)!`);

    return {
      deleted: deletedCount,
      vendors: orphanedVendorsResult.rows.map(r => r.vendor)
    };

  } catch (error) {
    console.error('\n❌ Error cleaning up orphaned transactions:', error);
    throw error;
  } finally {
    client.release();
    await database.close();
  }
}

// Run the cleanup
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');

  (async () => {
    try {
      await cleanupOrphanedTransactions(dryRun);
      console.log('\nCleanup completed successfully!');
      process.exit(0);
    } catch (error) {
      console.error('\nCleanup failed:', error);
      process.exit(1);
    }
  })();
}

module.exports = { cleanupOrphanedTransactions };
