const fs = require('fs');
const path = require('path');
const { requireFromApp } = require('./paths');
const { validateCredentialRows } = require('./credential-key-validator');

const REQUIRED_TABLES = ['transactions', 'vendor_credentials'];
const ACCEPTED_CREDENTIAL_STATUSES = new Set(['match', 'empty']);

function resolveDatabaseCtor(databaseCtor) {
  if (databaseCtor) return databaseCtor;
  const module = requireFromApp('better-sqlite3');
  return typeof module.default === 'function' ? module.default : module;
}

/**
 * Check that a file is an intact ShekelSync database whose stored credentials
 * decrypt with the current master key. Restoring a file that fails this check
 * would either corrupt the store or lock the app out at the next boot.
 */
function validateRestoreSource(sourcePath, { masterKey, databaseCtor } = {}) {
  let database;
  try {
    const Database = resolveDatabaseCtor(databaseCtor);
    database = new Database(sourcePath, { readonly: true, fileMustExist: true });
    database.pragma('query_only = ON');

    const integrity = database.pragma('quick_check', { simple: true });
    if (integrity !== 'ok') {
      return { ok: false, error: 'The selected file is damaged (SQLite integrity check failed).' };
    }

    const tables = new Set(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missing.length > 0) {
      return { ok: false, error: 'The selected file is not a ShekelSync database.' };
    }

    const rows = database
      .prepare('SELECT username, password, id_number, identification_code FROM vendor_credentials')
      .all();
    const credentials = validateCredentialRows(rows, masterKey);
    if (!ACCEPTED_CREDENTIAL_STATUSES.has(credentials.status)) {
      return {
        ok: false,
        error:
          'The saved bank credentials in this backup were encrypted with a different key and cannot be ' +
          'decrypted on this installation. Restoring it would lock the app, so it was not restored.',
        credentialStatus: credentials.status,
      };
    }

    return { ok: true, credentialStatus: credentials.status };
  } catch (error) {
    return { ok: false, error: `The selected file could not be opened as a database: ${error.message}` };
  } finally {
    try {
      database?.close();
    } catch {
      // Read-only validation cleanup is best-effort.
    }
  }
}

function buildPreRestoreBackupPath(targetPath, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(path.dirname(targetPath), 'backups', `pre-restore-${stamp}.sqlite`);
}

/**
 * Restore `sourcePath` over `targetPath` without ever leaving a half-written database:
 * the source is copied next to the target, flushed, and then renamed into place.
 */
async function replaceDatabaseFile(sourcePath, targetPath, { closeDatabase, reopenDatabase }) {
  const stagingPath = `${targetPath}.restore-${process.pid}-${Date.now()}`;
  await fs.promises.copyFile(sourcePath, stagingPath);
  try {
    const handle = await fs.promises.open(stagingPath, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }

    await closeDatabase();
    await fs.promises.rename(stagingPath, targetPath);
    await fs.promises.rm(`${targetPath}-wal`, { force: true });
    await fs.promises.rm(`${targetPath}-shm`, { force: true });
  } catch (error) {
    await fs.promises.rm(stagingPath, { force: true });
    throw error;
  } finally {
    await reopenDatabase();
  }
}

module.exports = {
  buildPreRestoreBackupPath,
  replaceDatabaseFile,
  validateRestoreSource,
};
