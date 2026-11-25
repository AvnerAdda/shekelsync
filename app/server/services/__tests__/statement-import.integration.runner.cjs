// Runs statement import against a real SQLite database (Electron ABI), so the
// SQL in the service and the scraper's insertTransaction are exercised for real.
// All figures are synthetic.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const createSqlitePool = require('../../../lib/sqlite-pool.js');
const { initializeSqliteDatabase } = require('../../../../scripts/init_sqlite_db.js');
const scraping = require('../scraping/run.js');
const statementImport = require('../statement-import.js');

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-statement-import-'));
  const databasePath = path.join(tempDir, 'import.sqlite');
  const originalLog = console.log;
  let pool;
  try {
    console.log = () => {};
    initializeSqliteDatabase({ output: databasePath, force: true, withDemo: false });
    console.log = originalLog;
    pool = createSqlitePool({ databasePath });
    await new Promise((resolve) => setImmediate(resolve));

    const database = { query: pool.query, getClient: pool.connect };
    scraping.__setDatabaseForTests(database);
    statementImport.__setDependencies({ database, now: () => Date.parse('2026-03-31T12:00:00.000Z') });

    await pool.query(`INSERT INTO vendor_credentials (id, vendor, nickname, card6_digits)
                      VALUES (5, 'max', 'Test card', '4321')`);
    // Already synced by the scraper: Israel-midnight dates, processed on the billing day.
    await pool.query(
      `INSERT INTO transactions (identifier, vendor, vendor_nickname, account_number, date, name, price, type,
                                 processed_date, status, category_type)
       VALUES ('scraped-1', 'max', 'Test card', '4321', '2026-03-04T22:00:00.000Z', 'SUPER TEST TLV', -120.5,
               'normal', '2026-04-09T21:00:00.000Z', 'completed', 'expense'),
              ('scraped-2', 'max', 'Test card', '4321', '2026-03-09T22:00:00.000Z', 'CAFE EXAMPLE', -18,
               'normal', '2026-04-09T21:00:00.000Z', 'completed', 'expense')`,
    );

    const rows = [
      // Same charge as scraped-1, statement shows the next day and a longer name.
      { date: '2026-03-06', processedDate: '2026-04-10', description: 'סופר טסט תל אביב SUPER TEST TLV', amount: -120.5 },
      // Two identical coffees; the scraper has one of them.
      { date: '2026-03-10', processedDate: '2026-04-10', description: 'CAFE EXAMPLE', amount: -18 },
      { date: '2026-03-10', processedDate: '2026-04-10', description: 'CAFE EXAMPLE', amount: -18 },
      // New: a foreign purchase and an installment.
      {
        date: '2026-03-20', processedDate: '2026-04-10', description: 'ONLINE SHOP', amount: -95.3,
        originalAmount: -25, originalCurrency: '$',
      },
      { date: '2026-03-25', processedDate: '2026-04-10', description: 'ELECTRONICS', amount: -250, memo: 'תשלום 2 מתוך 6' },
      // Invalid.
      { date: '31/03/2026', description: 'BAD DATE', amount: -1 },
    ];

    const preview = await statementImport.previewStatementImport({ credentialId: 5, rows });
    assert.deepEqual(preview.target.accountNumberOptions, ['4321']);
    assert.equal(preview.target.accountNumber, '4321');
    assert.deepEqual(preview.rows.map((row) => row.status), ['duplicate', 'duplicate', 'new', 'new', 'new', 'invalid']);
    assert.deepEqual(preview.summary, {
      total: 6, new: 3, duplicates: 2, invalid: 1, firstDate: '2026-03-06', lastDate: '2026-03-25',
    });
    assert.equal(preview.rows[0].match.name, 'SUPER TEST TLV');
    assert.equal(preview.rows[0].match.date, '2026-03-05');

    const committed = await statementImport.commitStatementImport({ credentialId: 5, rows });
    assert.equal(committed.requested, 3);
    assert.equal(committed.inserted, 3);
    assert.equal(committed.skippedDuplicates, 2);

    const { rows: stored } = await pool.query(
      `SELECT name, price, date, processed_date, account_number, vendor_nickname, type, memo,
              original_amount, original_currency, charged_currency, status
         FROM transactions
        WHERE vendor = 'max' AND identifier LIKE '%'
        ORDER BY date, name`,
    );
    assert.equal(stored.length, 5);
    const coffee = stored.filter((row) => row.name === 'CAFE EXAMPLE');
    assert.equal(coffee.length, 2, 'one scraped coffee + the second identical coffee from the file');
    const online = stored.find((row) => row.name === 'ONLINE SHOP');
    assert.equal(online.date, '2026-03-19T22:00:00.000Z');
    assert.equal(online.processed_date, '2026-04-09T21:00:00.000Z', 'billing day after DST switch is UTC+3');
    assert.equal(online.price, -95.3);
    assert.equal(online.original_amount, -25);
    assert.equal(online.original_currency, 'USD');
    assert.equal(online.charged_currency, 'ILS');
    assert.equal(online.account_number, '4321');
    assert.equal(online.vendor_nickname, 'Test card');
    assert.equal(online.status, 'completed');
    const electronics = stored.find((row) => row.name === 'ELECTRONICS');
    assert.equal(electronics.type, 'installments');
    assert.equal(electronics.memo, 'תשלום 2 מתוך 6');

    // Importing the same file again adds nothing.
    const again = await statementImport.commitStatementImport({ credentialId: 5, rows });
    assert.equal(again.requested, 0);
    assert.equal(again.inserted, 0);
    assert.equal(again.skippedDuplicates, 5);

    // The credential's card list is untouched (processScrapeResult would overwrite it).
    const { rows: credentialRows } = await pool.query('SELECT card6_digits FROM vendor_credentials WHERE id = 5');
    assert.equal(credentialRows[0].card6_digits, '4321');

    // An explicitly ticked duplicate is imported.
    const forcedRows = [{ date: '2026-03-06', description: 'SUPER TEST TLV', amount: -120.5 }];
    const forced = await statementImport.commitStatementImport({
      credentialId: 5, rows: forcedRows, includeDuplicateIndexes: [0],
    });
    assert.equal(forced.requested, 1);
    assert.equal(forced.inserted, 1);

    await assert.rejects(
      statementImport.previewStatementImport({ credentialId: 5, accountNumber: '9999', rows }),
      (error) => error.code === 'unknown_account_number',
    );

    console.log('statement-import:ok');
  } finally {
    console.log = originalLog;
    statementImport.__resetDependencies();
    if (pool) await pool.close?.();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
