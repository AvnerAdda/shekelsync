const fs = require('fs');
const path = require('path');
const resolveBetterSqlite = require('./better-sqlite3-wrapper.js');
const {
  assertSqlCipherAvailable,
  formatKeyClause,
  isHexKey,
} = require('./sqlcipher-utils.js');

function ensureParentDir(targetPath) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeKeyInfo(keyInfo) {
  if (!keyInfo || !keyInfo.value) {
    throw new Error('SQLCipher key is required for migration.');
  }
  if (typeof keyInfo.isHex === 'boolean') {
    return keyInfo;
  }
  return { value: keyInfo.value, isHex: isHexKey(keyInfo.value) };
}

function migrateSqliteToSqlcipher({
  sourcePath,
  targetPath,
  keyInfo,
  force = false,
  databaseCtor,
} = {}) {
  if (!sourcePath) {
    throw new Error('Source SQLite path is required.');
  }
  if (!targetPath) {
    throw new Error('Target SQLCipher path is required.');
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source database not found at ${sourcePath}`);
  }
  if (fs.existsSync(targetPath)) {
    if (!force) {
      throw new Error(`Target database already exists at ${targetPath}. Use --force to overwrite.`);
    }
    fs.unlinkSync(targetPath);
    const walPath = `${targetPath}-wal`;
    const shmPath = `${targetPath}-shm`;
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  }

  ensureParentDir(targetPath);

  const resolved = resolveBetterSqlite();
  const DatabaseCtor = databaseCtor || (resolved.default ?? resolved);
  const db = new DatabaseCtor(sourcePath);

  try {
    assertSqlCipherAvailable(db);
    db.pragma("key = ''");
    db.pragma('cipher_compatibility = 4');
    db.prepare('SELECT count(*) FROM sqlite_master').get();

    const normalizedKey = normalizeKeyInfo(keyInfo);
    const keyClause = formatKeyClause(normalizedKey);

    db.exec(`ATTACH DATABASE '${targetPath}' AS encrypted KEY ${keyClause}`);
    db.exec("SELECT sqlcipher_export('encrypted')");
    db.exec('DETACH DATABASE encrypted');
  } finally {
    db.close();
  }

  return { sourcePath, targetPath };
}

module.exports = {
  migrateSqliteToSqlcipher,
};
module.exports.default = module.exports;
