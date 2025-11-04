/**
 * Database pool creation for SQLite
 * This app uses SQLite exclusively for Electron desktop deployment
 */

function createDbPool() {
  // Load SQLite pool adapter
  // eslint-disable-next-line global-require
  const createSqlitePool = require('./sqlite-pool.js');
  return createSqlitePool();
}

module.exports = createDbPool;
module.exports.default = createDbPool;
