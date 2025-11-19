#!/usr/bin/env node

/**
 * Test script for weekly matching stats API
 */

const pool = require('../app/utils/db.js');
const manualMatchingService = require('../app/server/services/investments/manual-matching.js');

async function testWeeklyStats() {
  console.log('Testing Weekly Matching Stats...\n');

  try {
    // Get a database client from the pool
    const client = await pool.connect();

    try {
      // Test parameters - adjust these based on your data
      const params = {
        creditCardAccountNumber: '', // Empty for all cards
        creditCardVendor: 'visaCal',    // Change to match your data
        bankVendor: 'discount',      // Change to match your data
        bankAccountNumber: null,
        matchPatterns: null,
        startDate: null,  // Will default to 12 weeks ago
        endDate: null     // Will default to now
      };

      console.log('Parameters:', JSON.stringify(params, null, 2));
      console.log('\nFetching weekly stats...\n');

      const weeklyStats = await manualMatchingService.getWeeklyMatchingStats(params, client);

      console.log(`Found ${weeklyStats.length} weeks of data:\n`);

      weeklyStats.forEach((week, index) => {
        const weekStart = new Date(week.weekStart).toLocaleDateString();
        const weekEnd = new Date(week.weekEnd).toLocaleDateString();

        console.log(`Week ${index + 1}: ${weekStart} - ${weekEnd}`);
        console.log(`  Bank:  Total=${week.bank.total}, Matched=${week.bank.matched}, Unmatched=${week.bank.unmatched}`);
        console.log(`  CC:    Total=${week.cc.total}, Matched=${week.cc.matched}, Unmatched=${week.cc.unmatched}`);
        console.log('');
      });

      // Show summary
      const totalBankTxns = weeklyStats.reduce((sum, w) => sum + w.bank.total, 0);
      const totalCCTxns = weeklyStats.reduce((sum, w) => sum + w.cc.total, 0);

      console.log('Summary:');
      console.log(`  Total Bank Repayments: ${totalBankTxns}`);
      console.log(`  Total CC Expenses: ${totalCCTxns}`);

    } finally {
      client.release();
    }

    console.log('\n✅ Test completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testWeeklyStats();
