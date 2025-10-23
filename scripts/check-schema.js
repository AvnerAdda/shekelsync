#!/usr/bin/env node
const path = require('path');
const Database = require('../app/node_modules/better-sqlite3/lib');

const DB_PATH = path.join(__dirname, 'dist', 'clarify.sqlite');

try {
  const db = new Database(DB_PATH, { readonly: true });

  // Get vendor_credentials schema
  console.log('=== vendor_credentials table schema ===');
  const schema = db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type='table' AND name='vendor_credentials'
  `).get();
  console.log(schema.sql);
  console.log();

  // Get actual columns
  console.log('=== Actual columns in vendor_credentials ===');
  const columns = db.pragma('table_info(vendor_credentials)');
  columns.forEach(col => {
    console.log(`  ${col.name} (${col.type}) - ${col.notnull ? 'NOT NULL' : 'NULL'} ${col.pk ? '(PK)' : ''}`);
  });
  console.log();

  // Sample data (without showing encrypted values)
  console.log('=== Sample data (first 3 rows) ===');
  const cols = columns.map(c => c.name).filter(n => !n.includes('encrypted')).join(', ');
  const samples = db.prepare(`SELECT ${cols} FROM vendor_credentials LIMIT 3`).all();
  console.log(JSON.stringify(samples, null, 2));

  db.close();
} catch (error) {
  console.error('Error:', error.message);
}
