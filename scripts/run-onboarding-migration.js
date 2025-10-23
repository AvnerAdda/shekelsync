#!/usr/bin/env node
const path = require('path');
const Database = require(path.join(__dirname, '..', 'app', 'node_modules', 'better-sqlite3'));

const dbPath = path.join(__dirname, '..', 'dist', 'clarify.sqlite');

console.log('🔄 Running onboarding fields migration...');
console.log('📁 Database:', dbPath);
console.log('');

try {
  const db = new Database(dbPath);

  // Check if columns already exist
  const tableInfo = db.pragma('table_info(user_profile)');
  const existingColumns = tableInfo.map(col => col.name);

  const columnsToAdd = [
    { name: 'onboarding_dismissed', sql: 'ALTER TABLE user_profile ADD COLUMN onboarding_dismissed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_dismissed IN (0,1))' },
    { name: 'onboarding_dismissed_at', sql: 'ALTER TABLE user_profile ADD COLUMN onboarding_dismissed_at TEXT' },
    { name: 'last_active_at', sql: 'ALTER TABLE user_profile ADD COLUMN last_active_at TEXT' }
  ];

  let added = 0;
  let skipped = 0;

  columnsToAdd.forEach(col => {
    if (existingColumns.includes(col.name)) {
      console.log(`⏭️  Column '${col.name}' already exists - skipped`);
      skipped++;
    } else {
      try {
        db.exec(col.sql);
        console.log(`✅ Added column '${col.name}'`);
        added++;
      } catch (error) {
        console.error(`❌ Failed to add column '${col.name}':`, error.message);
      }
    }
  });

  // Update existing profiles with last_active_at if needed
  if (added > 0) {
    const updateResult = db.prepare(`
      UPDATE user_profile
      SET last_active_at = datetime('now')
      WHERE last_active_at IS NULL
    `).run();

    console.log(`📝 Updated ${updateResult.changes} existing profile(s) with last_active_at`);
  }

  console.log('');
  console.log('✅ Migration complete!');
  console.log(`   Added: ${added} columns`);
  console.log(`   Skipped: ${skipped} columns`);

  db.close();
  process.exit(0);

} catch (error) {
  console.error('');
  console.error('❌ Migration failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
