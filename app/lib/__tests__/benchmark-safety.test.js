const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildChildEnv,
  isNativeModuleVersionMismatch,
  parseJsonResult,
  removeBenchmarkDatabase,
} = require('../../../scripts/benchmarks/assert-benchmarks.js');

describe('benchmark safety guard', () => {
  it('always points child processes at the isolated benchmark database', () => {
    const databasePath = path.join(os.tmpdir(), 'isolated-benchmark.sqlite');
    const env = buildChildEnv(
      { env: { ELECTRON_RUN_AS_NODE: '1' } },
      databasePath,
    );

    expect(env.SQLITE_DB_PATH).toBe(databasePath);
    expect(env.USE_SQLITE).toBe('true');
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(env.DEMO_BASE_DATE).toBeTruthy();
  });

  it('removes only the exact temporary database family', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-benchmark-test-'));
    const databasePath = path.join(directory, 'benchmark.sqlite');
    const siblingPath = path.join(directory, 'keep.sqlite');

    try {
      fs.writeFileSync(databasePath, 'db');
      fs.writeFileSync(`${databasePath}-wal`, 'wal');
      fs.writeFileSync(`${databasePath}-shm`, 'shm');
      fs.writeFileSync(siblingPath, 'keep');

      removeBenchmarkDatabase(databasePath);

      expect(fs.existsSync(databasePath)).toBe(false);
      expect(fs.existsSync(`${databasePath}-wal`)).toBe(false);
      expect(fs.existsSync(`${databasePath}-shm`)).toBe(false);
      expect(fs.readFileSync(siblingPath, 'utf8')).toBe('keep');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('parses a final pretty-printed result after diagnostic output', () => {
    expect(parseJsonResult('diagnostic\n{\n  "durationMs": 12\n}\n', 'benchmark.js')).toEqual({
      durationMs: 12,
    });
    expect(isNativeModuleVersionMismatch(new Error('NODE_MODULE_VERSION 148'))).toBe(true);
  });
});
