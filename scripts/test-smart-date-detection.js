#!/usr/bin/env node
/**
 * Test the smart date detection logic
 */

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');

process.env.SQLITE_DB_PATH = path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite');
process.env.CLARIFY_ENCRYPTION_KEY = process.env.CLARIFY_ENCRYPTION_KEY || '87f7918f185c02d06b1b606cc8acaf73e9048d1f1b9f2d3985654e53f6ef5dda';

const lastTransactionService = require(path.join(PROJECT_ROOT, 'app', 'server', 'services', 'accounts', 'last-transaction-date.js'));

async function testSmartDateDetection() {
  console.log('=== Testing Smart Date Detection ===\n');

  // Test 1: MAX Avner (has recent transactions)
  console.log('Test 1: MAX Avner (should start from day after last transaction)');
  const maxAvnerResult = await lastTransactionService.getLastTransactionDate({
    vendor: 'max',
    credentialNickname: 'MAX Avner',
  });
  console.log('  Result:', maxAvnerResult);
  console.log('  Start Date:', new Date(maxAvnerResult.lastTransactionDate).toISOString().split('T')[0]);
  console.log('');

  // Test 2: MAX Lois (also has transactions)
  console.log('Test 2: MAX Lois (should start from day after last transaction)');
  const maxLoisResult = await lastTransactionService.getLastTransactionDate({
    vendor: 'max',
    credentialNickname: 'MAX Lois',
  });
  console.log('  Result:', maxLoisResult);
  console.log('  Start Date:', new Date(maxLoisResult.lastTransactionDate).toISOString().split('T')[0]);
  console.log('');

  // Test 3: New credential (no transactions)
  console.log('Test 3: Fictional New Credential (should start from 3 months ago)');
  const newCredResult = await lastTransactionService.getLastTransactionDate({
    vendor: 'max',
    credentialNickname: 'MAX Non-Existent',
  });
  console.log('  Result:', newCredResult);
  console.log('  Start Date:', new Date(newCredResult.lastTransactionDate).toISOString().split('T')[0]);
  console.log('');

  // Test 4: Vendor-only query (backward compatibility)
  console.log('Test 4: Vendor-only query (backward compatibility)');
  const vendorOnlyResult = await lastTransactionService.getLastTransactionDate({
    vendor: 'max',
  });
  console.log('  Result:', vendorOnlyResult);
  console.log('  Start Date:', new Date(vendorOnlyResult.lastTransactionDate).toISOString().split('T')[0]);
  console.log('');

  console.log('=== Test Complete ===');
}

testSmartDateDetection().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
