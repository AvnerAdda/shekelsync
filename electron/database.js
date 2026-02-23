const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { app } = require('electron');
const { resolveAppPath, requireFromApp } = require('./paths');

// Add app directory to module search paths
require('module').globalPaths.push(resolveAppPath('node_modules'));

let Pool = null;
let SqliteDatabase = null;

const PLACEHOLDER_REGEX = /\$(\d+)/g;
const SELECT_LIKE_REGEX = /^\s*(WITH|SELECT|PRAGMA)/i;
const RETURNING_REGEX = /\bRETURNING\b/i;

function shouldUseSqlite() {
  if (process.env.USE_SQLITE === 'true') return true;
  if (process.env.SQLITE_DB_PATH) return true;
  return false;
}

function resolveSqliteInitPath() {
  const packagedPath = resolveAppPath('scripts', 'init_sqlite_db.js');
  if (fs.existsSync(packagedPath)) return packagedPath;

  const resourcesPath = process.resourcesPath;
  if (resourcesPath) {
    const resourcesCandidate = path.join(resourcesPath, 'scripts', 'init_sqlite_db.js');
    if (fs.existsSync(resourcesCandidate)) return resourcesCandidate;

    const unpackedCandidate = path.join(
      resourcesPath,
      'app.asar.unpacked',
      'scripts',
      'init_sqlite_db.js',
    );
    if (fs.existsSync(unpackedCandidate)) return unpackedCandidate;
  }

  const devPath = resolveAppPath('..', 'scripts', 'init_sqlite_db.js');
  if (fs.existsSync(devPath)) return devPath;

  return null;
}

function resolveDemoSeedPath() {
  const packagedPath = resolveAppPath('scripts', 'seed_realistic_demo.js');
  if (fs.existsSync(packagedPath)) return packagedPath;

  const resourcesPath = process.resourcesPath;
  if (resourcesPath) {
    const resourcesCandidate = path.join(resourcesPath, 'scripts', 'seed_realistic_demo.js');
    if (fs.existsSync(resourcesCandidate)) return resourcesCandidate;

    const unpackedCandidate = path.join(
      resourcesPath,
      'app.asar.unpacked',
      'scripts',
      'seed_realistic_demo.js',
    );
    if (fs.existsSync(unpackedCandidate)) return unpackedCandidate;
  }

  const devPath = resolveAppPath('..', 'scripts', 'seed_realistic_demo.js');
  if (fs.existsSync(devPath)) return devPath;

  return null;
}

function todayUtcDateString() {
  return new Date().toISOString().slice(0, 10);
}

function isAnonymizedDbPath(dbPath) {
  return path.basename(String(dbPath || '')).toLowerCase().includes('anonymized');
}

function getDemoBaseDate() {
  return `${todayUtcDateString()}T12:00:00Z`;
}

function shouldRefreshDemoData(dbPath) {
  const refreshSetting = process.env.DEMO_REFRESH_ON_LAUNCH;
  const forceRefresh = refreshSetting === 'true';
  const disableRefresh = refreshSetting === 'false';
  const isAnonymized = isAnonymizedDbPath(dbPath);

  if (disableRefresh) return false;
  if (!forceRefresh && !isAnonymized) return false;

  if (!fs.existsSync(dbPath)) return true;

  let demoDb = null;
  try {
    if (!SqliteDatabase) {
      const betterSqlite = requireFromApp('better-sqlite3');
      SqliteDatabase = typeof betterSqlite.default === 'function' ? betterSqlite.default : betterSqlite;
    }
    demoDb = new SqliteDatabase(dbPath, { fileMustExist: true });
    const row = demoDb.prepare('SELECT MAX(date) as max_date FROM transactions').get();
    if (!row || !row.max_date) return true;
    const latestDay = String(row.max_date).slice(0, 10);
    const todayDay = todayUtcDateString();
    return latestDay < todayDay;
  } catch (error) {
    console.warn('[Demo Seed] Failed to read latest transaction date, refreshing demo data.', error?.message || error);
    return true;
  } finally {
    try {
      demoDb?.close();
    } catch (e) {
      // Ignore close failures
    }
  }
}

function refreshDemoData(dbPath) {
  const seedPath = resolveDemoSeedPath();
  if (!seedPath) {
    console.warn('[Demo Seed] Demo seed script not found, skipping refresh.');
    return;
  }

  const env = {
    ...process.env,
    SQLITE_DB_PATH: dbPath,
    DEMO_BASE_DATE: getDemoBaseDate(),
    ELECTRON_RUN_AS_NODE: '1',
  };

  try {
    execFileSync(process.execPath, [seedPath], {
      cwd: path.dirname(seedPath),
      env,
      stdio: 'inherit',
    });
  } catch (error) {
    console.warn('[Demo Seed] Failed to refresh demo data:', error?.message || error);
  }
}

function resolveSqliteDatabaseCtor(databaseCtor) {
  if (databaseCtor) {
    return databaseCtor;
  }
  if (SqliteDatabase) {
    return SqliteDatabase;
  }
  const betterSqlite = requireFromApp('better-sqlite3');
  SqliteDatabase = typeof betterSqlite.default === 'function' ? betterSqlite.default : betterSqlite;
  return SqliteDatabase;
}

function hasMinimumSchema(dbPath, databaseCtor) {
  let db = null;
  try {
    const DatabaseCtor = resolveSqliteDatabaseCtor(databaseCtor);
    db = new DatabaseCtor(dbPath, { fileMustExist: true, readonly: true });

    const requiredTables = [
      'transactions',
      'vendor_credentials',
      'category_definitions',
      'institution_nodes',
    ];

    const placeholders = requiredTables.map(() => '?').join(', ');
    const presentRows = db
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name IN (${placeholders})
      `)
      .all(requiredTables);

    const present = new Set(presentRows.map((row) => row.name));
    return requiredTables.every((name) => present.has(name));
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch (error) {
      // Ignore close failures for probe handles.
    }
  }
}

function initializeSqliteIfMissing(dbPath, databaseCtor) {
  const initPath = resolveSqliteInitPath();
  if (!initPath) {
    throw new Error('SQLite init script not found for database bootstrap.');
  }

  const initModule = require(initPath);
  if (typeof initModule.initializeSqliteDatabase !== 'function') {
    throw new Error('SQLite init script is missing initializeSqliteDatabase export.');
  }

  const initialize = (force = false) =>
    initModule.initializeSqliteDatabase({
      output: dbPath,
      force,
      databaseCtor,
      withDemo: isAnonymizedDbPath(dbPath),
    });

  if (!fs.existsSync(dbPath)) {
    initialize(false);
    return;
  }

  if (hasMinimumSchema(dbPath, databaseCtor)) {
    return;
  }

  console.warn('[SQLite Init] Existing database is missing required schema tables. Reinitializing schema.', { dbPath });
  initialize(true);
}

function replacePlaceholders(sql) {
  return sql.replace(PLACEHOLDER_REGEX, '?');
}

class DatabaseManager {
  constructor() {
    this.pool = null;
    this.isConnected = false;
    this.mode = shouldUseSqlite() ? 'sqlite' : 'postgres';
    this.sqliteDb = null;
    this.sqlitePath = null;
  }

  async initialize(config = null) {
    try {
      // Use provided config or load from environment
      const dbConfig = config || this.getDefaultConfig();

      console.log('Initializing database connection...');
      console.log('Config:', {
        host: dbConfig.host,
        database: dbConfig.database,
        port: dbConfig.port,
        user: dbConfig.user,
        mode: this.mode
      });

      if (this.mode === 'sqlite') {
        const preferredSqlitePath = path.join(app.getPath('userData'), 'shekelsync.sqlite');
        const legacySqlitePath = path.join(app.getPath('userData'), 'clarify.sqlite');
        const fallbackSqlitePath = fs.existsSync(preferredSqlitePath)
          ? preferredSqlitePath
          : fs.existsSync(legacySqlitePath)
            ? legacySqlitePath
            : preferredSqlitePath;
        const dbPath =
          process.env.SQLITE_DB_PATH ||
          fallbackSqlitePath;

        if (!SqliteDatabase) {
          const betterSqlite = requireFromApp('better-sqlite3');
          SqliteDatabase = typeof betterSqlite.default === 'function' ? betterSqlite.default : betterSqlite;
        }

        initializeSqliteIfMissing(dbPath, SqliteDatabase);

        if (shouldRefreshDemoData(dbPath)) {
          console.log('[Demo Seed] Refreshing anonymized demo data for latest day...');
          refreshDemoData(dbPath);
        }

        this.sqliteDb = new SqliteDatabase(dbPath, { fileMustExist: true });
        this.sqlitePath = dbPath;
        this.sqliteDb.pragma('foreign_keys = ON');
        this.sqliteDb.pragma('journal_mode = WAL');

        // Simple sanity check
        this.sqliteDb.prepare('SELECT 1').get();
      } else {
        if (!Pool) {
          Pool = requireFromApp('pg').Pool;
        }

        this.pool = new Pool({
          user: dbConfig.user,
          host: dbConfig.host,
          database: dbConfig.database,
          password: dbConfig.password,
          port: dbConfig.port,
          ssl: false,
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000,
        });

        const client = await this.pool.connect();
        const result = await client.query('SELECT NOW()');
        console.log('Database test query result:', result.rows[0]);
        client.release();
      }

      this.isConnected = true;

      return { success: true, message: 'Database connected successfully' };
    } catch (error) {
      if (this.mode === 'postgres' && error.code === 'MODULE_NOT_FOUND') {
        console.warn('Postgres module not available, falling back to SQLite. Set USE_SQLITE=true to silence this.');
        this.mode = 'sqlite';
        return this.initialize(config);
      }

      console.error('Database connection failed:', error);
      this.isConnected = false;
      return {
        success: false,
        message: `Database connection failed: ${error.message}`,
        error: error
      };
    }
  }

  getDefaultConfig() {
    // Load from environment variables (these will be encrypted in production)
    return {
      user: process.env.CLARIFY_DB_USER || 'clarify',
      host: process.env.CLARIFY_DB_HOST || 'localhost',
      database: process.env.CLARIFY_DB_NAME || 'my_clarify',
      password: process.env.CLARIFY_DB_PASSWORD || 'clarify_pass',
      port: parseInt(process.env.CLARIFY_DB_PORT) || 5432
    };
  }

  async getClient() {
    if (!this.isConnected) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    if (this.mode === 'sqlite') {
      if (!SqliteDatabase) {
        SqliteDatabase = requireFromApp('better-sqlite3');
      }
      return {
        query: (text, params = []) => this.query(text, params),
        release: () => {},
      };
    }

    return await this.pool.connect();
  }

  async query(text, params = []) {
    if (!this.isConnected) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    if (this.mode === 'sqlite') {
      const convertedSql = replacePlaceholders(text);
      const stmt = this.sqliteDb.prepare(convertedSql);
      const normalizedParams = params.map((value) => {
        if (value instanceof Date) return value.toISOString();
        if (value === true) return 1;
        if (value === false) return 0;
        return value;
      });
      const trimmed = convertedSql.trim();
      if (SELECT_LIKE_REGEX.test(trimmed) || RETURNING_REGEX.test(convertedSql)) {
        const rows = stmt.all(normalizedParams);
        return { rows, rowCount: rows.length };
      }
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(trimmed)) {
        this.sqliteDb.exec(convertedSql);
        return { rows: [], rowCount: 0 };
      }
      const info = stmt.run(normalizedParams);
      return { rows: [], rowCount: info.changes ?? 0 };
    }

    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return result;
    } catch (error) {
      console.error('Database query error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async testConnection() {
    try {
      const result = await this.query('SELECT 1 as test');
      return { success: true, result: result.rows };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async close() {
    if (this.mode === 'sqlite') {
      if (this.sqliteDb) {
        this.sqliteDb.close();
      }
      this.sqliteDb = null;
      this.sqlitePath = null;
      this.isConnected = false;
      return;
    }

    if (this.pool) {
      console.log('Closing database connection pool...');
      await this.pool.end();
      this.isConnected = false;
    }
  }

  // Get database statistics for debugging
  async getStats() {
    if (this.mode === 'sqlite') {
      if (!this.sqliteDb) {
        return { error: 'SQLite connection not initialized' };
      }
      return {
        totalCount: 1,
        idleCount: 0,
        waitingCount: 0,
        isConnected: this.isConnected
      };
    }

    if (!this.pool) {
      return { error: 'Pool not initialized' };
    }

    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      isConnected: this.isConnected
    };
  }

  getSqliteDatabase() {
    if (this.mode !== 'sqlite') {
      return null;
    }
    return this.sqliteDb;
  }

  getSqlitePath() {
    if (this.mode !== 'sqlite') {
      return null;
    }
    return this.sqlitePath;
  }
}

// Create a singleton instance
const dbManager = new DatabaseManager();

module.exports = {
  DatabaseManager,
  dbManager
};
