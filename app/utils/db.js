const createDbPool = require('../lib/create-db-pool');

const testPool = globalThis.__TEST_DB_POOL__;
const pool = testPool || createDbPool();

module.exports = pool;

if (process.env.VITEST) {
  module.exports.__setTestPool = (mockPool) => {
    globalThis.__TEST_DB_POOL__ = mockPool;
  };
}
