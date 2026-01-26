#!/usr/bin/env node
/**
 * Seed realistic demo transactions matching real DB structure
 */
const path = require('path');
const Database = require(path.join(__dirname, '..', 'app', 'node_modules', 'better-sqlite3'));
const DB_PATH = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'dist', 'clarify-anonymized.sqlite');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Seed vendor credentials (accounts) first
const DEMO_CREDENTIALS = [
  { vendor: 'max', nickname: 'Max - כרטיס ראשי', username: 'demo_max', institution_id: null },
  { vendor: 'visaCal', nickname: 'Cal - כרטיס משני', username: 'demo_cal', institution_id: null },
  { vendor: 'discount', nickname: 'דיסקונט - עו"ש', username: 'demo_discount', bank_account_number: '0123456789', institution_id: null },
];

// Insert vendor credentials
const insertCredential = db.prepare(`
  INSERT OR IGNORE INTO vendor_credentials (vendor, nickname, username, bank_account_number, institution_id, last_scrape_status)
  VALUES (@vendor, @nickname, @username, @bankAccount, @institutionId, 'success')
`);

DEMO_CREDENTIALS.forEach((cred) => {
  insertCredential.run({
    vendor: cred.vendor,
    nickname: cred.nickname,
    username: cred.username,
    bankAccount: cred.bank_account_number || null,
    institutionId: cred.institution_id,
  });
});
console.log(`✅ Inserted ${DEMO_CREDENTIALS.length} vendor credentials`);

const EXPENSE_TRANSACTIONS = [
  // Supermarket (category 3)
  { name: 'שופרסל דיל', vendor: 'max', account: '1234', category: 3, minAmount: 80, maxAmount: 450 },
  { name: 'רמי לוי', vendor: 'max', account: '1234', category: 3, minAmount: 100, maxAmount: 600 },
  { name: 'יינות ביתן', vendor: 'visaCal', account: '9012', category: 3, minAmount: 50, maxAmount: 300 },
  { name: 'אושר עד', vendor: 'max', account: '5678', category: 3, minAmount: 60, maxAmount: 250 },
  { name: 'ויקטורי', vendor: 'max', account: '1234', category: 3, minAmount: 40, maxAmount: 200 },
  
  // Restaurants (category 4)
  { name: 'WOLT', vendor: 'max', account: '1234', category: 4, minAmount: 45, maxAmount: 180 },
  { name: 'ארומה', vendor: 'visaCal', account: '9012', category: 4, minAmount: 25, maxAmount: 80 },
  { name: 'מקדונלדס', vendor: 'max', account: '5678', category: 4, minAmount: 35, maxAmount: 120 },
  { name: 'גרג קפה', vendor: 'max', account: '1234', category: 4, minAmount: 30, maxAmount: 90 },
  { name: 'שיפודי התקווה', vendor: 'visaCal', account: '9012', category: 4, minAmount: 80, maxAmount: 250 },
  
  // Coffee & Bakery (category 5)
  { name: 'קפה קפה', vendor: 'max', account: '1234', category: 5, minAmount: 20, maxAmount: 65 },
  { name: 'רולדין', vendor: 'max', account: '5678', category: 5, minAmount: 25, maxAmount: 80 },
  { name: 'לחמנינה', vendor: 'visaCal', account: '9012', category: 5, minAmount: 15, maxAmount: 50 },
  
  // Delivery (category 6)
  { name: 'וולט משלוחים', vendor: 'max', account: '1234', category: 6, minAmount: 50, maxAmount: 150 },
  { name: 'תן ביס', vendor: 'max', account: '5678', category: 6, minAmount: 40, maxAmount: 120 },
  
  // Fuel (category 11)
  { name: 'פז', vendor: 'max', account: '1234', category: 11, minAmount: 150, maxAmount: 450 },
  { name: 'דלק', vendor: 'visaCal', account: '9012', category: 11, minAmount: 120, maxAmount: 400 },
  { name: 'סונול', vendor: 'max', account: '5678', category: 11, minAmount: 100, maxAmount: 350 },
  
  // Public Transport (category 12)
  { name: 'רב קו', vendor: 'max', account: '1234', category: 12, minAmount: 50, maxAmount: 150 },
  { name: 'אגד', vendor: 'visaCal', account: '9012', category: 12, minAmount: 10, maxAmount: 50 },
  
  // Parking (category 13)
  { name: 'אחוזות החוף', vendor: 'max', account: '1234', category: 13, minAmount: 15, maxAmount: 60 },
  { name: 'פנגו', vendor: 'max', account: '5678', category: 13, minAmount: 10, maxAmount: 40 },
  
  // Taxi (category 14)
  { name: 'גט טקסי', vendor: 'max', account: '1234', category: 14, minAmount: 25, maxAmount: 120 },
  { name: 'יאנגו', vendor: 'visaCal', account: '9012', category: 14, minAmount: 20, maxAmount: 100 },
  
  // Digital Wallets (category 30)
  { name: 'BIT', vendor: 'max', account: '1234', category: 30, minAmount: 20, maxAmount: 500 },
  { name: 'פייבוקס', vendor: 'max', account: '5678', category: 30, minAmount: 15, maxAmount: 300 },
  
  // Shopping - Fashion (category 57)
  { name: 'H&M', vendor: 'max', account: '1234', category: 57, minAmount: 100, maxAmount: 500 },
  { name: 'זארה', vendor: 'visaCal', account: '9012', category: 57, minAmount: 150, maxAmount: 600 },
  { name: 'קסטרו', vendor: 'max', account: '5678', category: 57, minAmount: 80, maxAmount: 400 },
  
  // Shopping Electronics (category 60)
  { name: 'KSP', vendor: 'max', account: '1234', category: 60, minAmount: 50, maxAmount: 800 },
  { name: 'BUG', vendor: 'visaCal', account: '9012', category: 60, minAmount: 80, maxAmount: 600 },
  { name: 'איביי', vendor: 'max', account: '5678', category: 60, minAmount: 30, maxAmount: 400 },
  
  // Home & Garden (category 61)
  { name: 'איקאה', vendor: 'max', account: '1234', category: 61, minAmount: 100, maxAmount: 1500 },
  { name: 'הום סנטר', vendor: 'visaCal', account: '9012', category: 61, minAmount: 50, maxAmount: 500 },
  { name: 'ACE', vendor: 'max', account: '5678', category: 61, minAmount: 30, maxAmount: 300 },
  
  // Health - Pharmacy (category 45)
  { name: 'סופר פארם', vendor: 'max', account: '5678', category: 45, minAmount: 30, maxAmount: 200 },
  { name: 'בי פארם', vendor: 'max', account: '1234', category: 45, minAmount: 20, maxAmount: 150 },
  
  // Health - Medical (category 44)
  { name: 'מכבי', vendor: 'discount', account: '0123456789', category: 44, minAmount: 25, maxAmount: 80 },
  { name: 'כללית', vendor: 'discount', account: '0123456789', category: 44, minAmount: 30, maxAmount: 100 },
  
  // Communication (category 52)
  { name: 'פלאפון', vendor: 'discount', account: '0123456789', category: 52, minAmount: 60, maxAmount: 120 },
  { name: 'הוט', vendor: 'discount', account: '0123456789', category: 52, minAmount: 150, maxAmount: 250 },
  { name: 'פרטנר', vendor: 'discount', account: '0123456789', category: 52, minAmount: 50, maxAmount: 100 },
  
  // Utilities - Electric (category 38)
  { name: 'חברת החשמל', vendor: 'discount', account: '0123456789', category: 38, minAmount: 200, maxAmount: 600 },
  
  // Utilities - Water (category 39)
  { name: 'מי אביבים', vendor: 'discount', account: '0123456789', category: 39, minAmount: 80, maxAmount: 200 },
  
  // Rent (category 36)
  { name: 'שכירות', vendor: 'discount', account: '0123456789', category: 36, minAmount: 6500, maxAmount: 7500 },
  
  // Arnona (category 37)
  { name: 'עיריית תל אביב', vendor: 'discount', account: '0123456789', category: 37, minAmount: 400, maxAmount: 800 },
  
  // Childcare (category 74)
  { name: 'מעון יום', vendor: 'discount', account: '0123456789', category: 74, minAmount: 2500, maxAmount: 3500 },
  { name: 'משפחתון', vendor: 'discount', account: '0123456789', category: 74, minAmount: 2000, maxAmount: 3000 },
  
  // Entertainment - Streaming (category 25)
  { name: 'נטפליקס', vendor: 'max', account: '1234', category: 25, minAmount: 35, maxAmount: 55 },
  { name: 'ספוטיפיי', vendor: 'visaCal', account: '9012', category: 25, minAmount: 20, maxAmount: 35 },
  
  // Entertainment - Sports (category 27)
  { name: 'חוגי ספורט', vendor: 'discount', account: '0123456789', category: 27, minAmount: 200, maxAmount: 500 },
  { name: 'חדר כושר', vendor: 'max', account: '1234', category: 27, minAmount: 150, maxAmount: 300 },
  
  // Insurance - Health (category 47)
  { name: 'ביטוח בריאות', vendor: 'discount', account: '0123456789', category: 47, minAmount: 150, maxAmount: 400 },
];

const INCOME_TRANSACTIONS = [
  { name: 'משכורת - חברת הייטק', vendor: 'discount', account: '0123456789', category: 90, minAmount: 25000, maxAmount: 30000 },
  { name: 'משכורת - חברת הייטק', vendor: 'discount', account: '0123456789', category: 90, minAmount: 10000, maxAmount: 14000 }, // spouse
  { name: 'ביטוח לאומי - קצבת ילדים', vendor: 'discount', account: '0123456789', category: 94, minAmount: 150, maxAmount: 200 },
];

const INVESTMENT_TRANSACTIONS = [
  { name: 'העברה לקרן השתלמות', vendor: 'discount', account: '0123456789', category: 97, minAmount: 500, maxAmount: 2000 },
  { name: 'הפרשה לפנסיה', vendor: 'discount', account: '0123456789', category: 98, minAmount: 1000, maxAmount: 3000 },
];

function randomBetween(min, max) { return Math.random() * (max - min) + min; }
function randomInt(min, max) { return Math.floor(randomBetween(min, max + 1)); }
function generateId(i) { return 'demo-' + Date.now() + '-' + i + '-' + Math.random().toString(16).slice(2, 8); }

const insertStmt = db.prepare(`
  INSERT INTO transactions (identifier, vendor, vendor_nickname, date, name, price, type, status, auto_categorized, confidence_score, account_number, category_definition_id, category_type, transaction_datetime)
  VALUES (@id, @vendor, @nickname, @date, @name, @price, @type, 'completed', 1, @confidence, @account, @categoryId, @categoryType, @datetime)
`);

const now = new Date();
const txns = [];

// Generate 5 months of data
for (let month = 0; month < 5; month++) {
  const monthDate = new Date(now);
  monthDate.setMonth(monthDate.getMonth() - month);
  
  // Income: 2 salaries + 1 child benefit per month
  INCOME_TRANSACTIONS.forEach((t, i) => {
    const txDate = new Date(monthDate);
    txDate.setDate(i < 2 ? 10 : 1); // Salary on 10th, benefit on 1st
    txDate.setHours(randomInt(8, 18), randomInt(1, 59), 0, 0); // Add random time (minutes 1-59 to avoid filtering)
    txns.push({
      ...t,
      date: txDate.toISOString(),
      amount: randomBetween(t.minAmount, t.maxAmount),
      txType: 'income'
    });
  });
  
  // Investment: 2 per month
  INVESTMENT_TRANSACTIONS.forEach((t) => {
    const txDate = new Date(monthDate);
    txDate.setDate(15);
    txDate.setHours(randomInt(9, 17), randomInt(1, 59), 0, 0); // Add random time
    txns.push({
      ...t,
      date: txDate.toISOString(),
      amount: -randomBetween(t.minAmount, t.maxAmount),
      txType: 'investment'
    });
  });
  
  // Expenses: ~80-100 per month
  const expenseCount = randomInt(80, 100);
  for (let i = 0; i < expenseCount; i++) {
    const t = EXPENSE_TRANSACTIONS[randomInt(0, EXPENSE_TRANSACTIONS.length - 1)];
    const txDate = new Date(monthDate);
    txDate.setDate(randomInt(1, 28));
    txDate.setHours(randomInt(8, 22), randomInt(1, 59), 0, 0); // Add random time (minutes 1-59 to avoid filtering)
    txns.push({
      ...t,
      date: txDate.toISOString(),
      amount: -randomBetween(t.minAmount, t.maxAmount),
      txType: 'expense'
    });
  }
}

// Insert all transactions
const insertTxn = db.transaction(() => {
  txns.forEach((t, i) => {
    insertStmt.run({
      id: generateId(i),
      vendor: t.vendor,
      nickname: t.vendor === 'discount' ? 'Discount' : t.vendor === 'max' ? 'Max' : 'Cal',
      date: t.date, // Now includes full datetime with hour/minute
      name: t.name,
      price: t.amount,
      type: t.txType === 'income' ? 'transfer' : 'card',
      confidence: randomBetween(0.7, 0.99),
      account: t.account,
      categoryId: t.category,
      categoryType: t.txType,
      datetime: t.date // Same as date since it now includes time
    });
  });
});

try {
  insertTxn();
  console.log(`✅ Inserted ${txns.length} transactions`);

  // ============================================
  // SEED USER PROFILE
  // ============================================
  db.prepare(`
    INSERT OR REPLACE INTO user_profile (id, username, marital_status, age, occupation, monthly_income, family_status, location, industry, birth_date, children_count, household_size, home_ownership, education_level, employment_status)
    VALUES (1, 'Demo User', 'married', 35, 'Software Engineer', 40000, 'married_with_children', 'Tel Aviv', 'Technology', '1991-03-15', 2, 4, 'renting', 'masters', 'employed')
  `).run();
  console.log('✅ Inserted user profile');

  // ============================================
  // SEED INVESTMENT ACCOUNTS
  // ============================================
  const INVESTMENT_ACCOUNTS = [
    { name: 'קרן השתלמות - מיטב', type: 'hishtalmut', institution: 'meitav', currency: 'ILS', is_liquid: 0, category: 'long_term' },
    { name: 'פנסיה - הראל', type: 'pension', institution: 'harel', currency: 'ILS', is_liquid: 0, category: 'long_term' },
    { name: 'קופת גמל - כלל', type: 'gemel', institution: 'clal', currency: 'ILS', is_liquid: 0, category: 'long_term' },
    { name: 'תיק השקעות - IBI', type: 'brokerage', institution: 'ibi', currency: 'ILS', is_liquid: 1, category: 'liquid' },
    { name: 'Interactive Brokers', type: 'brokerage', institution: 'interactive_brokers', currency: 'USD', is_liquid: 1, category: 'liquid' },
    { name: 'פיקדון בנקאי - דיסקונט', type: 'deposit', institution: 'discount', currency: 'ILS', is_liquid: 1, category: 'liquid' },
    { name: 'Bit2C - קריפטו', type: 'crypto', institution: 'bit2c', currency: 'ILS', is_liquid: 1, category: 'liquid' },
  ];

  const insertAccount = db.prepare(`
    INSERT INTO investment_accounts (account_name, account_type, institution, currency, is_active, is_liquid, investment_category)
    VALUES (@name, @type, @institution, @currency, 1, @isLiquid, @category)
  `);

  INVESTMENT_ACCOUNTS.forEach((acc) => {
    insertAccount.run({
      name: acc.name,
      type: acc.type,
      institution: acc.institution,
      currency: acc.currency,
      isLiquid: acc.is_liquid,
      category: acc.category,
    });
  });
  console.log(`✅ Inserted ${INVESTMENT_ACCOUNTS.length} investment accounts`);

  // ============================================
  // SEED INVESTMENT HOLDINGS (with historical data)
  // ============================================
  const accounts = db.prepare('SELECT id, account_name, account_type FROM investment_accounts').all();
  const holdingsData = [
    // Hishtalmut - growing over time
    { accountType: 'hishtalmut', baseValue: 180000, monthlyGrowth: 3500, volatility: 0.02 },
    // Pension - growing over time  
    { accountType: 'pension', baseValue: 320000, monthlyGrowth: 4500, volatility: 0.015 },
    // Gemel
    { accountType: 'gemel', baseValue: 85000, monthlyGrowth: 1500, volatility: 0.02 },
    // Brokerage ILS
    { accountType: 'brokerage', baseValue: 120000, monthlyGrowth: 0, volatility: 0.08, currency: 'ILS' },
    // Brokerage USD (IBKR)
    { accountType: 'brokerage', baseValue: 45000, monthlyGrowth: 500, volatility: 0.1, currency: 'USD' },
    // Deposit
    { accountType: 'deposit', baseValue: 50000, monthlyGrowth: 200, volatility: 0.001 },
    // Crypto
    { accountType: 'crypto', baseValue: 15000, monthlyGrowth: 0, volatility: 0.25 },
  ];

  const insertHolding = db.prepare(`
    INSERT INTO investment_holdings (account_id, asset_name, current_value, as_of_date, holding_type, status)
    VALUES (@accountId, @assetName, @value, @date, 'standard', 'active')
  `);

  // Generate 6 months of holdings history
  for (let month = 5; month >= 0; month--) {
    const holdingDate = new Date(now);
    holdingDate.setMonth(holdingDate.getMonth() - month);
    holdingDate.setDate(1);
    const dateStr = holdingDate.toISOString().split('T')[0];

    holdingsData.forEach((h, idx) => {
      const account = accounts.find(a => a.account_type === h.accountType && 
        (h.currency ? a.account_name.includes(h.currency === 'USD' ? 'Interactive' : 'IBI') : true));
      if (!account) return;

      // Calculate value with growth and volatility
      const monthsFromStart = 5 - month;
      const baseGrowth = h.monthlyGrowth * monthsFromStart;
      const volatilityFactor = 1 + (Math.random() - 0.5) * 2 * h.volatility;
      const value = (h.baseValue + baseGrowth) * volatilityFactor;

      try {
        insertHolding.run({
          accountId: account.id,
          assetName: account.account_name,
          value: Math.round(value * 100) / 100,
          date: dateStr,
        });
      } catch (e) {
        // Ignore duplicate key errors for same account/date
      }
    });
  }
  console.log('✅ Inserted investment holdings (6 months history)');

  // ============================================
  // SEED CATEGORY BUDGETS
  // ============================================
  const BUDGETS = [
    { categoryId: 3, limit: 2500, period: 'monthly' },   // Supermarket
    { categoryId: 4, limit: 1200, period: 'monthly' },   // Restaurants
    { categoryId: 5, limit: 400, period: 'monthly' },    // Coffee
    { categoryId: 11, limit: 800, period: 'monthly' },   // Fuel
    { categoryId: 57, limit: 1000, period: 'monthly' },  // Fashion
    { categoryId: 60, limit: 500, period: 'monthly' },   // Electronics
    { categoryId: 25, limit: 150, period: 'monthly' },   // Streaming
  ];

  const insertBudget = db.prepare(`
    INSERT OR IGNORE INTO category_budgets (category_definition_id, period_type, budget_limit, is_active)
    VALUES (@categoryId, @period, @limit, 1)
  `);

  BUDGETS.forEach((b) => {
    insertBudget.run({
      categoryId: b.categoryId,
      period: b.period,
      limit: b.limit,
    });
  });
  console.log(`✅ Inserted ${BUDGETS.length} category budgets`);

  // ============================================
  // SUMMARY
  // ============================================
  const summary = db.prepare('SELECT vendor, category_type, COUNT(*) as cnt FROM transactions GROUP BY vendor, category_type ORDER BY vendor').all();
  console.log('\n📊 Transactions by vendor:');
  console.table(summary);

  const dateRange = db.prepare('SELECT MIN(date) as min_date, MAX(date) as max_date FROM transactions').get();
  console.log(`\n📅 Date range: ${dateRange.min_date} to ${dateRange.max_date}`);

  const totals = db.prepare("SELECT category_type, SUM(ABS(price)) as total FROM transactions GROUP BY category_type").all();
  console.log('\n💰 Totals:');
  console.table(totals);

  const investmentSummary = db.prepare('SELECT account_type, COUNT(*) as accounts, SUM(h.current_value) as total_value FROM investment_accounts a LEFT JOIN investment_holdings h ON a.id = h.account_id GROUP BY account_type').all();
  console.log('\n📈 Investment accounts:');
  console.table(investmentSummary);
} finally {
  db.close();
}
