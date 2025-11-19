#!/usr/bin/env node
/**
 * Test Script: Bank Balance Dashboard API
 *
 * Verifies that the dashboard API returns bank balance data correctly
 */

const path = require('path');
const dashboardService = require('../app/server/services/analytics/dashboard.js');
const database = require('../app/server/services/database.js');

async function testBankBalanceAPI() {
  console.log('\n=== Testing Bank Balance Dashboard API ===\n');

  try {
    // Test 1: Current month data
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    console.log('Test 1: Fetching current month dashboard data...');
    console.log(`Date Range: ${startOfMonth.toISOString().split('T')[0]} to ${endOfMonth.toISOString().split('T')[0]}`);

    const result = await dashboardService.getDashboardAnalytics({
      startDate: startOfMonth.toISOString(),
      endDate: endOfMonth.toISOString(),
      aggregation: 'daily'
    });

    console.log('\n✓ Dashboard API Response Structure:');
    console.log('  - dateRange:', result.dateRange);
    console.log('  - summary keys:', Object.keys(result.summary));
    console.log('  - history entries:', result.history.length);
    console.log('  - breakdown keys:', Object.keys(result.breakdowns));

    // Check bank balance fields
    console.log('\n✓ Bank Balance Fields:');
    console.log(`  - currentBankBalance: ${result.summary.currentBankBalance !== undefined ? '₪' + result.summary.currentBankBalance : 'MISSING'}`);
    console.log(`  - monthStartBankBalance: ${result.summary.monthStartBankBalance !== undefined ? '₪' + result.summary.monthStartBankBalance : 'MISSING'}`);
    console.log(`  - bankBalanceChange: ${result.summary.bankBalanceChange !== undefined ? '₪' + result.summary.bankBalanceChange : 'MISSING'}`);

    // Check per-bank breakdown
    if (result.breakdowns.byBankAccount) {
      console.log(`\n✓ Per-Bank Account Breakdown: ${result.breakdowns.byBankAccount.length} accounts`);
      result.breakdowns.byBankAccount.forEach((account, idx) => {
        console.log(`  ${idx + 1}. ${account.accountName}: ₪${account.currentBalance} (as of ${account.asOfDate})`);
      });
    } else {
      console.log('\n⚠️  byBankAccount breakdown: MISSING');
    }

    // Check history includes bankBalance
    console.log('\n✓ History Sample (first 3 entries):');
    result.history.slice(0, 3).forEach((entry, idx) => {
      console.log(`  ${idx + 1}. ${entry.date}: Income=₪${entry.income}, Expenses=₪${entry.expenses}, BankBalance=${entry.bankBalance !== undefined ? '₪' + entry.bankBalance : 'MISSING'}`);
    });

    // Test 2: Check month-start snapshot exists
    console.log('\n\nTest 2: Verifying month-start snapshot...');
    const monthStartDate = `${startOfMonth.toISOString().substring(0, 7)}-01`;
    const monthStartCheck = await database.query(
      `SELECT COUNT(*) as count, SUM(total_value) as total
       FROM investment_holdings_history ihh
       JOIN investment_accounts ia ON ihh.account_id = ia.id
       WHERE ia.account_type = 'bank_balance'
         AND ia.is_active = 1
         AND ihh.snapshot_date = $1`,
      [monthStartDate]
    );

    console.log(`  Month-start date: ${monthStartDate}`);
    console.log(`  Snapshots found: ${monthStartCheck.rows[0].count}`);
    console.log(`  Total balance: ₪${monthStartCheck.rows[0].total || 0}`);

    // Summary
    console.log('\n=== Test Results ===');
    const tests = [
      { name: 'Dashboard API returns data', pass: result !== null },
      { name: 'currentBankBalance field exists', pass: result.summary.currentBankBalance !== undefined },
      { name: 'monthStartBankBalance field exists', pass: result.summary.monthStartBankBalance !== undefined },
      { name: 'bankBalanceChange field exists', pass: result.summary.bankBalanceChange !== undefined },
      { name: 'byBankAccount breakdown exists', pass: result.breakdowns.byBankAccount !== undefined },
      { name: 'History includes bankBalance', pass: result.history.length > 0 && result.history[0].bankBalance !== undefined }
    ];

    tests.forEach(test => {
      console.log(`  ${test.pass ? '✓' : '✗'} ${test.name}`);
    });

    const allPassed = tests.every(t => t.pass);
    console.log(`\n${allPassed ? '🎉 All tests passed!' : '⚠️  Some tests failed'}\n`);

    process.exit(allPassed ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Error during test:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

testBankBalanceAPI();
