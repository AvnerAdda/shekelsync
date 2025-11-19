const createDbPool = require('../lib/create-db-pool');

const pool = createDbPool();

module.exports = pool;
