#!/usr/bin/env node

/**
 * Populate Portfolio Values Script
 * 
 * This script populates your investment portfolio with initial values
 * using the investments API endpoints.
 * 
 * Usage:
 *   node scripts/populate-portfolio-values.js
 */

const portfolioData = [
  {
    accountName: 'Interactive Brokers',
    currentValue: 21024.00,
    asOfDate: '2025-10-15',
    notes: 'Initial portfolio setup'
  },
  {
    accountName: 'Bits of Gold',
    currentValue: 20817.00,
    asOfDate: '2025-10-15',
    notes: 'Initial portfolio setup'
  },
  {
    accountName: 'Koupat Guemel',
    currentValue: 80149.00,
    asOfDate: '2025-10-15',
    notes: 'Initial portfolio setup'
  },
  {
    accountName: 'Pikadon',
    currentValue: 321492.00,
    asOfDate: '2025-10-15',
    notes: 'Initial portfolio setup'
  },
  {
    accountName: 'Keren Hashtalmout',
    currentValue: 88130.00,
    asOfDate: '2025-10-15',
    notes: 'Initial portfolio setup'
  },
  {
    accountName: 'Pension Fund',
    currentValue: 286134.00,
    asOfDate: '2025-10-15',
    notes: 'Initial portfolio setup'
  }
];

const API_BASE = 'http://localhost:3000/api/investments';

async function populatePortfolio() {
  console.log('🚀 Starting portfolio population...\n');

  try {
    // 1. Fetch all accounts
    console.log('📊 Fetching existing accounts...');
    const accountsResponse = await fetch(`${API_BASE}/accounts`);
    if (!accountsResponse.ok) {
      throw new Error(`Failed to fetch accounts: ${accountsResponse.statusText}`);
    }
    const accountsData = await accountsResponse.json();
    const accounts = accountsData.accounts || [];
    
    console.log(`✅ Found ${accounts.length} accounts\n`);

    // 2. Map account names to IDs
    const accountMap = new Map();
    accounts.forEach(account => {
      accountMap.set(account.account_name.toLowerCase(), account.id);
    });

    // 3. Populate holdings for each account
    let successCount = 0;
    let totalValue = 0;

    for (const data of portfolioData) {
      const accountKey = data.accountName.toLowerCase();
      
      // Try to find account by partial match
      let accountId = null;
      for (const [name, id] of accountMap.entries()) {
        if (name.includes(accountKey.split(' ')[0].toLowerCase()) || 
            accountKey.includes(name.split(' ')[0])) {
          accountId = id;
          break;
        }
      }

      if (!accountId) {
        console.log(`⚠️  Account not found: ${data.accountName} - Please create it first`);
        continue;
      }

      console.log(`📈 Adding value for ${data.accountName}...`);
      
      const holdingData = {
        account_id: accountId,
        current_value: data.currentValue,
        cost_basis: data.costBasis || null,
        as_of_date: data.asOfDate,
        notes: data.notes,
        save_history: true
      };

      const response = await fetch(`${API_BASE}/holdings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(holdingData)
      });

      if (response.ok) {
        console.log(`   ✅ ${data.accountName}: ₪${data.currentValue.toLocaleString()}`);
        successCount++;
        totalValue += data.currentValue;
      } else {
        const error = await response.text();
        console.log(`   ❌ Failed: ${error}`);
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log(`✅ Successfully populated ${successCount} accounts`);
    console.log(`💰 Total Portfolio Value: ₪${totalValue.toLocaleString()}`);
    console.log('='.repeat(50));

    // 4. Verify the data
    console.log('\n📊 Fetching portfolio summary...');
    const summaryResponse = await fetch(`${API_BASE}/summary`);
    if (summaryResponse.ok) {
      const summary = await summaryResponse.json();
      console.log('\n✅ Portfolio Summary:');
      console.log(`   Total Value: ₪${summary.totalValue?.toLocaleString() || 0}`);
      console.log(`   Total Invested: ₪${summary.totalInvested?.toLocaleString() || 0}`);
      console.log(`   Accounts: ${summary.accountsCount || 0}`);
      
      if (summary.byType) {
        console.log('\n📂 Breakdown by Type:');
        summary.byType.forEach(type => {
          console.log(`   ${type.type}: ₪${type.totalValue.toLocaleString()}`);
        });
      }
    }

    console.log('\n🎉 Portfolio population complete!');
    console.log('👉 Check your Investments page to see the data\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
populatePortfolio();
