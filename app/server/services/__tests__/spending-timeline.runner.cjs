const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const express = require('express');
const request = require('supertest');
const { initializeSqliteDatabase } = require('../../../../scripts/init_sqlite_db.js');
const { dateKey, shiftDays } = require('../planning-math.js');

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spending-timeline-'));
  const dbPath = path.join(tempDir, 'test.sqlite');
  process.env.SQLITE_DB_PATH = dbPath;
  let db;
  try {
    initializeSqliteDatabase({ output: dbPath, databaseCtor: Database });
    db = new Database(dbPath);
    const adapter = { query: async (sql, values = []) => {
      const ordered = [];
      const statement = db.prepare(sql.replace(/\$(\d+)/g, (_, index) => { ordered.push(values[Number(index) - 1]); return '?'; }));
      return { rows: statement.reader ? statement.all(...ordered) : (statement.run(...ordered), []) };
    }, release() {} };
    const service = require('../analytics/spending-categories.js');
    service.__setDatabase({ getClient: async () => adapter });
    const category = (name, type, allocation, counted = 1) => {
      const id = Number(db.prepare('INSERT INTO category_definitions (name, name_en, category_type, is_counted_as_income) VALUES (?, ?, ?, ?)').run(name, name, type, counted).lastInsertRowid);
      if (allocation) db.prepare('INSERT INTO spending_category_mappings (category_definition_id, spending_category) VALUES (?, ?)').run(id, allocation);
      return id;
    };
    const income = category('Timeline salary', 'income');
    const food = category('Timeline food', 'expense', 'essential', 0);
    const learning = category('Timeline learning', 'expense', 'growth');
    const gift = category('Timeline capital', 'income', null, 0);
    const repayment = db.prepare("SELECT id FROM category_definitions WHERE name_en = 'Credit Card Repayment' LIMIT 1").get()?.id || category('Credit Card Repayment', 'expense', 'stability');
    const investment = category('Timeline investment', 'investment');
    const end = dateKey();
    // Stored like scraped rows: the UTC instant of a local time (noon unless given).
    const insert = (id, local, amount, cat, status = 'completed', type = null) => db.prepare(`INSERT INTO transactions
      (identifier, vendor, date, name, price, type, category_definition_id, category_type, status)
      VALUES (?, 'test', ?, ?, ?, 'normal', ?, ?, ?)`).run(id, new Date(local.length === 10 ? `${local}T12:00:00` : local).toISOString(),
      id, amount, cat, type, status);
    // Local midnight falls on the previous UTC day, so these rows pin local-day windows.
    insert('salary', `${shiftDays(end, -29)}T00:05:00`, 1000, income);
    insert('outside', `${shiftDays(end, -30)}T23:55:00`, -999, food);
    insert('food', `${shiftDays(end, -29)}T00:10:00`, -500, food);
    insert('next-local-day', `${shiftDays(end, 1)}T00:30:00`, -999, food);
    insert('refund', end + 'T23:50:00', 50, food);
    insert('learning', end, -100, learning);
    insert('unassigned', end, -50, null, 'completed', 'expense');
    insert('pending', end, -999, food, 'pending');
    insert('repayment', end, -999, repayment);
    insert('investment', end, -200, investment);
    insert('investment-without-category', end, -50, null, 'completed', 'investment');
    insert('investment-withdrawal', end, 999, investment);
    insert('investment-pending', end, -999, investment, 'pending');
    insert('investment-outside', shiftDays(end, -30), -999, investment);
    insert('capital', end, 999, gift);
    insert('paired-bank-charge', end, -999, food);
    const pairing = db.prepare("INSERT INTO account_pairings (credit_card_vendor, bank_vendor, is_active) VALUES ('card-test', 'bank-test', 0)").run().lastInsertRowid;
    db.prepare("INSERT INTO transaction_pairing_exclusions (transaction_identifier, transaction_vendor, pairing_id) VALUES ('paired-bank-charge', 'test', ?)").run(pairing);
    const app = express(); app.use(express.json());
    app.use('/api/spending-categories', require('../../routes/spending-categories.js')());
    let response = await request(app).get('/api/spending-categories/timeline?rollingDays=30&historyDays=2');
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    const point = response.body.points.at(-1);
    assert.equal(point.income, 1000);
    assert.equal(point.expenses, 850);
    assert.equal(point.surplus, 150);
    assert.equal(point.expense_amounts.growth, 350);
    assert.equal(point.transaction_counts.growth, 3);
    assert.equal(point.allocation_amounts.growth, 500);
    assert.ok(response.body.categories_by_allocation.growth.some((entry) => entry.category_definition_id === investment));
    assert.equal(point.percentages.essential, 45);
    assert.equal(point.percentages.unallocated, 5);
    assert.equal(Object.values(point.percentages).reduce((sum, value) => sum + value, 0), 100);
    response = await request(app).get(`/api/spending-categories/timeline/transactions?spendingCategory=essential&startDate=${shiftDays(end, -29)}&endDate=${end}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.total_amount, 450);
    assert.deepEqual(response.body.transactions.map((row) => row.identifier).sort(), ['food', 'refund']);
    response = await request(app).get(`/api/spending-categories/timeline/transactions?spendingCategory=growth&startDate=${shiftDays(end, -29)}&endDate=${end}`);
    assert.equal(response.body.total_amount, 350, 'investments count as spending; surplus is not a fabricated transaction');
    assert.equal(response.body.total_count, 3);
    assert.deepEqual(response.body.transactions.map((row) => row.identifier).sort(), ['investment', 'investment-without-category', 'learning']);
    assert.equal(response.body.transactions.find((row) => row.identifier === 'investment').category_type, 'investment');
    assert.equal((await request(app).put('/api/spending-categories/targets').send({ essential: 40, growth: 30, stability: 15, reward: 15 })).status, 200);
    assert.equal((await request(app).get('/api/spending-categories/timeline')).body.targets.essential, 40);
    assert.equal((await request(app).put(`/api/spending-categories/mapping/${food}`).send({ spendingCategory: 'reward' })).status, 200);
    response = await request(app).get('/api/spending-categories/timeline');
    assert.equal(response.body.points.at(-1).percentages.reward, 45);
    insert('small-charge-a', end, -0.1, food);
    insert('small-charge-b', end, -0.2, food);
    const withCents = (await request(app).get('/api/spending-categories/timeline')).body.points.at(-1);
    assert.equal(withCents.expenses, 850.3);
    assert.equal(withCents.allocation_amounts.growth, 499.7);
    response = await request(app).get(`/api/spending-categories/timeline/transactions?spendingCategory=reward&startDate=${shiftDays(end, -29)}&endDate=${end}`);
    assert.equal(response.body.total_amount, 450.3);
    assert.equal(response.body.total_amount, withCents.expense_amounts.reward);
    // Investment categories remain assignable, with matching totals and drilldowns.
    assert.equal((await request(app).put(`/api/spending-categories/mapping/${investment}`).send({ spendingCategory: 'stability' })).status, 200);
    response = await request(app).get('/api/spending-categories/timeline');
    assert.equal(response.body.points.at(-1).expense_amounts.stability, 200);
    assert.equal(response.body.points.at(-1).expense_amounts.growth, 150);
    assert.ok(response.body.categories_by_allocation.stability.some((entry) => entry.category_definition_id === investment));
    response = await request(app).get(`/api/spending-categories/timeline/transactions?spendingCategory=stability&startDate=${shiftDays(end, -29)}&endDate=${end}`);
    assert.equal(response.body.total_amount, 200);
    assert.deepEqual(response.body.transactions.map((row) => row.identifier), ['investment']);
    // Investing beyond the remaining income produces a deficit instead of a second surplus allocation.
    insert('large-investment', end, -2000, investment);
    const deficit = (await request(app).get('/api/spending-categories/timeline')).body.points.at(-1);
    assert.equal(deficit.expenses, 2850.3);
    assert.equal(deficit.surplus, 0);
    assert.equal(deficit.deficit, 1850.3);
    assert.equal((await request(app).get('/api/spending-categories/timeline?rollingDays=0')).status, 400);
    assert.equal((await request(app).get('/api/spending-categories/timeline?endDate=invalid')).status, 400);
    service.__resetDatabase();
    console.log('spending-timeline:ok');
  } finally {
    if (db) db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
