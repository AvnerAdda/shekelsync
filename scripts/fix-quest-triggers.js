#!/usr/bin/env node
/**
 * Fix orphaned triggers referencing smart_action_items_old
 *
 * This script fixes an issue where the migration that renamed smart_action_items
 * to smart_action_items_old left behind triggers that reference the old table name.
 */

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_NODE_MODULES = path.join(PROJECT_ROOT, 'app', 'node_modules');

async function fixQuestTriggers() {
  // Determine database path based on environment
  const defaultDbPath = process.env.SQLITE_DB_PATH || path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite');

  const dbPath = process.argv[2] || defaultDbPath;

  console.log('Fixing quest triggers...');
  console.log('Database path:', dbPath);

  let Database;
  try {
    Database = require(path.join(APP_NODE_MODULES, 'better-sqlite3'));
  } catch (e) {
    console.error('Error: better-sqlite3 not found. Run npm install in the app directory.');
    process.exit(1);
  }

  const db = new Database(dbPath);

  try {
    // Get all triggers that reference smart_action_items_old
    const triggers = db.prepare(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'trigger'
      AND (sql LIKE '%smart_action_items_old%' OR tbl_name = 'smart_action_items_old')
    `).all();

    console.log(`Found ${triggers.length} trigger(s) referencing smart_action_items_old`);

    // Drop orphaned triggers
    for (const trigger of triggers) {
      console.log(`Dropping trigger: ${trigger.name}`);
      db.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
    }

    // Check if smart_action_items table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'smart_action_items'
    `).get();

    if (!tableExists) {
      console.error('Error: smart_action_items table does not exist!');
      process.exit(1);
    }

    // Check if triggers already exist on smart_action_items
    const existingTriggers = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND tbl_name = 'smart_action_items'
    `).all();

    console.log(`Found ${existingTriggers.length} existing trigger(s) on smart_action_items`);

    // Drop existing triggers on smart_action_items to ensure clean state
    for (const trigger of existingTriggers) {
      console.log(`Dropping existing trigger: ${trigger.name}`);
      db.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
    }

    // Recreate proper triggers
    console.log('Creating update_smart_action_items_timestamp trigger...');
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_smart_action_items_timestamp
      AFTER UPDATE ON smart_action_items
      BEGIN
        UPDATE smart_action_items
        SET updated_at = datetime('now')
        WHERE id = NEW.id;
      END
    `);

    console.log('Creating log_smart_action_item_status_change trigger...');
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS log_smart_action_item_status_change
      AFTER UPDATE OF user_status ON smart_action_items
      WHEN OLD.user_status != NEW.user_status
      BEGIN
        INSERT INTO action_item_history (smart_action_item_id, action, previous_status, new_status)
        VALUES (
          NEW.id,
          CASE NEW.user_status
            WHEN 'dismissed' THEN 'dismissed'
            WHEN 'resolved' THEN 'resolved'
            WHEN 'accepted' THEN 'accepted'
            WHEN 'completed' THEN 'completed'
            WHEN 'failed' THEN 'failed'
            WHEN 'active' THEN 'reactivated'
            ELSE 'updated'
          END,
          OLD.user_status,
          NEW.user_status
        );
      END
    `);

    // Verify triggers were created
    const finalTriggers = db.prepare(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'trigger' AND tbl_name = 'smart_action_items'
    `).all();

    console.log(`\nFinal triggers on smart_action_items (${finalTriggers.length}):`);
    for (const trigger of finalTriggers) {
      console.log(`  - ${trigger.name}`);
    }

    // Also check if there's any remaining reference to the old table
    const remaining = db.prepare(`
      SELECT name, type, sql FROM sqlite_master
      WHERE sql LIKE '%smart_action_items_old%'
    `).all();

    if (remaining.length > 0) {
      console.warn('\nWarning: Still found references to smart_action_items_old:');
      for (const item of remaining) {
        console.warn(`  - ${item.type}: ${item.name}`);
      }
    } else {
      console.log('\nNo remaining references to smart_action_items_old found.');
    }

    console.log('\nDone! Quest triggers have been fixed.');

  } catch (error) {
    console.error('Error fixing triggers:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

fixQuestTriggers();
