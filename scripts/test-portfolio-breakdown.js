#!/usr/bin/env node
/**
 * Test script to verify bank balances are not double-counted in portfolio breakdown
 */

const { getInvestmentSummary } = require('../app/server/services/investments/summary.js');

async function testPortfolioBreakdown() {
  console.log('Testing portfolio breakdown for double-counting...\n');

  try {
    const summary = await getInvestmentSummary({ historyMonths: 6 });

    console.log('Portfolio Summary:');
    console.log('==================');
    console.log(`Total Portfolio Value: ₪${summary.summary.totalPortfolioValue.toLocaleString()}`);
    console.log(`Total Accounts: ${summary.summary.totalAccounts}`);
    console.log(`Accounts with Values: ${summary.summary.accountsWithValues}\n`);

    console.log('Breakdown by Account Type:');
    console.log('==========================');

    // Group breakdown items that might be duplicates
    const typeMap = new Map();

    summary.breakdown.forEach((item) => {
      const key = item.type;
      if (typeMap.has(key)) {
        console.warn(`⚠️  WARNING: Duplicate account type found: ${key}`);
        console.warn(`   Previous: ${typeMap.get(key).name} - ₪${typeMap.get(key).totalValue.toLocaleString()}`);
        console.warn(`   Current:  ${item.name} - ₪${item.totalValue.toLocaleString()}\n`);
      }
      typeMap.set(key, item);

      console.log(`${item.name} (${item.type}):`);
      console.log(`  Total Value: ₪${item.totalValue.toLocaleString()}`);
      console.log(`  Percentage: ${item.percentage.toFixed(2)}%`);
      console.log(`  Accounts: ${item.count}`);
      console.log('');
    });

    // Check for "bank_balance" and "savings" both appearing
    const hasBankBalance = summary.breakdown.some(b => b.type === 'bank_balance');
    const hasSavings = summary.breakdown.some(b => b.type === 'savings');

    if (hasBankBalance && hasSavings) {
      console.error('❌ ERROR: Both "bank_balance" and "savings" types found!');
      console.error('   This indicates double-counting of bank balances.\n');

      const bankBalance = summary.breakdown.find(b => b.type === 'bank_balance');
      const savings = summary.breakdown.find(b => b.type === 'savings');

      console.error(`   bank_balance: ₪${bankBalance.totalValue.toLocaleString()}`);
      console.error(`   savings: ₪${savings.totalValue.toLocaleString()}`);
      console.error(`   Combined: ₪${(bankBalance.totalValue + savings.totalValue).toLocaleString()}\n`);

      process.exit(1);
    } else if (hasBankBalance) {
      console.log('✅ SUCCESS: Bank balances found only in "bank_balance" type');
    } else if (hasSavings) {
      console.log('✅ SUCCESS: Bank balances found only in "savings" type');
    } else {
      console.log('ℹ️  INFO: No bank balance accounts found');
    }

    console.log('\nLiquid Category Summary:');
    console.log('========================');
    console.log(`Total Value: ₪${summary.summary.liquid.totalValue.toLocaleString()}`);
    console.log(`Accounts: ${summary.summary.liquid.accountsCount}`);

  } catch (error) {
    console.error('Error testing portfolio breakdown:', error);
    process.exit(1);
  }
}

testPortfolioBreakdown();
