const database = require('./database.js');

async function ping() {
  try {
    await database.query('SELECT 1');
    return {
      ok: true,
      status: 'ok',
    };
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

module.exports = {
  ping,
};
module.exports.default = module.exports;
