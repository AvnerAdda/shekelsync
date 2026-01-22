const crypto = require('crypto');

const SQLCIPHER_CONTEXT = 'shekelsync-sqlcipher';

function isSqlCipherEnabled(env = process.env) {
  return env.USE_SQLCIPHER === 'true' || Boolean(env.SQLCIPHER_DB_PATH);
}

function isHexKey(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]+$/.test(value) && value.length === 64;
}

function deriveSqlCipherKey(masterKeyHex) {
  if (!isHexKey(masterKeyHex)) {
    throw new Error('CLARIFY_ENCRYPTION_KEY must be a 64-character hex string to derive SQLCipher key.');
  }
  const masterBuffer = Buffer.from(masterKeyHex, 'hex');
  return crypto.createHmac('sha256', masterBuffer).update(SQLCIPHER_CONTEXT).digest('hex');
}

function resolveSqlCipherKey({ env = process.env, requireKey = false } = {}) {
  const explicit = env.SQLCIPHER_KEY;
  if (explicit) {
    const trimmed = String(explicit).trim();
    if (!trimmed) {
      if (requireKey) {
        throw new Error('SQLCIPHER_KEY is empty.');
      }
      return null;
    }
    return { value: trimmed, isHex: isHexKey(trimmed) };
  }

  const masterKey = env.CLARIFY_ENCRYPTION_KEY;
  if (masterKey) {
    return { value: deriveSqlCipherKey(masterKey), isHex: true };
  }

  if (requireKey) {
    throw new Error('SQLCipher key not available. Set CLARIFY_ENCRYPTION_KEY or SQLCIPHER_KEY.');
  }
  return null;
}

function formatKeyClause(keyInfo) {
  if (!keyInfo || !keyInfo.value) {
    throw new Error('SQLCipher key is missing.');
  }
  if (keyInfo.isHex) {
    if (!isHexKey(keyInfo.value)) {
      throw new Error('SQLCipher hex key must be 64 hex characters.');
    }
    return `x'${keyInfo.value}'`;
  }
  const escaped = String(keyInfo.value).replace(/'/g, "''");
  return `'${escaped}'`;
}

function assertSqlCipherAvailable(db) {
  try {
    const version = db.pragma('cipher_version', { simple: true });
    if (!version) {
      throw new Error('SQLCipher not available in this build.');
    }
    return version;
  } catch (error) {
    const message = error?.message || 'SQLCipher not available in this build.';
    throw new Error(message);
  }
}

function applySqlCipherKey(db, keyInfo) {
  assertSqlCipherAvailable(db);
  db.pragma('cipher_compatibility = 4');
  db.pragma(`key = ${formatKeyClause(keyInfo)}`);
}

function verifySqlCipherKey(db) {
  db.prepare('SELECT count(*) FROM sqlite_master').get();
}

module.exports = {
  isSqlCipherEnabled,
  resolveSqlCipherKey,
  applySqlCipherKey,
  assertSqlCipherAvailable,
  verifySqlCipherKey,
  deriveSqlCipherKey,
  isHexKey,
  formatKeyClause,
};
module.exports.default = module.exports;
