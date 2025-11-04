const database = require('../database.js');

async function getScrapeStatusById(id) {
  if (!id) {
    const error = new Error('Scrape event ID is required');
    error.status = 400;
    throw error;
  }

  const result = await database.query(
    `SELECT id, triggered_by, vendor, start_date, status, message, created_at
     FROM scrape_events
     WHERE id = $1`,
    [id],
  );

  if (result.rows.length === 0) {
    const error = new Error('Scrape event not found');
    error.status = 404;
    throw error;
  }

  return result.rows[0];
}

module.exports = {
  getScrapeStatusById,
};
