const path = require('path');
const { requireFromApp } = require('./paths');

let probeDb = null;
let probeDbPath = null;

function resolveDatabaseCtor(databaseCtor) {
  if (databaseCtor) {
    return databaseCtor;
  }
  const module = requireFromApp('better-sqlite3');
  return typeof module.default === 'function' ? module.default : module;
}

function getProbeDatabase(dbPath, databaseCtor = null) {
  const normalizedPath = path.resolve(dbPath);
  if (probeDb && probeDbPath === normalizedPath) {
    return probeDb;
  }

  closeSqliteProbe();
  const Database = resolveDatabaseCtor(databaseCtor);
  probeDb = new Database(normalizedPath, { readonly: true, fileMustExist: true });
  probeDb.pragma('query_only = ON');
  probeDbPath = normalizedPath;
  return probeDb;
}

function closeSqliteProbe() {
  if (!probeDb) {
    return;
  }

  try {
    probeDb.close();
  } catch {
    // Best-effort cleanup.
  }

  probeDb = null;
  probeDbPath = null;
}

module.exports = {
  getProbeDatabase,
  closeSqliteProbe,
};
