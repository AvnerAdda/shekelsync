const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const createSqlitePool = require('../../../../lib/sqlite-pool.js');
const { initializeSqliteDatabase } = require('../../../../../scripts/init_sqlite_db.js');
const scraping = require('../run.js');

async function main() {
  const scenario = process.argv[2];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-scrape-save-'));
  const databasePath = path.join(tempDir, 'scrape.sqlite');
  const originalLog = console.log;
  const originalExistsSync = fs.existsSync;
  let pool;
  let otherConnection;
  try {
    console.log = () => {};
    initializeSqliteDatabase({ output: databasePath, force: true, withDemo: false });
    console.log = originalLog;
    pool = createSqlitePool({ databasePath });
    // Finish deferred startup maintenance before introducing a second writer.
    await new Promise((resolve) => setImmediate(resolve));
    otherConnection = new Database(databasePath);
    otherConnection.pragma('busy_timeout = 0');
    scraping.__setDatabaseForTests({ query: pool.query, getClient: pool.connect });
    // The injected executor never opens a browser; make discovery independent
    // of whether Chrome is installed on the test machine.
    fs.existsSync = (file) => /chrome|chromium/i.test(String(file)) || originalExistsSync(file);

    await pool.query(`INSERT INTO vendor_credentials (id, vendor, nickname, current_balance)
                      VALUES (1, 'max', 'Before sync', 50)`);

    const transaction = {
      identifier: 'scrape-save-test',
      date: '2026-01-15T12:00:00.000Z',
      processedDate: '2026-01-15T12:00:00.000Z',
      description: 'Regression purchase',
      chargedAmount: -10,
      originalAmount: -10,
      originalCurrency: 'ILS',
      chargedCurrency: 'ILS',
      type: 'normal',
      status: 'completed',
    };
    const saveError = new Error('injected transaction insert failure');
    if (scenario === 'rollback') {
      // Fail after the balance update to verify the entire save is atomic.
      scraping.__setDatabaseForTests({
        query: pool.query,
        getClient: async () => ({
          query: (sql, params) => {
            if (/INSERT INTO transactions\s*\(/i.test(sql)) throw saveError;
            return pool.query(sql, params);
          },
          release() {},
        }),
      });
    }

    const run = () => scraping.runScrape({
      options: { companyId: 'max', startDate: '2026-01-01' },
      credentials: { dbId: 1, username: 'test', password: 'test' },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      execute: async () => {
        // A UI read on the shared connection establishes a stale snapshot if
        // the scrape opened a deferred transaction before its network wait.
        await pool.query('SELECT nickname FROM vendor_credentials WHERE id = 1');
        otherConnection.prepare('UPDATE vendor_credentials SET nickname = ? WHERE id = 1')
          .run('Changed during scrape');
        return { success: true, accounts: [{ accountNumber: '1234', balance: 100, txns: [transaction] }] };
      },
    });

    if (scenario === 'rollback') {
      await assert.rejects(run(), (error) => error === saveError);
      const { rows } = await pool.query('SELECT current_balance, last_scrape_status FROM vendor_credentials WHERE id = 1');
      assert.equal(rows[0].current_balance, 50);
      assert.equal(rows[0].last_scrape_status, 'failed');
      assert.equal((await pool.query('SELECT * FROM transactions')).rowCount, 0);
    } else {
      assert.equal(scenario, 'concurrent-write');
      // Repeat as bulk sync does, including duplicate transaction reconciliation.
      for (let i = 0; i < 4; i += 1) {
        assert.equal((await run()).success, true);
      }
      const { rows } = await pool.query('SELECT current_balance, nickname, last_scrape_status FROM vendor_credentials WHERE id = 1');
      assert.equal(rows[0].current_balance, 100);
      assert.equal(rows[0].nickname, 'Changed during scrape');
      assert.equal(rows[0].last_scrape_status, 'success');
      assert.equal((await pool.query('SELECT * FROM transactions')).rowCount, 1);
      const events = await pool.query('SELECT status FROM scrape_events');
      assert.equal(events.rowCount, 4);
      assert.ok(events.rows.every((event) => event.status === 'success'));
    }
    // A fresh writer can proceed after either commit or rollback.
    otherConnection.exec("UPDATE vendor_credentials SET nickname = 'After sync' WHERE id = 1");
    console.log(`scrape-save:${scenario}:ok`);
  } finally {
    console.log = originalLog;
    fs.existsSync = originalExistsSync;
    scraping.__resetDatabaseForTests();
    otherConnection?.close();
    pool?.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
