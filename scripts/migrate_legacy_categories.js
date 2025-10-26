#!/usr/bin/env node
/**
 * Migration script to repurpose category_mapping table for legacy categories
 * and auto-assign category_definition_id to existing transactions
 *
 * Usage:
 *   node scripts/migrate_legacy_categories.js [--db-path dist/clarify.sqlite]
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_NODE_MODULES = path.join(PROJECT_ROOT, 'app', 'node_modules');
const Database = require(path.join(APP_NODE_MODULES, 'better-sqlite3'));

const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite');

// Only confident mappings - user will handle uncertain ones via categorization rules
const LEGACY_MAPPINGS = [
  { oldCategory: 'מזון וצריכה', newCategory: 'סופרמרקט' },  // Groceries
  { oldCategory: 'מזון ומשקאות', newCategory: 'סופרמרקט' },  // Groceries
  { oldCategory: 'מסעדות, קפה וברים', newCategory: 'מסעדות' },  // Restaurants
  { oldCategory: 'תחבורה ורכבים', newCategory: 'תחבורה' },  // Transportation (parent)
  { oldCategory: 'שירותי תקשורת', newCategory: 'תקשורת' },  // Mobile & Communications
  { oldCategory: 'דלק, חשמל וגז', newCategory: 'חשמל' },  // Electricity
  { oldCategory: 'חשמל ומחשבים', newCategory: 'אלקטרוניקה' },  // Electronics
  { oldCategory: 'רפואה ובתי מרקחת', newCategory: 'בית מרקחת' },  // Pharmacy
  { oldCategory: 'אופנה', newCategory: 'ביגוד' },  // Clothing
  { oldCategory: 'עיצוב הבית', newCategory: 'רהיטים' },  // Furniture
  { oldCategory: 'פנאי, בידור וספורט', newCategory: 'פנאי' },  // Leisure (parent)
  { oldCategory: 'טיסות ותיירות', newCategory: 'חופשות' },  // Travel & Holidays
  { oldCategory: 'העברת כספים', newCategory: 'תשלומי בנק' },  // Bank Settlements
  { oldCategory: 'שונות', newCategory: 'שונות' }  // Miscellaneous
  // Note: The following are not mapped - user should handle via categorization rules:
  // - 'קוסמטיקה וטיפוח' (Beauty - could be Health or Shopping)
  // - 'ספרים ודפוס' (Books - could be Education or Shopping)
  // - 'עירייה וממשלה' (Government - could be Bills or Bank)
  // - 'ביטוח' (Insurance - no category exists)
  // - 'חיות מחמד' (Pets - no category exists)
  // - 'ציוד ומשרד' (Office - no category exists)
];

function parseArgs() {
  const args = process.argv.slice(2);
  let dbPath = DEFAULT_DB_PATH;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db-path' && i + 1 < args.length) {
      dbPath = path.resolve(PROJECT_ROOT, args[i + 1]);
      i++;
    }
  }

  return { dbPath };
}

function main() {
  const { dbPath } = parseArgs();

  if (!fs.existsSync(dbPath)) {
    console.error(`\n❌ Database not found at: ${dbPath}`);
    process.exit(1);
  }

  console.log(`\n🔄 Migrating category_mapping table in: ${dbPath}\n`);
  const db = new Database(dbPath);

  try {
    db.pragma('foreign_keys = ON');
    db.exec('BEGIN');

    // Step 1: Rename column (SQLite doesn't support ALTER COLUMN, so we recreate)
    console.log('📝 Step 1: Recreating category_mapping table...');

    db.exec(`
      CREATE TABLE category_mapping_new (
        old_category_name TEXT PRIMARY KEY,
        category_definition_id INTEGER NOT NULL,
        notes TEXT,
        FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE CASCADE
      )
    `);

    // Step 2: Clear old merchant mappings (we don't need them)
    console.log('🗑️  Step 2: Clearing old merchant mappings...');
    const oldCount = db.prepare('SELECT COUNT(*) as count FROM category_mapping').get().count;
    console.log(`   Found ${oldCount} old merchant mappings (will be replaced)`);

    // Step 3: Build category name to ID mapping
    console.log('🔍 Step 3: Building category mapping...');
    const categories = db.prepare(`
      SELECT id, name, name_en FROM category_definitions
    `).all();

    const categoryNameMap = new Map();
    categories.forEach(cat => {
      categoryNameMap.set(cat.name, cat.id);
    });

    // Step 4: Insert legacy category mappings
    console.log('📥 Step 4: Inserting legacy category mappings...');
    const insert = db.prepare(`
      INSERT INTO category_mapping_new (old_category_name, category_definition_id, notes)
      VALUES (?, ?, ?)
    `);

    let insertedCount = 0;
    let skippedCount = 0;

    for (const mapping of LEGACY_MAPPINGS) {
      const categoryId = categoryNameMap.get(mapping.newCategory);
      if (!categoryId) {
        console.warn(`   ⚠️  Warning: Could not find category '${mapping.newCategory}' for '${mapping.oldCategory}'`);
        skippedCount++;
        continue;
      }

      insert.run(mapping.oldCategory, categoryId, `Maps to: ${mapping.newCategory}`);
      insertedCount++;
    }

    console.log(`   ✅ Inserted ${insertedCount} legacy mappings`);
    if (skippedCount > 0) {
      console.log(`   ⚠️  Skipped ${skippedCount} mappings (category not found)`);
    }

    // Step 5: Drop old table and rename new one
    console.log('🔄 Step 5: Swapping tables...');
    db.exec('DROP TABLE category_mapping');
    db.exec('ALTER TABLE category_mapping_new RENAME TO category_mapping');
    db.exec('CREATE INDEX idx_category_mapping_category ON category_mapping (category_definition_id)');

    // Step 6: Auto-assign category_definition_id to transactions
    console.log('🔗 Step 6: Auto-assigning categories to transactions...');
    const updateResult = db.prepare(`
      UPDATE transactions
      SET category_definition_id = (
        SELECT cm.category_definition_id
        FROM category_mapping cm
        WHERE cm.old_category_name = transactions.category
      )
      WHERE category_definition_id IS NULL
        AND category IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM category_mapping cm
          WHERE cm.old_category_name = transactions.category
        )
    `).run();

    console.log(`   ✅ Updated ${updateResult.changes} transactions`);

    // Step 7: Report statistics
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(category_definition_id) as with_category,
        COUNT(*) - COUNT(category_definition_id) as without_category
      FROM transactions
    `).get();

    console.log('\n📊 Final Statistics:');
    console.log(`   Total transactions: ${stats.total}`);
    console.log(`   With category_definition_id: ${stats.with_category}`);
    console.log(`   Without category_definition_id: ${stats.without_category}`);

    db.exec('COMMIT');
    console.log('\n✅ Migration completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    try {
      db.exec('ROLLBACK');
    } catch (rollbackError) {
      console.error('Failed to rollback:', rollbackError.message);
    }
    throw error;
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
}
