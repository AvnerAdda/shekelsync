const database = require('../database.js');

async function listScrapeEvents({ limit = 100 } = {}) {
  const cappedLimit = Math.min(parseInt(limit, 10) || 100, 500);
  const result = await database.query(
    `SELECT id, triggered_by, vendor, start_date, status, message, created_at
     FROM scrape_events
     ORDER BY created_at DESC
     LIMIT $1`,
    [cappedLimit],
  );

  return result.rows;
}

async function getScrapeEvent(id) {
  const result = await database.query(
    `SELECT id, triggered_by, vendor, start_date, status, message, created_at
     FROM scrape_events
     WHERE id = $1`,
    [id],
  );

  return result.rows[0] || null;
}

module.exports = {
  listScrapeEvents,
  getScrapeEvent,
};

module.exports.default = module.exports;
