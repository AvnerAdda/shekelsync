#!/usr/bin/env node
/**
 * Test script to scrape MAX Avner with 1-year lookback
 * This helps determine if the cards have no transactions or just no recent ones
 */

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Set environment
process.env.SQLITE_DB_PATH = path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite');
process.env.CLARIFY_ENCRYPTION_KEY = process.env.CLARIFY_ENCRYPTION_KEY || '87f7918f185c02d06b1b606cc8acaf73e9048d1f1b9f2d3985654e53f6ef5dda';

const scraperService = require(path.join(PROJECT_ROOT, 'app', 'server', 'services', 'scraping', 'run.js'));
const credentialsService = require(path.join(PROJECT_ROOT, 'app', 'server', 'services', 'credentials.js'));

async function testMaxAvner() {
  console.log('=== Testing MAX Avner with 1-year lookback ===\n');

  try {
    // Get MAX Avner credentials
    const allCreds = await credentialsService.listCredentials({ vendor: 'max' });
    const maxAvner = allCreds.find(c => c.nickname === 'MAX Avner');

    if (!maxAvner) {
      console.error('❌ MAX Avner credential not found');
      process.exit(1);
    }

    console.log(`✓ Found MAX Avner (ID: ${maxAvner.id})`);
    console.log(`  Username: ${maxAvner.username}`);
    console.log(`  Card numbers: ${maxAvner.card6_digits || 'Not set'}`);
    console.log('');

    // Calculate 1 year ago
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    console.log(`Scraping from: ${oneYearAgo.toISOString()}\n`);

    // Prepare scrape options
    const options = {
      companyId: 'max',
      startDate: oneYearAgo.toISOString(),
    };

    const credentials = {
      id: maxAvner.id,
      username: maxAvner.username,
      password: maxAvner.password,
      nickname: maxAvner.nickname,
    };

    console.log('Starting scrape...\n');

    // Run scrape
    const result = await scraperService.runScrape({
      options,
      credentials,
      logger: console,
    });

    console.log('\n=== Scrape Result ===');
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('\n✅ Scrape completed successfully!');
      console.log(`Accounts: ${result.accounts?.length || 0}`);
      console.log(`Bank transactions: ${result.bankTransactions || 0}`);
    } else {
      console.log('\n❌ Scrape failed');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testMaxAvner().then(() => {
  console.log('\n✓ Test complete');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
