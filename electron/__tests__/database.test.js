import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'url';

const requireModule = createRequire(import.meta.url);
const ModuleLoader = requireModule('module');
const electronTestDir = path.dirname(fileURLToPath(import.meta.url));
const databaseModulePath = path.join(electronTestDir, '..', 'database.js');
const pathsModulePath = path.join(electronTestDir, '..', 'paths.js');

const REQUIRED_TABLES = [
  'transactions',
  'vendor_credentials',
  'category_definitions',
  'institution_nodes',
];

function createFakeSqliteHarness() {
  const schemas = new Map();

  class FakeDatabase {
    constructor(dbPath, options = {}) {
      this.dbPath = dbPath;

      if (options.fileMustExist && !fs.existsSync(dbPath)) {
        throw new Error(`ENOENT: ${dbPath}`);
      }

      const schema = schemas.get(dbPath);
      if (options.readonly && schema?.probeError) {
        throw new Error(schema.probeError);
      }
    }

    prepare(sql) {
      if (sql.includes('FROM sqlite_master')) {
        return {
          all: (requiredTables) => {
            const tables = new Set(schemas.get(this.dbPath)?.tables || []);
            return requiredTables
              .filter((name) => tables.has(name))
              .map((name) => ({ name }));
          },
        };
      }

      if (/SELECT 1/i.test(sql)) {
        return { get: () => ({ test: 1 }) };
      }

      throw new Error(`Unexpected SQL in fake SQLite harness: ${sql}`);
    }

    pragma() {}

    close() {}
  }

  return {
    FakeDatabase,
    setSchema(dbPath, schema) {
      schemas.set(dbPath, schema);
    },
    markInitialized(dbPath) {
      schemas.set(dbPath, { tables: [...REQUIRED_TABLES] });
      if (!fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, 'initialized');
      }
    },
  };
}

function createTempInitModule(tmpDir) {
  const initPath = path.join(tmpDir, 'init_sqlite_db.js');
  fs.writeFileSync(
    initPath,
    "module.exports = { initializeSqliteDatabase: (args) => global.__TEST_SQLITE_INIT__(args) };",
  );
  return initPath;
}

async function loadDatabaseModule({ tmpDir, harness }) {
  const initPath = createTempInitModule(tmpDir);
  const originalLoad = ModuleLoader._load;
  const electronMock = {
    app: {
      getPath: vi.fn(() => path.join(tmpDir, 'userData')),
      isPackaged: true,
      disableHardwareAcceleration: vi.fn(),
      commandLine: {
        appendSwitch: vi.fn(),
      },
    },
  };
  const pathsMock = {
    resolveAppPath: (...segments) => {
      if (segments.join('/') === 'scripts/init_sqlite_db.js') {
        return initPath;
      }
      return path.join(tmpDir, ...segments);
    },
    requireFromApp: (modulePath) => {
      if (modulePath === 'better-sqlite3') {
        return harness.FakeDatabase;
      }
      throw new Error(`Unexpected requireFromApp call: ${modulePath}`);
    },
  };

  ModuleLoader._load = function patched(request, parent, isMain) {
    if (request === 'electron') {
      return electronMock;
    }

    if (request === './paths' && parent?.id === databaseModulePath) {
      return pathsMock;
    }

    let resolved = null;
    try {
      resolved = requireModule.resolve(request, parent);
    } catch {
      // Fall back to the original loader for unresolved requests.
    }

    if (resolved === pathsModulePath) {
      return pathsMock;
    }

    return originalLoad(request, parent, isMain);
  };

  try {
    delete requireModule.cache[databaseModulePath];
    delete requireModule.cache[pathsModulePath];
    return requireModule(databaseModulePath);
  } finally {
    ModuleLoader._load = originalLoad;
  }
}

describe('electron database bootstrap', () => {
  const originalEnv = { ...process.env };
  const tempDirs = [];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env = { ...originalEnv };
    process.env.USE_SQLITE = 'true';

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete global.__TEST_SQLITE_INIT__;
    process.env = { ...originalEnv };

    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it('refuses to auto-reinitialize a non-demo SQLite file on schema mismatch by default', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-db-test-'));
    tempDirs.push(tmpDir);

    const dbPath = path.join(tmpDir, 'shekelsync.sqlite');
    fs.writeFileSync(dbPath, 'legacy-db');

    const harness = createFakeSqliteHarness();
    harness.setSchema(dbPath, { tables: ['transactions'] });

    const initCalls = [];
    global.__TEST_SQLITE_INIT__ = vi.fn((args) => {
      initCalls.push(args);
      harness.markInitialized(args.output);
    });

    process.env.SQLITE_DB_PATH = dbPath;

    const { DatabaseManager } = await loadDatabaseModule({ tmpDir, harness });
    const manager = new DatabaseManager();
    manager.mode = 'sqlite';

    const result = await manager.initialize();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Refusing to auto-reinitialize');
    expect(initCalls).toHaveLength(0);
    expect(fs.existsSync(path.join(tmpDir, 'backups'))).toBe(false);
  });

  it('reinitializes after backup when explicitly forced by environment flag', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-db-test-'));
    tempDirs.push(tmpDir);

    const dbPath = path.join(tmpDir, 'shekelsync.sqlite');
    fs.writeFileSync(dbPath, 'legacy-db');

    const harness = createFakeSqliteHarness();
    harness.setSchema(dbPath, { tables: ['transactions'] });

    const initCalls = [];
    global.__TEST_SQLITE_INIT__ = vi.fn((args) => {
      initCalls.push(args);
      harness.markInitialized(args.output);
    });

    process.env.SQLITE_DB_PATH = dbPath;
    process.env.SQLITE_AUTO_REINIT_ON_SCHEMA_MISMATCH = 'true';

    const { DatabaseManager } = await loadDatabaseModule({ tmpDir, harness });
    const manager = new DatabaseManager();
    manager.mode = 'sqlite';

    const result = await manager.initialize();

    expect(result.success).toBe(true);
    expect(initCalls).toEqual([
      expect.objectContaining({
        output: dbPath,
        force: true,
        withDemo: false,
      }),
    ]);
    const backupsDir = path.join(tmpDir, 'backups');
    expect(fs.existsSync(backupsDir)).toBe(true);
    expect(
      fs.readdirSync(backupsDir).some((file) => file.startsWith('shekelsync-pre-reinit-')),
    ).toBe(true);
  });

  it('continues auto-reinitializing anonymized demo databases without an override flag', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-db-test-'));
    tempDirs.push(tmpDir);

    const dbPath = path.join(tmpDir, 'shekelsync-anonymized.sqlite');
    fs.writeFileSync(dbPath, 'legacy-db');

    const harness = createFakeSqliteHarness();
    harness.setSchema(dbPath, { tables: ['transactions'] });

    const initCalls = [];
    global.__TEST_SQLITE_INIT__ = vi.fn((args) => {
      initCalls.push(args);
      harness.markInitialized(args.output);
    });

    process.env.SQLITE_DB_PATH = dbPath;
    delete process.env.SQLITE_AUTO_REINIT_ON_SCHEMA_MISMATCH;

    const { DatabaseManager } = await loadDatabaseModule({ tmpDir, harness });
    const manager = new DatabaseManager();
    manager.mode = 'sqlite';

    const result = await manager.initialize();

    expect(result.success).toBe(true);
    expect(initCalls).toEqual([
      expect.objectContaining({
        output: dbPath,
        force: true,
        withDemo: true,
      }),
    ]);
  });
});
