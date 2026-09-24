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
    const insert = (id, day, amount, cat, status = 'completed', type = null) => db.prepare(`INSERT INTO transactions
      (identifier, vendor, date, name, price, type, category_definition_id, category_type, status)
      VALUES (?, 'test', ?, ?, ?, 'normal', ?, ?, ?)`).run(id, day, id, amount, cat, type, status);
    insert('salary', shiftDays(end, -29), 1000, income);
    insert('outside', shiftDays(end, -30), -999, food);
    insert('food', shiftDays(end, -10), -500, food);
    insert('refund', end + 'T23:50:00', 50, food);
    insert('learning', end, -100, learning);
    insert('unassigned', end, -50, null, 'completed', 'expense');
    insert('pending', end, -999, food, 'pending');
    insert('repayment', end, -999, repayment);
    insert('investment', end, -999, investment);
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
    assert.equal(point.expenses, 600);
    assert.equal(point.surplus, 400);
    assert.equal(point.allocation_amounts.growth, 500);
    assert.equal(point.percentages.essential, 45);
    assert.equal(point.percentages.unallocated, 5);
    assert.equal(Object.values(point.percentages).reduce((sum, value) => sum + value, 0), 100);
    response = await request(app).get(`/api/spending-categories/timeline/transactions?spendingCategory=essential&startDate=${shiftDays(end, -29)}&endDate=${end}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.total_amount, 450);
    assert.deepEqual(response.body.transactions.map((row) => row.identifier).sort(), ['food', 'refund']);
    response = await request(app).get(`/api/spending-categories/timeline/transactions?spendingCategory=growth&startDate=${shiftDays(end, -29)}&endDate=${end}`);
    assert.equal(response.body.total_amount, 100, 'surplus is not a fabricated transaction');
    assert.equal(response.body.total_count, 1);
    assert.equal((await request(app).put('/api/spending-categories/targets').send({ essential: 40, growth: 30, stability: 15, reward: 15 })).status, 200);
    assert.equal((await request(app).get('/api/spending-categories/timeline')).body.targets.essential, 40);
    assert.equal((await request(app).put(`/api/spending-categories/mapping/${food}`).send({ spendingCategory: 'reward' })).status, 200);
    response = await request(app).get('/api/spending-categories/timeline');
    assert.equal(response.body.points.at(-1).percentages.reward, 45);
    insert('small-charge-a', end, -0.1, food);
    insert('small-charge-b', end, -0.2, food);
    const withCents = (await request(app).get('/api/spending-categories/timeline')).body.points.at(-1);
    assert.equal(withCents.expenses, 600.3);
    assert.equal(withCents.allocation_amounts.growth, 499.7);
    response = await request(app).get(`/api/spending-categories/timeline/transactions?spendingCategory=reward&startDate=${shiftDays(end, -29)}&endDate=${end}`);
    assert.equal(response.body.total_amount, 450.3);
    assert.equal(response.body.total_amount, withCents.expense_amounts.reward);
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
