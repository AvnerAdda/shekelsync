const database = require('../database.js');

async function listScrapeEvents({ limit = 100 } = {}) {
  const cappedLimit = Math.min(parseInt(limit, 10) || 100, 500);
  const result = await database.query(
    `SELECT
       se.id,
       se.triggered_by,
       se.vendor,
       se.start_date,
       se.status,
       se.message,
       se.created_at,
       fi.id as institution_id,
       fi.display_name_he as institution_name_he,
       fi.display_name_en as institution_name_en,
       fi.logo_url as institution_logo,
       fi.institution_type as institution_type
     FROM scrape_events se
     LEFT JOIN vendor_credentials vc ON se.vendor = vc.vendor
     LEFT JOIN financial_institutions fi ON vc.institution_id = fi.id
     ORDER BY se.created_at DESC
     LIMIT $1`,
    [cappedLimit],
  );

  return result.rows.map(row => ({
    id: row.id,
    triggered_by: row.triggered_by,
    vendor: row.vendor,
    start_date: row.start_date,
    status: row.status,
    message: row.message,
    created_at: row.created_at,
    institution: row.institution_id ? {
      id: row.institution_id,
      display_name_he: row.institution_name_he,
      display_name_en: row.institution_name_en,
      logo_url: row.institution_logo,
      institution_type: row.institution_type,
    } : null,
  }));
}

async function getScrapeEvent(id) {
  const result = await database.query(
    `SELECT
       se.id,
       se.triggered_by,
       se.vendor,
       se.start_date,
       se.status,
       se.message,
       se.created_at,
       fi.id as institution_id,
       fi.display_name_he as institution_name_he,
       fi.display_name_en as institution_name_en,
       fi.logo_url as institution_logo,
       fi.institution_type as institution_type
     FROM scrape_events se
     LEFT JOIN vendor_credentials vc ON se.vendor = vc.vendor
     LEFT JOIN financial_institutions fi ON vc.institution_id = fi.id
     WHERE se.id = $1`,
    [id],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    triggered_by: row.triggered_by,
    vendor: row.vendor,
    start_date: row.start_date,
    status: row.status,
    message: row.message,
    created_at: row.created_at,
    institution: row.institution_id ? {
      id: row.institution_id,
      display_name_he: row.institution_name_he,
      display_name_en: row.institution_name_en,
      logo_url: row.institution_logo,
      institution_type: row.institution_type,
    } : null,
  };
}

module.exports = {
  listScrapeEvents,
  getScrapeEvent,
};

module.exports.default = module.exports;
