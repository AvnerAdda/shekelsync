#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_NODE_MODULES = path.join(PROJECT_ROOT, 'app', 'node_modules');
const Database = require(path.join(APP_NODE_MODULES, 'better-sqlite3'));
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite');

function log(step, message) {
  console.log(`[${step}] ${message}`);
}

function normalize(value) {
  if (value === null || value === undefined) return '';
  return value.toString().trim().toLowerCase();
}

function parseArgs() {
  const args = process.argv.slice(2);
  let dbPath = DEFAULT_DB_PATH;
  let noBackup = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--db':
      case '-d':
        dbPath = path.resolve(PROJECT_ROOT, args[i + 1]);
        i += 1;
        break;
      case '--no-backup':
        noBackup = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { dbPath, noBackup };
}

function printHelp() {
  console.log(`Usage: node scripts/migrate_schema_v2.js [options]\n\nOptions:\n  --db <path>       Path to SQLite database (default: dist/clarify.sqlite)\n  --no-backup       Skip automatic backup creation\n  -h, --help        Show this help message\n`);
}

function backupDatabase(dbPath) {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backupPath = `${dbPath}.bak-${timestamp}`;
  fs.copyFileSync(dbPath, backupPath);
  log('backup', `Created backup at ${backupPath}`);
}

function tableExists(db, tableName) {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
  return !!row;
}

function columnExists(db, tableName, columnName) {
  const info = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return info.some(col => col.name === columnName);
}

function buildCategoryLookup(db) {
  const rows = db.prepare(`
    SELECT cd.id, cd.name, cd.name_en, cd.parent_id, parent.name AS parent_name, parent.name_en AS parent_name_en
    FROM category_definitions cd
    LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
  `).all();

  const map = new Map();
  const byId = new Map();

  rows.forEach(row => {
    byId.set(row.id, row);
    const names = [row.name, row.name_en];
    const parentNames = [row.parent_name, row.parent_name_en, ''];

    names.forEach(name => {
      if (!name) return;
      parentNames.forEach(parentName => {
        const key = `${normalize(name)}|${normalize(parentName)}`;
        if (!map.has(key)) {
          map.set(key, row.id);
        }
      });
    });
  });

  return { map, byId };
}

function findCategoryId(lookup, options) {
  const { name, parentName } = options;
  const normalizedName = normalize(name);
  const normalizedParent = normalize(parentName);
  if (!normalizedName) return null;

  const keys = [
    `${normalizedName}|${normalizedParent}`,
    `${normalizedName}|`,
  ];

  for (const key of keys) {
    if (lookup.map.has(key)) {
      return lookup.map.get(key);
    }
  }

  return null;
}

function migrateCategoryActionability(db, lookup, stats) {
  if (!tableExists(db, 'category_actionability_settings')) return;
  if (!columnExists(db, 'category_actionability_settings', 'parent_category')) return;

  log('migrate', 'Normalising category_actionability_settings');

  db.exec(`
    CREATE TABLE category_actionability_settings_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_definition_id INTEGER NOT NULL UNIQUE,
      actionability_level TEXT NOT NULL DEFAULT 'medium' CHECK (actionability_level IN ('low','medium','high')),
      monthly_average REAL NOT NULL DEFAULT 0,
      transaction_count INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 1 CHECK (is_default IN (0,1)),
      user_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE CASCADE
    );
  `);

  const rows = db.prepare(`SELECT * FROM category_actionability_settings`).all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO category_actionability_settings_new (
      id,
      category_definition_id,
      actionability_level,
      monthly_average,
      transaction_count,
      is_default,
      user_notes,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let migrated = 0;
  let skipped = 0;

  const insertTransaction = db.transaction(() => {
    rows.forEach(row => {
      const categoryId = findCategoryId(lookup, {
        name: row.subcategory || row.parent_category,
        parentName: row.subcategory ? row.parent_category : null,
      });

      if (!categoryId) {
        skipped += 1;
        return;
      }

      insert.run(
        row.id,
        categoryId,
        row.actionability_level || 'medium',
        row.monthly_average ?? 0,
        row.transaction_count ?? 0,
        row.is_default ?? 1,
        row.user_notes || null,
        row.created_at || new Date().toISOString(),
        row.updated_at || new Date().toISOString()
      );
      migrated += 1;
    });
  });

  insertTransaction();

  db.exec(`DROP TABLE category_actionability_settings`);
  db.exec(`ALTER TABLE category_actionability_settings_new RENAME TO category_actionability_settings`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_actionability_category ON category_actionability_settings (category_definition_id);`);

  log('migrate', `category_actionability_settings migrated: ${migrated}, skipped: ${skipped}`);
  stats.categoryActionability = { migrated, skipped };
}

function migrateCategoryMapping(db, lookup, stats) {
  if (!tableExists(db, 'category_mapping')) return;
  if (columnExists(db, 'category_mapping', 'category_definition_id')) return;

  log('migrate', 'Normalising category_mapping');

  db.exec(`
    CREATE TABLE category_mapping_new (
      hebrew_category TEXT PRIMARY KEY,
      category_definition_id INTEGER NOT NULL,
      description TEXT,
      FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE CASCADE
    );
  `);

  const rows = db.prepare(`SELECT * FROM category_mapping`).all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO category_mapping_new (hebrew_category, category_definition_id, description)
    VALUES (?, ?, ?)
  `);

  let migrated = 0;
  let skipped = 0;

  const insertTransaction = db.transaction(() => {
    rows.forEach(row => {
      const categoryId = findCategoryId(lookup, {
        name: row.subcategory || row.parent_category,
        parentName: row.subcategory ? row.parent_category : null,
      });

      if (!categoryId) {
        skipped += 1;
        return;
      }

      insert.run(row.hebrew_category, categoryId, row.description || null);
      migrated += 1;
    });
  });

  insertTransaction();

  db.exec(`DROP TABLE category_mapping`);
  db.exec(`ALTER TABLE category_mapping_new RENAME TO category_mapping`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_category_mapping_category ON category_mapping (category_definition_id);`);

  log('migrate', `category_mapping migrated: ${migrated}, skipped: ${skipped}`);
  stats.categoryMapping = { migrated, skipped };
}

function migrateCategoryBudgets(db, lookup, stats) {
  if (!tableExists(db, 'category_budgets')) return;
  if (columnExists(db, 'category_budgets', 'category_definition_id')) return;

  log('migrate', 'Normalising category_budgets');

  db.exec(`
    CREATE TABLE category_budgets_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_definition_id INTEGER NOT NULL,
      period_type TEXT NOT NULL CHECK (period_type IN ('weekly','monthly','yearly')),
      budget_limit REAL NOT NULL CHECK (budget_limit > 0),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(category_definition_id, period_type),
      FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE CASCADE
    );
  `);

  const rows = db.prepare(`SELECT * FROM category_budgets`).all();
  const insert = db.prepare(`
    INSERT INTO category_budgets_new (id, category_definition_id, period_type, budget_limit, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let migrated = 0;
  let skipped = 0;

  const insertTransaction = db.transaction(() => {
    rows.forEach(row => {
      const categoryId = findCategoryId(lookup, { name: row.category });
      if (!categoryId) {
        skipped += 1;
        return;
      }

      insert.run(
        row.id,
        categoryId,
        row.period_type,
        row.budget_limit,
        row.is_active ?? 1,
        row.created_at || new Date().toISOString(),
        row.updated_at || new Date().toISOString()
      );
      migrated += 1;
    });
  });

  insertTransaction();

  db.exec(`DROP TABLE category_budgets`);
  db.exec(`ALTER TABLE category_budgets_new RENAME TO category_budgets`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_category_budgets_active ON category_budgets (is_active);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_category_budgets_category_id ON category_budgets (category_definition_id);`);

  log('migrate', `category_budgets migrated: ${migrated}, skipped: ${skipped}`);
  stats.categoryBudgets = { migrated, skipped };
}

function migrateMerchantCatalog(db, lookup, stats) {
  if (!tableExists(db, 'merchant_catalog')) {
    log('migrate', 'Creating merchant_catalog table');
    db.exec(`
      CREATE TABLE merchant_catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        merchant_pattern TEXT NOT NULL,
        category_definition_id INTEGER NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(merchant_pattern),
        FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE CASCADE
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_merchant_catalog_pattern ON merchant_catalog (merchant_pattern);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_merchant_catalog_active ON merchant_catalog (is_active);`);
    stats.merchantCatalog = { created: true };
    return;
  }

  if (columnExists(db, 'merchant_catalog', 'category_definition_id')) return;

  log('migrate', 'Normalising merchant_catalog');

  db.exec(`
    CREATE TABLE merchant_catalog_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_pattern TEXT NOT NULL,
      category_definition_id INTEGER NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(merchant_pattern),
      FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE CASCADE
    );
  `);

  const rows = db.prepare(`SELECT * FROM merchant_catalog`).all();
  const insert = db.prepare(`
    INSERT INTO merchant_catalog_new (id, merchant_pattern, category_definition_id, confidence, is_active, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let migrated = 0;
  let skipped = 0;

  const insertTransaction = db.transaction(() => {
    rows.forEach(row => {
      const categoryId = findCategoryId(lookup, {
        name: row.subcategory || row.parent_category,
        parentName: row.subcategory ? row.parent_category : null,
      });

      if (!categoryId) {
        skipped += 1;
        return;
      }

      insert.run(
        row.id,
        row.merchant_pattern,
        categoryId,
        row.confidence ?? 1.0,
        row.is_active ?? 1,
        row.notes || null,
        row.created_at || new Date().toISOString(),
        row.updated_at || new Date().toISOString()
      );
      migrated += 1;
    });
  });

  insertTransaction();

  db.exec(`DROP TABLE merchant_catalog`);
  db.exec(`ALTER TABLE merchant_catalog_new RENAME TO merchant_catalog`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_merchant_catalog_pattern ON merchant_catalog (merchant_pattern);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_merchant_catalog_active ON merchant_catalog (is_active);`);

  log('migrate', `merchant_catalog migrated: ${migrated}, skipped: ${skipped}`);
  stats.merchantCatalog = { migrated, skipped };
}

function migrateManualExclusions(db, lookup, stats) {
  if (!tableExists(db, 'manual_exclusions')) return;
  if (columnExists(db, 'manual_exclusions', 'override_category_definition_id')) return;

  log('migrate', 'Updating manual_exclusions override references');

  db.exec(`
    CREATE TABLE manual_exclusions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_identifier TEXT NOT NULL,
      transaction_vendor TEXT NOT NULL,
      exclusion_reason TEXT NOT NULL,
      override_category TEXT,
      override_category_definition_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(transaction_identifier, transaction_vendor),
      FOREIGN KEY (transaction_identifier, transaction_vendor)
        REFERENCES transactions(identifier, vendor)
        ON DELETE CASCADE,
      FOREIGN KEY (override_category_definition_id)
        REFERENCES category_definitions(id)
        ON DELETE SET NULL
    );
  `);

  const rows = db.prepare(`SELECT * FROM manual_exclusions`).all();
  const insert = db.prepare(`
    INSERT INTO manual_exclusions_new (
      id,
      transaction_identifier,
      transaction_vendor,
      exclusion_reason,
      override_category,
      override_category_definition_id,
      notes,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let migrated = 0;
  let skipped = 0;

  const insertTransaction = db.transaction(() => {
    rows.forEach(row => {
      let categoryId = null;
      if (row.override_category) {
        categoryId = findCategoryId(lookup, { name: row.override_category });
      }

      insert.run(
        row.id,
        row.transaction_identifier,
        row.transaction_vendor,
        row.exclusion_reason,
        row.override_category || null,
        categoryId,
        row.notes || null,
        row.created_at || new Date().toISOString(),
        row.updated_at || new Date().toISOString()
      );
      if (categoryId) migrated += 1; else skipped += 1;
    });
  });

  insertTransaction();

  db.exec(`DROP TABLE manual_exclusions`);
  db.exec(`ALTER TABLE manual_exclusions_new RENAME TO manual_exclusions`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_manual_exclusions_category ON manual_exclusions (override_category);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_manual_exclusions_category_id ON manual_exclusions (override_category_definition_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_manual_exclusions_reason ON manual_exclusions (exclusion_reason);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_manual_exclusions_transaction ON manual_exclusions (transaction_identifier, transaction_vendor);`);

  log('migrate', `manual_exclusions migrated: ${migrated}, unresolved: ${skipped}`);
  stats.manualExclusions = { migrated, skipped };
}

function migrateDuplicatePatterns(db, lookup, stats) {
  if (!tableExists(db, 'duplicate_patterns')) return;
  if (columnExists(db, 'duplicate_patterns', 'override_category_definition_id')) return;

  log('migrate', 'Updating duplicate_patterns override references');

  db.exec(`
    CREATE TABLE duplicate_patterns_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_name TEXT NOT NULL,
      pattern_regex TEXT NOT NULL,
      description TEXT,
      match_type TEXT NOT NULL,
      override_category TEXT,
      override_category_definition_id INTEGER,
      is_user_defined INTEGER NOT NULL DEFAULT 0 CHECK (is_user_defined IN (0,1)),
      is_auto_learned INTEGER NOT NULL DEFAULT 0 CHECK (is_auto_learned IN (0,1)),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      confidence REAL NOT NULL DEFAULT 1.0,
      match_count INTEGER NOT NULL DEFAULT 0,
      last_matched_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      notes TEXT,
      FOREIGN KEY (override_category_definition_id) REFERENCES category_definitions(id) ON DELETE SET NULL
    );
  `);

  const rows = db.prepare(`SELECT * FROM duplicate_patterns`).all();
  const insert = db.prepare(`
    INSERT INTO duplicate_patterns_new (
      id,
      pattern_name,
      pattern_regex,
      description,
      match_type,
      override_category,
      override_category_definition_id,
      is_user_defined,
      is_auto_learned,
      is_active,
      confidence,
      match_count,
      last_matched_at,
      created_at,
      created_by,
      notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let migrated = 0;
  let skipped = 0;

  const insertTransaction = db.transaction(() => {
    rows.forEach(row => {
      let categoryId = null;
      if (row.override_category) {
        categoryId = findCategoryId(lookup, { name: row.override_category });
      }

      insert.run(
        row.id,
        row.pattern_name,
        row.pattern_regex,
        row.description || null,
        row.match_type,
        row.override_category || null,
        categoryId,
        row.is_user_defined ?? 0,
        row.is_auto_learned ?? 0,
        row.is_active ?? 1,
        row.confidence ?? 1.0,
        row.match_count ?? 0,
        row.last_matched_at || null,
        row.created_at || new Date().toISOString(),
        row.created_by || null,
        row.notes || null
      );
      if (categoryId) migrated += 1; else if (row.override_category) skipped += 1;
    });
  });

  insertTransaction();

  db.exec(`DROP TABLE duplicate_patterns`);
  db.exec(`ALTER TABLE duplicate_patterns_new RENAME TO duplicate_patterns`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_duplicate_patterns_active ON duplicate_patterns (is_active, match_type);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_duplicate_patterns_regex ON duplicate_patterns (pattern_regex);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_duplicate_patterns_override_cat_id ON duplicate_patterns (override_category_definition_id);`);

  log('migrate', `duplicate_patterns migrated: ${migrated}, unresolved: ${skipped}`);
  stats.duplicatePatterns = { migrated, skipped };
}

function migrateCategorizationRules(db, lookup, stats) {
  if (!tableExists(db, 'categorization_rules')) return;

  const rows = db.prepare(`SELECT id, category_definition_id, parent_category, subcategory, target_category FROM categorization_rules`).all();
  let updated = 0;
  let skipped = 0;

  const update = db.prepare(`UPDATE categorization_rules SET category_definition_id = ? WHERE id = ?`);

  const transaction = db.transaction(() => {
    rows.forEach(row => {
      if (row.category_definition_id) return;

      const categoryId = findCategoryId(lookup, {
        name: row.subcategory || row.target_category,
        parentName: row.subcategory ? row.parent_category : null,
      });

      if (!categoryId) {
        skipped += 1;
        return;
      }

      update.run(categoryId, row.id);
      updated += 1;
    });
  });

  transaction();

  log('migrate', `categorization_rules updated: ${updated}, unresolved: ${skipped}`);
  stats.categorizationRules = { updated, skipped };
}

function migrateTransactions(db, lookup, stats) {
  const rows = db.prepare(`
    SELECT identifier, vendor, category, parent_category, subcategory
    FROM transactions
    WHERE category_definition_id IS NULL
  `).all();

  if (rows.length === 0) {
    stats.transactions = { updated: 0, skipped: 0 };
    return;
  }

  const update = db.prepare(`
    UPDATE transactions
    SET category_definition_id = ?
    WHERE identifier = ? AND vendor = ?
  `);

  let updated = 0;
  let skipped = 0;

  const transaction = db.transaction(() => {
    rows.forEach(row => {
      const categoryId = findCategoryId(lookup, {
        name: row.subcategory || row.category,
        parentName: row.subcategory ? row.parent_category : null,
      });

      if (!categoryId) {
        skipped += 1;
        return;
      }

      update.run(categoryId, row.identifier, row.vendor);
      updated += 1;
    });
  });

  transaction();

  log('migrate', `transactions updated: ${updated}, unresolved: ${skipped}`);
  stats.transactions = { updated, skipped };
}

function main() {
  const { dbPath, noBackup } = parseArgs();

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}`);
  }

  if (!noBackup) {
    backupDatabase(dbPath);
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');

  const stats = {};

  try {
    db.exec('BEGIN');

    const lookup = buildCategoryLookup(db);

    migrateCategoryActionability(db, lookup, stats);
    migrateCategoryMapping(db, lookup, stats);
    migrateCategoryBudgets(db, lookup, stats);
    migrateMerchantCatalog(db, lookup, stats);
    migrateManualExclusions(db, lookup, stats);
    migrateDuplicatePatterns(db, lookup, stats);
    migrateCategorizationRules(db, lookup, stats);
    migrateTransactions(db, lookup, stats);

    db.exec('COMMIT');
    log('done', 'Schema normalisation completed successfully');
    console.table(stats);
  } catch (error) {
    db.exec('ROLLBACK');
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    db.pragma('foreign_keys = ON');
    db.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
