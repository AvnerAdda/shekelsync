#!/usr/bin/env node
/**
 * Seed synthetic transactions for analytics/benchmarking.
 *
 * Usage:
 *   node scripts/seed_synthetic_transactions.js --count 300 --months 6
 */

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_NODE_MODULES = path.join(PROJECT_ROOT, 'app', 'node_modules');
const Database = require(path.join(APP_NODE_MODULES, 'better-sqlite3'));

const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite');
const EXPENSE_VENDOR_POOL = [
  { vendor: 'Shufersal', nickname: 'Shufersal', categoryHint: 'סופרמרקט' },
  { vendor: 'Rami Levy', nickname: 'RamiLevy', categoryHint: 'סופרמרקט' },
  { vendor: 'Paz', nickname: 'Paz', categoryHint: 'דלק' },
  { vendor: 'Delek', nickname: 'Delek', categoryHint: 'דלק' },
  { vendor: 'Egged', nickname: 'Egged', categoryHint: 'תחבורה ציבורית' },
  { vendor: 'Aroma', nickname: 'Aroma', categoryHint: 'קפה' },
  { vendor: 'Cafe Greg', nickname: 'Greg', categoryHint: 'קפה ומאפה' },
  { vendor: 'Bezeq', nickname: 'Bezeq', categoryHint: 'תקשורת' },
  { vendor: 'Cellcom', nickname: 'Cellcom', categoryHint: 'תקשורת' },
  { vendor: 'IKEA', nickname: 'IKEA', categoryHint: 'רהיטים' },
];
const INCOME_VENDOR_POOL = [
  { vendor: 'Acme Corp Payroll', nickname: 'Payroll', categoryHint: 'משכורת' },
  { vendor: 'Savings Interest', nickname: 'Interest', categoryHint: 'ריבית' },
  { vendor: 'Rental Income', nickname: 'Rental', categoryHint: 'שכירות' },
  { vendor: 'Freelance Payouts', nickname: 'Freelance', categoryHint: 'פרילנס' },
  { vendor: 'Dividends Inc', nickname: 'Dividends', categoryHint: 'דיבידנד' },
];
const INVESTMENT_VENDOR_POOL = [
  { vendor: 'IBI Brokerage', nickname: 'IBI', categoryHint: 'מניות' },
  { vendor: 'Meitav Dash', nickname: 'Meitav', categoryHint: 'קרנות נאמנות' },
  { vendor: 'Harel', nickname: 'Harel', categoryHint: 'פנסיה' },
  { vendor: 'Altshuler', nickname: 'Altshuler', categoryHint: 'קופות גמל' },
  { vendor: 'Pension Fund', nickname: 'Pension', categoryHint: 'פנסיה' },
];
const CREDIT_CARD_VENDORS = ['max', 'isracard', 'visaCal'];
const BANK_VENDOR = 'discount';

function parseArgs() {
  const args = process.argv.slice(2);
  let output = DEFAULT_DB_PATH;
  let expenseCount = 250;
  let incomeCount = 150;
  let investmentCount = 100;
  let months = 6;
  let startOffsetMonths = 0;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--db':
      case '--database':
      case '-d':
        output = path.resolve(PROJECT_ROOT, args[++i]);
        break;
      case '--count':
      case '--expense-count':
      case '-c':
        expenseCount = Number(args[++i]) || expenseCount;
        break;
      case '--income-count':
        incomeCount = Number(args[++i]) || incomeCount;
        break;
      case '--investment-count':
        investmentCount = Number(args[++i]) || investmentCount;
        break;
      case '--months':
      case '-m':
        months = Number(args[++i]) || months;
        break;
      case '--start-offset-months':
      case '--start-offset':
        startOffsetMonths = Number(args[++i]) || startOffsetMonths;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { output, expenseCount, incomeCount, investmentCount, months, startOffsetMonths };
}

function printHelp() {
  console.log(`Usage: node scripts/seed_synthetic_transactions.js [options]

Options:
  -d, --db <path>              SQLite DB path (default: dist/clarify.sqlite)
  -c, --count <number>         Expense transactions to seed (default: 250)
      --income-count <number>  Income transactions to seed (default: 150)
      --investment-count <num> Investment transactions to seed (default: 100)
  -m, --months <number>        Spread transactions across past N months (default: 6)
      --start-offset-months    Shift the seeded range back by N months (default: 0)
  -h, --help                   Show this help message
`);
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateIdentifier(index) {
  return `synthetic-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`;
}

function pickCategory(categories, hint) {
  if (!categories.length) {
    return null;
  }
  if (hint) {
    const match = categories.find(cat => cat.name.toLowerCase().includes(hint.toLowerCase()));
    if (match) {
      return match;
    }
  }
  return categories[randomInt(0, categories.length - 1)];
}

function fetchCategories(db, categoryType) {
  // Prefer leaf categories to avoid assigning transactions to parents
  return db
    .prepare(
      `SELECT id, name FROM category_definitions
       WHERE category_type = ?
         AND depth_level >= 1
         AND is_active = 1
         AND id NOT IN (
           SELECT DISTINCT parent_id
           FROM category_definitions
           WHERE parent_id IS NOT NULL
         )`,
    )
    .all(categoryType);
}

function seedInvestmentAccounts(db, count = 3) {
  const insertedIds = [];
  const insertStmt = db.prepare(`
    INSERT INTO investment_accounts (
      account_name,
      account_type,
      institution,
      account_number,
      currency,
      is_active,
      is_liquid,
      investment_category
    ) VALUES (
      @accountName,
      @accountType,
      @institution,
      @accountNumber,
      'ILS',
      1,
      @isLiquid,
      @investmentCategory
    )
  `);

  const txn = db.transaction(() => {
    for (let i = 0; i < count; i += 1) {
      const result = insertStmt.run({
        accountName: `Synthetic Investment ${i + 1}`,
        accountType: i % 2 === 0 ? 'brokerage' : 'savings',
        institution: i % 2 === 0 ? 'Synthetic Brokerage' : 'Synthetic Bank',
        accountNumber: `INV-${1000 + i}`,
        isLiquid: i % 2 === 0 ? 1 : 0,
        investmentCategory: i % 2 === 0 ? 'stocks' : 'bonds',
      });
      insertedIds.push(result.lastInsertRowid);
    }
  });

  txn();
  return insertedIds;
}

function seedBankBalanceAccounts(db, count = 3, months = 6, startOffsetMonths = 0) {
  if (count <= 0) {
    return { bankAccounts: 0, historyEntries: 0 };
  }

  const banks = db
    .prepare(
      `SELECT id, display_name_en
       FROM financial_institutions
       WHERE institution_type = 'bank' AND vendor_code = ?
       LIMIT 1`,
    )
    .all(BANK_VENDOR);

  const insertAccountStmt = db.prepare(`
    INSERT INTO investment_accounts (
      account_name,
      account_type,
      institution,
      account_number,
      currency,
      is_active,
      is_liquid,
      investment_category,
      institution_id
    ) VALUES (
      @accountName,
      'bank_balance',
      @institution,
      @accountNumber,
      'ILS',
      1,
      1,
      'cash',
      @institutionId
    )
  `);

  const insertHoldingStmt = db.prepare(`
    INSERT OR REPLACE INTO investment_holdings (
      account_id,
      asset_name,
      asset_type,
      units,
      current_value,
      cost_basis,
      as_of_date,
      holding_type
    ) VALUES (
      @accountId,
      @assetName,
      @assetType,
      @units,
      @currentValue,
      @costBasis,
      @asOfDate,
      @holdingType
    )
  `);

  const insertHistoryStmt = db.prepare(`
    INSERT OR REPLACE INTO investment_holdings_history (
      account_id,
      total_value,
      cost_basis,
      snapshot_date
    ) VALUES (
      @accountId,
      @totalValue,
      @costBasis,
      @snapshotDate
    )
  `);

  const now = new Date();
  const startDate = new Date(now.getTime());
  startDate.setUTCMonth(startDate.getUTCMonth() - months - startOffsetMonths + 1);
  startDate.setUTCDate(1);

  let historyEntries = 0;
  const txn = db.transaction(() => {
    for (let i = 0; i < count; i += 1) {
      const bank = banks[i % banks.length];
      const accountResult = insertAccountStmt.run({
        accountName: bank
          ? `${bank.display_name_en} Checking ${i + 1}`
          : `Synthetic Checking ${i + 1}`,
        institution: bank?.display_name_en || 'Synthetic Bank',
        institutionId: bank?.id || null,
        accountNumber: `BANK-${randomInt(100000, 999999)}`,
      });
      const accountId = accountResult.lastInsertRowid;

      let balance = randomBetween(4000, 20000);
      const volatility = randomBetween(0.01, 0.03);
      const cursor = new Date(startDate.getTime());

      while (cursor <= now) {
        balance = Math.max(1000, balance * (1 + randomBetween(-volatility, volatility)));
        const snapshotDate = cursor.toISOString().split('T')[0];
        insertHistoryStmt.run({
          accountId,
          totalValue: balance,
          costBasis: balance * 0.95,
          snapshotDate,
        });
        historyEntries += 1;
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }

      insertHoldingStmt.run({
        accountId,
        assetName: 'Checking Balance',
        assetType: 'cash',
        units: 1,
        currentValue: balance,
        costBasis: balance,
        asOfDate: now.toISOString().split('T')[0],
        holdingType: 'bank_balance',
      });
    }
  });

  txn();
  return { bankAccounts: count, historyEntries };
}

function seedInvestmentHoldings(db, accountIds, months, startOffsetMonths = 0) {
  if (!accountIds.length) {
    return 0;
  }

  const insertStmt = db.prepare(`
    INSERT INTO investment_holdings (
      account_id,
      asset_name,
      asset_type,
      units,
      current_value,
      cost_basis,
      as_of_date,
      holding_type
    ) VALUES (
      @accountId,
      @assetName,
      @assetType,
      @units,
      @currentValue,
      @costBasis,
      @asOfDate,
      @holdingType
    )
  `);

  const startDate = new Date();
  startDate.setUTCMonth(startDate.getUTCMonth() - months - startOffsetMonths + 1);

  const txn = db.transaction(() => {
    accountIds.forEach((accountId, index) => {
      const entries = randomInt(3, 6);
      const usedDates = new Set();
      let attempts = 0;
      while (usedDates.size < entries && attempts < entries * 5) {
        attempts += 1;
        const daysOffset = randomInt(0, months * 30);
        const asOfDate = new Date(startDate.getTime());
        asOfDate.setUTCDate(asOfDate.getUTCDate() + daysOffset);
        const asOfDateStr = asOfDate.toISOString().split('T')[0];

        if (usedDates.has(asOfDateStr)) {
          continue;
        }
        usedDates.add(asOfDateStr);

        insertStmt.run({
          accountId,
          assetName: index % 2 === 0 ? `ETF-${usedDates.size}` : `Bond-${usedDates.size}`,
          assetType: index % 2 === 0 ? 'equity' : 'fixed_income',
          units: randomBetween(5, 20),
          currentValue: randomBetween(1000, 10000),
          costBasis: randomBetween(800, 9000),
          asOfDate: asOfDateStr,
          holdingType: index % 2 === 0 ? 'standard' : 'pikadon',
        });
      }
    });
  });

  txn();
  return accountIds.length;
}

function seedTransactions(
  db,
  {
    type,
    count,
    months,
    startOffsetMonths = 0,
    vendorPool,
    amountGenerator,
    entryType,
    maxTotal = null, // cap total absolute spend (used for expenses)
  },
) {
  if (count <= 0) {
    return { inserted: 0, total: 0 };
  }

  const categories = fetchCategories(db, type);
  if (categories.length === 0) {
    throw new Error(`No ${type} categories found; run init_sqlite_db first.`);
  }
  const startDate = new Date();
  startDate.setUTCMonth(startDate.getUTCMonth() - months - startOffsetMonths + 1);
  startDate.setUTCDate(1);

  const insertStmt = db.prepare(`
    INSERT INTO transactions (
      identifier,
      vendor,
      vendor_nickname,
      date,
      name,
      price,
      type,
      status,
      auto_categorized,
      confidence_score,
      account_number,
      category_definition_id,
      category_type,
      transaction_datetime
    ) VALUES (
      @identifier,
      @vendor,
      @vendorNickname,
      @date,
      @name,
      @price,
      @type,
      'completed',
      1,
      @confidence,
      @accountNumber,
      @categoryId,
      @categoryType,
      @transactionDateTime
    )
  `);

  // Income seeding: cap to 1-3 deposits per month and bias to start of month
  let effectiveCount = count;
  if (type === 'income') {
    const depositsPerMonth = randomInt(1, 3);
    effectiveCount = Math.min(count, months * depositsPerMonth);
  }

  let totalAmount = 0;

  const txn = db.transaction(() => {
    for (let i = 0; i < effectiveCount; i += 1) {
      if (maxTotal !== null && type === 'expense' && totalAmount >= maxTotal) {
        break;
      }

      const vendorInfo = vendorPool[randomInt(0, vendorPool.length - 1)];
      const category = pickCategory(categories, vendorInfo.categoryHint);
      const monthOffset = Math.floor(i / Math.max(1, Math.floor(effectiveCount / months)));
      const baseDate = new Date(startDate.getTime());
      baseDate.setUTCMonth(baseDate.getUTCMonth() + monthOffset);

      const daysOffset =
        type === 'income'
          ? randomInt(0, 4) // first 5 days of the month
          : randomInt(0, 27);
      const txnDate = new Date(baseDate.getTime());
      txnDate.setUTCDate(1 + daysOffset);

      let amount = amountGenerator();
      if (type === 'expense') {
        amount = -Math.max(4, Math.min(1000, Math.abs(amount)));
        if (maxTotal !== null) {
          const remaining = Math.max(0, maxTotal - totalAmount);
          if (remaining <= 0) break;
          amount = -Math.min(Math.abs(amount), remaining);
        }
      } else if (type === 'income') {
        amount = Math.max(5000, Math.min(22000, Math.abs(amount)));
      }

      insertStmt.run({
        identifier: generateIdentifier(i),
        vendor: vendorInfo.vendor,
        vendorNickname: vendorInfo.nickname,
        date: txnDate.toISOString().split('T')[0],
        name: `${vendorInfo.vendor} Purchase`,
        price: amount,
        type: entryType,
        confidence: randomBetween(0.6, 0.99),
        accountNumber:
          type === 'expense'
            ? `CC-${CREDIT_CARD_VENDORS[randomInt(0, CREDIT_CARD_VENDORS.length - 1)].toUpperCase()}-${randomInt(1000, 9999)}`
            : `ACC-${randomInt(1000, 9999)}`,
        categoryId: category?.id || null,
        categoryType: type,
        transactionDateTime: txnDate.toISOString(),
      });

      totalAmount += Math.abs(amount);
    }
  });

  txn();
  return { inserted: effectiveCount, total: totalAmount };
}

function seedVendorCredentials(db, vendorPools) {
  const allVendors = vendorPools.flatMap((pool) => pool.map((vendor) => vendor.vendor));
  const uniqueVendors = Array.from(new Set(allVendors));

  if (uniqueVendors.length === 0) {
    return 0;
  }

  // Ensure credit card and bank vendors are included (single bank + up to 3 cards)
  CREDIT_CARD_VENDORS.forEach((cc) => uniqueVendors.push(cc));
  uniqueVendors.push(BANK_VENDOR);

  const institutions = db
    .prepare(
      `SELECT id
       FROM financial_institutions
       WHERE is_active = 1
       ORDER BY display_order, id`,
    )
    .all();

  if (institutions.length === 0) {
    throw new Error('No financial institutions found; run init_sqlite_db first.');
  }

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO vendor_credentials (
      id_number,
      username,
      vendor,
      nickname,
      bank_account_number,
      last_scrape_status,
      last_scrape_success,
      created_at,
      updated_at,
      institution_id
    ) VALUES (
      @idNumber,
      @username,
      @vendor,
      @nickname,
      @accountNumber,
      'success',
      @lastScrapeSuccess,
      datetime('now'),
      datetime('now'),
      @institutionId
    )
  `);

  let inserted = 0;
  const txn = db.transaction(() => {
    uniqueVendors.forEach((vendorName, index) => {
      const institutionId = institutions[index % institutions.length]?.id || null;
      const result = insertStmt.run({
        idNumber: `SYNTH-ID-${index}`,
        username: `synthetic_user_${index}`,
        vendor: vendorName,
        nickname: vendorName.slice(0, 10),
        accountNumber: `SYNTH-${1000 + index}`,
        lastScrapeSuccess: new Date().toISOString(),
        institutionId,
      });
      inserted += result.changes || 0;
    });
  });

  txn();
  return inserted;
}

function main() {
  const {
    output,
    expenseCount,
    incomeCount,
    investmentCount,
    months,
    startOffsetMonths,
  } = parseArgs();

  if (!fs.existsSync(output)) {
    throw new Error(`Database not found at ${output}. Run init_sqlite_db first or specify --db.`);
  }

  const db = new Database(output);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  try {
    // Seed income first so we can cap expenses below total income
    const incomeResult = seedTransactions(db, {
      type: 'income',
      count: incomeCount,
      months,
      startOffsetMonths,
      vendorPool: INCOME_VENDOR_POOL,
      // Typical salary/side-income deposit (₪5k–22k)
      amountGenerator: () => Math.abs(randomBetween(5000, 22000)),
      entryType: 'transfer',
    });

    // Cap expenses to 90% of total income
    const expenseCap = Math.max(0, incomeResult.total * 0.9);

    const expenseResult = seedTransactions(db, {
      type: 'expense',
      count: expenseCount,
      months,
      startOffsetMonths,
      vendorPool: EXPENSE_VENDOR_POOL,
      // Typical Israeli household card spend (₪4–1000)
      amountGenerator: () => -Math.abs(randomBetween(4, 1000)),
      entryType: 'card',
      maxTotal: expenseCap,
    });

    const investmentResult = seedTransactions(db, {
      type: 'investment',
      count: investmentCount,
      months,
      startOffsetMonths,
      vendorPool: INVESTMENT_VENDOR_POOL,
      // Smaller investment moves (₪300–3000)
      amountGenerator: () => -Math.abs(randomBetween(300, 3000)),
      entryType: 'investment',
    });

    const vendorCredentialCount = seedVendorCredentials(db, [
      EXPENSE_VENDOR_POOL,
      INCOME_VENDOR_POOL,
      INVESTMENT_VENDOR_POOL,
    ]);
    const investmentAccountIds = seedInvestmentAccounts(db, 4);
    const investmentHoldingsCount = seedInvestmentHoldings(
      db,
      investmentAccountIds,
      months,
      startOffsetMonths,
    );
    const bankAccountSeedResult = seedBankBalanceAccounts(
      db,
      1,
      months,
      startOffsetMonths,
    );

    const totalInserted = incomeResult.inserted + expenseResult.inserted + investmentResult.inserted;
    console.log(`✅ Inserted ${totalInserted} synthetic transactions into ${output}`);
    console.log(`   • Income total: ₪${Math.round(incomeResult.total)}`);
    console.log(`   • Expense total (capped at 90% of income): ₪${Math.round(expenseResult.total)}`);
    console.log(`✅ Ensured ${vendorCredentialCount} synthetic vendor credential records`);
    console.log(`✅ Seeded ${investmentAccountIds.length} investment accounts with holdings (${investmentHoldingsCount} accounts populated)`);
    console.log(
      `✅ Seeded ${bankAccountSeedResult.bankAccounts} bank balance accounts with ${bankAccountSeedResult.historyEntries} history snapshots`,
    );
  } finally {
    db.close();
  }
}

main();
