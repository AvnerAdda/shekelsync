#!/usr/bin/env node
/**
 * Backpopulate Portfolio History Script
 * 
 * This script fills in missing dates in the investment_holdings table by forward-filling
 * from the last known value. This ensures portfolio history charts show continuous data
 * without gaps.
 * 
 * For each investment account:
 * 1. Find the earliest and latest snapshot dates
 * 2. Fill in all missing dates using the last known value (forward-fill)
 * 
 * Usage: node scripts/backpopulate-portfolio-history.js
 */

const database = require('../app/server/services/database.js');

/**
 * Get all investment accounts
 */
async function getAllAccounts() {
  const result = await database.query(`
    SELECT 
      ia.id,
      ia.account_name,
      ia.account_type,
      ia.institution_id
    FROM investment_accounts ia
    WHERE ia.is_active = 1
    ORDER BY ia.id
  `);
  return result.rows;
}

/**
 * Get all existing snapshots for an account, ordered by date
 */
async function getAccountSnapshots(accountId) {
  const result = await database.query(`
    SELECT 
      id,
      as_of_date,
      current_value,
      cost_basis,
      asset_type,
      holding_type
    FROM investment_holdings
    WHERE account_id = $1
    ORDER BY as_of_date ASC
  `, [accountId]);
  return result.rows;
}

/**
 * Insert a snapshot for a given date (if it doesn't exist)
 */
async function insertSnapshot(accountId, date, currentValue, costBasis, assetType = 'cash') {
  await database.query(`
    INSERT INTO investment_holdings (
      account_id, current_value, cost_basis, as_of_date, asset_type, notes
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (account_id, as_of_date) DO NOTHING
  `, [
    accountId,
    currentValue,
    costBasis,
    date,
    assetType,
    'Backpopulated from previous snapshot',
  ]);
}

/**
 * Get all dates between two dates (inclusive of start, exclusive of end)
 */
function getDatesBetween(startDate, endDate) {
  const dates = [];
  const currentDate = new Date(startDate);
  currentDate.setDate(currentDate.getDate() + 1); // Start from day after
  
  const end = new Date(endDate);
  
  while (currentDate < end) {
    dates.push(currentDate.toISOString().split('T')[0]);
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return dates;
}

/**
 * Backpopulate history for a single account
 */
async function backpopulateAccount(account) {
  const snapshots = await getAccountSnapshots(account.id);
  
  if (snapshots.length === 0) {
    console.log(`  Account ${account.id} (${account.account_name}): No snapshots found, skipping`);
    return { filled: 0, accountId: account.id };
  }
  
  if (snapshots.length === 1) {
    console.log(`  Account ${account.id} (${account.account_name}): Only 1 snapshot, nothing to backpopulate`);
    return { filled: 0, accountId: account.id };
  }
  
  // Build a map of existing dates
  const existingDates = new Set(snapshots.map(s => {
    // Normalize date format - handle both Date objects and strings
    const dateVal = s.as_of_date;
    if (dateVal instanceof Date) {
      return dateVal.toISOString().split('T')[0];
    }
    return String(dateVal).split('T')[0];
  }));
  
  let totalFilled = 0;
  
  // Iterate through snapshots and fill gaps
  for (let i = 0; i < snapshots.length - 1; i++) {
    const currentSnapshot = snapshots[i];
    const nextSnapshot = snapshots[i + 1];
    
    // Normalize dates
    const currentDate = currentSnapshot.as_of_date instanceof Date 
      ? currentSnapshot.as_of_date.toISOString().split('T')[0]
      : String(currentSnapshot.as_of_date).split('T')[0];
    const nextDate = nextSnapshot.as_of_date instanceof Date
      ? nextSnapshot.as_of_date.toISOString().split('T')[0]
      : String(nextSnapshot.as_of_date).split('T')[0];
    
    // Get missing dates between current and next snapshot
    const missingDates = getDatesBetween(currentDate, nextDate)
      .filter(d => !existingDates.has(d));
    
    if (missingDates.length > 0) {
      // Forward-fill with current snapshot's values
      for (const date of missingDates) {
        await insertSnapshot(
          account.id,
          date,
          currentSnapshot.current_value,
          currentSnapshot.cost_basis,
          currentSnapshot.asset_type || 'cash'
        );
        totalFilled++;
      }
    }
  }
  
  if (totalFilled > 0) {
    console.log(`  Account ${account.id} (${account.account_name}): Filled ${totalFilled} missing dates`);
  } else {
    console.log(`  Account ${account.id} (${account.account_name}): No gaps found`);
  }
  
  return { filled: totalFilled, accountId: account.id };
}

/**
 * Also fill from last snapshot to today for all accounts
 */
async function fillToToday(account) {
  const snapshots = await getAccountSnapshots(account.id);
  
  if (snapshots.length === 0) {
    return { filled: 0, accountId: account.id };
  }
  
  const lastSnapshot = snapshots[snapshots.length - 1];
  const lastDate = lastSnapshot.as_of_date instanceof Date
    ? lastSnapshot.as_of_date.toISOString().split('T')[0]
    : String(lastSnapshot.as_of_date).split('T')[0];
  
  const today = new Date().toISOString().split('T')[0];
  
  const missingDates = getDatesBetween(lastDate, today);
  // Also include today
  missingDates.push(today);
  
  let filled = 0;
  for (const date of missingDates) {
    await insertSnapshot(
      account.id,
      date,
      lastSnapshot.current_value,
      lastSnapshot.cost_basis,
      lastSnapshot.asset_type || 'cash'
    );
    filled++;
  }
  
  if (filled > 0) {
    console.log(`  Account ${account.id} (${account.account_name}): Extended to today (+${filled} days)`);
  }
  
  return { filled, accountId: account.id };
}

/**
 * Main execution
 */
async function main() {
  console.log('=================================================');
  console.log('  Portfolio History Backpopulation Script');
  console.log('=================================================\n');
  
  try {
    const accounts = await getAllAccounts();
    console.log(`Found ${accounts.length} active investment accounts\n`);
    
    if (accounts.length === 0) {
      console.log('No accounts to process. Exiting.');
      return;
    }
    
    // Phase 1: Fill historical gaps
    console.log('Phase 1: Filling historical gaps...');
    console.log('-'.repeat(40));
    
    let totalHistoricalFilled = 0;
    for (const account of accounts) {
      const result = await backpopulateAccount(account);
      totalHistoricalFilled += result.filled;
    }
    
    console.log(`\nHistorical gaps filled: ${totalHistoricalFilled} dates\n`);
    
    // Phase 2: Fill to today
    console.log('Phase 2: Extending to today...');
    console.log('-'.repeat(40));
    
    let totalExtended = 0;
    for (const account of accounts) {
      const result = await fillToToday(account);
      totalExtended += result.filled;
    }
    
    console.log(`\nExtended to today: ${totalExtended} dates\n`);
    
    // Summary
    console.log('=================================================');
    console.log('  Summary');
    console.log('=================================================');
    console.log(`  Accounts processed: ${accounts.length}`);
    console.log(`  Historical gaps filled: ${totalHistoricalFilled}`);
    console.log(`  Extended to today: ${totalExtended}`);
    console.log(`  Total dates added: ${totalHistoricalFilled + totalExtended}`);
    console.log('=================================================');
    
  } catch (error) {
    console.error('Error during backpopulation:', error);
    process.exit(1);
  } finally {
    await database.close();
  }
}

main();
