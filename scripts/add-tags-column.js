#!/usr/bin/env node
/**
 * Add tags column to category_definitions table
 */
const path = require('path');
const Database = require(path.join(__dirname, '..', 'app', 'node_modules', 'better-sqlite3'));
const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'dist', 'clarify.sqlite');
const db = new Database(dbPath);

// Check if column exists
const columns = db.prepare('PRAGMA table_info(category_definitions)').all();
const hasTagsColumn = columns.some(col => col.name === 'tags');

if (!hasTagsColumn) {
  db.exec('ALTER TABLE category_definitions ADD COLUMN tags TEXT');
  console.log('✅ Added tags column to category_definitions table');
} else {
  console.log('ℹ️  tags column already exists in category_definitions table');
}

db.close();
console.log('Done!');
