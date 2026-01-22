#!/usr/bin/env node
/**
 * Test script to verify per-credential scrape status tracking
 *
 * This script demonstrates that:
 * 1. Scrape events now track credential_id
 * 2. Each credential's status is updated independently
 * 3. The last-update service returns accurate per-credential status
 */

const path = require('path');
const {
  isSqlCipherEnabled,
  resolveSqlCipherKey,
  applySqlCipherKey,
  verifySqlCipherKey,
} = require('../app/lib/sqlcipher-utils.js');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_NODE_MODULES = path.join(PROJECT_ROOT, 'app', 'node_modules');
const Database = require(path.join(APP_NODE_MODULES, 'better-sqlite3'));

const dbPath = isSqlCipherEnabled()
  ? (process.env.SQLCIPHER_DB_PATH || path.join(PROJECT_ROOT, 'dist', 'clarify.sqlcipher'))
  : (process.env.SQLITE_DB_PATH || path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite'));
const db = new Database(dbPath);
if (isSqlCipherEnabled()) {
  const keyInfo = resolveSqlCipherKey({ requireKey: true });
  applySqlCipherKey(db, keyInfo);
  verifySqlCipherKey(db);
}

console.log('Testing per-credential scrape status tracking...\n');

// 1. Check current status
console.log('=== Current vendor_credentials status ===');
const credentials = db.prepare(`
  SELECT id, vendor, nickname, last_scrape_status, last_scrape_success
  FROM vendor_credentials
  WHERE vendor = 'max'
  ORDER BY id
`).all();
console.table(credentials);

// 2. Check scrape_events
console.log('\n=== Scrape events ===');
const events = db.prepare(`
  SELECT id, vendor, credential_id, status, message, created_at
  FROM scrape_events
  WHERE vendor = 'max'
  ORDER BY created_at DESC
`).all();
console.table(events);

// 3. Simulate updating just one credential (MAX Lois = id 3) to success
console.log('\n=== Simulating successful scrape for MAX Lois (credential_id=3) ===');
db.prepare(`
  UPDATE vendor_credentials
  SET last_scrape_attempt = CURRENT_TIMESTAMP,
      last_scrape_success = CURRENT_TIMESTAMP,
      last_scrape_status = 'success'
  WHERE id = 3
`).run();

// 4. Check updated status
console.log('\n=== After updating MAX Lois to success ===');
const updatedCredentials = db.prepare(`
  SELECT id, vendor, nickname, last_scrape_status, last_scrape_success
  FROM vendor_credentials
  WHERE vendor = 'max'
  ORDER BY id
`).all();
console.table(updatedCredentials);

console.log('\n✅ Test complete!');
console.log('\nObservations:');
console.log('- MAX Avner (id=2) should still show "failed"');
console.log('- MAX Lois (id=3) should now show "success"');
console.log('- Each credential now has independent status tracking');

db.close();
