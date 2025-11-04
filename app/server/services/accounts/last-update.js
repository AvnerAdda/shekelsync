const database = require('../database.js');

async function listAccountLastUpdates() {
  const result = await database.query(
    `
      SELECT
        vc.id,
        vc.vendor,
        vc.nickname,
        COALESCE(last_scrapes.last_successful_scrape, vc.created_at) AS last_update,
        last_scrapes.status AS last_scrape_status
      FROM vendor_credentials vc
      LEFT JOIN (
        SELECT
          se.vendor,
          MAX(CASE WHEN se.status = 'success' THEN se.created_at ELSE NULL END) AS last_successful_scrape,
          (
            SELECT se2.status
            FROM scrape_events se2
            WHERE se2.vendor = se.vendor
            ORDER BY se2.created_at DESC
            LIMIT 1
          ) AS status
        FROM scrape_events se
        GROUP BY se.vendor
      ) last_scrapes ON vc.vendor = last_scrapes.vendor
      ORDER BY vc.nickname ASC
    `,
  );

  return result.rows.map((row) => ({
    id: row.id,
    vendor: row.vendor,
    nickname: row.nickname,
    lastUpdate: row.last_update,
    lastScrapeStatus: row.last_scrape_status || 'never',
  }));
}

module.exports = {
  listAccountLastUpdates,
};

module.exports.default = module.exports;
