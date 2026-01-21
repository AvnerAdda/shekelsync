#!/usr/bin/env node

/**
 * Migration script to fix miscategorized Credit Card Repayment transactions
 *
 * This script finds and fixes transactions that should be categorized as
 * Credit Card Repayment based on account pairing patterns, but are currently
 * in the wrong category.
 *
 * Run with: node scripts/fix-credit-card-categories.js
 */

const path = require('node:path');
const database = require(path.join(__dirname, '../app/server/services/database.js'));
const { getCreditCardRepaymentCategoryId } = require(path.join(__dirname, '../app/server/services/accounts/repayment-category.js'));

async function fixCreditCardCategories() {
  const client = await database.getClient();

  try {
    console.log('Starting Credit Card Repayment category fix...\n');

    // Step 1: Find the correct Credit Card Repayment category
    const creditCardRepaymentCategoryId = await getCreditCardRepaymentCategoryId(client);

    if (!creditCardRepaymentCategoryId) {
      console.error('ERROR: Credit Card Repayment category not found in database');
      console.error('Expected to find a category with name "פרעון כרטיס אשראי" or "Credit Card Repayment"');
      return;
    }

    console.log(`✓ Found Credit Card Repayment category ID: ${creditCardRepaymentCategoryId}`);

    // Step 2: Get all active account pairings
    const pairingsResult = await client.query(`
      SELECT
        id,
        bank_vendor,
        bank_account_number,
        match_patterns
      FROM account_pairings
      WHERE is_active = true
    `);

    if (pairingsResult.rows.length === 0) {
      console.log('\n✓ No active account pairings found. Nothing to fix!');
      return;
    }

    console.log(`\nFound ${pairingsResult.rows.length} active account pairing(s)`);

    // Step 3: Analyze what needs to be fixed
    console.log('\nAnalyzing miscategorized transactions...');

    let totalMiscategorized = 0;
    const categoryStats = {};

    for (const pairing of pairingsResult.rows) {
      const matchPatterns = pairing.match_patterns ? JSON.parse(pairing.match_patterns) : [];

      if (matchPatterns.length === 0) {
        continue;
      }

      const params = [pairing.bank_vendor];
      const conditions = matchPatterns.map((pattern, idx) => {
        params.push(pattern.toLowerCase());
        return `LOWER(t.name) LIKE '%' || $${idx + 2} || '%'`;
      });

      params.push(creditCardRepaymentCategoryId);
      const categoryIdParamIndex = params.length;

      let query = `
        SELECT
          t.category_definition_id,
          cd.name as category_name,
          COUNT(*) as count
        FROM transactions t
        LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
        WHERE vendor = $1
          AND (${conditions.join(' OR ')})
          AND (t.category_definition_id IS NULL OR t.category_definition_id != $${categoryIdParamIndex})
        GROUP BY t.category_definition_id, cd.name
      `;

      if (pairing.bank_account_number) {
        params.push(pairing.bank_account_number);
        query += ` HAVING 1=1`;
      }

      const analysisResult = await client.query(query, params);

      analysisResult.rows.forEach(row => {
        const catId = row.category_definition_id || 'NULL';
        const catName = row.category_name || 'Uncategorized';
        const count = Number.parseInt(row.count, 10);

        if (!categoryStats[catId]) {
          categoryStats[catId] = { name: catName, count: 0 };
        }
        categoryStats[catId].count += count;
        totalMiscategorized += count;
      });
    }

    if (totalMiscategorized === 0) {
      console.log('\n✓ No miscategorized transactions found. All transactions are correctly categorized!');
      return;
    }

    console.log('\nTransactions that need to be fixed:');
    Object.entries(categoryStats).forEach(([catId, stats]) => {
      console.log(`  - ${stats.count} transactions currently in: ${stats.name} (ID: ${catId})`);
    });
    console.log(`  Total: ${totalMiscategorized} transactions\n`);

    // Step 4: Fix the miscategorized transactions
    console.log('Fixing miscategorized transactions...');

    let totalFixed = 0;

    for (const pairing of pairingsResult.rows) {
      const matchPatterns = pairing.match_patterns ? JSON.parse(pairing.match_patterns) : [];

      if (matchPatterns.length === 0) {
        continue;
      }

      const params = [pairing.bank_vendor];
      const conditions = matchPatterns.map((pattern, idx) => {
        params.push(pattern.toLowerCase());
        return `LOWER(t.name) LIKE '%' || $${idx + 2} || '%'`;
      });

      params.push(creditCardRepaymentCategoryId);
      const categoryIdParamIndex = params.length;

      // Update transactions that match the pattern but aren't in the correct category
      let query = `
        UPDATE transactions
        SET category_definition_id = $${categoryIdParamIndex}
        WHERE vendor = $1
          AND (${conditions.join(' OR ')})
          AND (category_definition_id IS NULL OR category_definition_id != $${categoryIdParamIndex})
      `;

      if (pairing.bank_account_number) {
        params.push(pairing.bank_account_number);
        query += ` AND account_number = $${params.length}`;
      }

      const updateResult = await client.query(query, params);
      const updatedCount = updateResult?.rowCount || 0;

      if (updatedCount > 0) {
        console.log(`  ✓ Fixed ${updatedCount} transactions for pairing ${pairing.id} (${pairing.bank_vendor})`);
        totalFixed += updatedCount;
      }
    }

    console.log(`\n✅ Successfully fixed ${totalFixed} transactions!`);
    console.log('\nNext steps:');
    console.log('1. Verify the fix by checking the Category Management > Categories > Tree view');
    console.log('2. Credit Card Repayment transactions should now appear under:');
    console.log('   Bills & Utilities > Bank Settlements > Credit Card Repayment');

  } catch (error) {
    console.error('\n❌ Error fixing categories:', error);
    throw error;
  } finally {
    client.release();
    await database.close();
  }
}

// Run the migration
if (require.main === module) {
  (async () => {
    try {
      await fixCreditCardCategories();
      console.log('\nMigration completed successfully!');
      process.exit(0);
    } catch (error) {
      console.error('\nMigration failed:', error);
      process.exit(1);
    }
  })();
}

module.exports = { fixCreditCardCategories };
