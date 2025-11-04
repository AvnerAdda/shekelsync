const createDbPool = require('../../lib/create-db-pool.js');

let poolInstance;

function getPool() {
  if (!poolInstance) {
    poolInstance = createDbPool();
  }
  return poolInstance;
}

async function getClient() {
  const pool = getPool();
  if (typeof pool.connect === 'function') {
    return pool.connect();
  }

  throw new Error('Database pool does not expose a connect() method');
}

async function query(text, params = []) {
  const pool = getPool();

  if (typeof pool.query === 'function') {
    return pool.query(text, params);
  }

  const client = await getClient();

  try {
    return client.query(text, params);
  } finally {
    if (typeof client.release === 'function') {
      client.release();
    }
  }
}

async function close() {
  if (!poolInstance) return;

  // Close SQLite database connection
  if (typeof poolInstance.close === 'function') {
    poolInstance.close();
  }

  poolInstance = null;
}

module.exports = {
  getPool,
  getClient,
  query,
  close,
};
module.exports.default = module.exports;
