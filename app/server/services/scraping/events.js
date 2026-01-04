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
       COALESCE(fi_cred.id, fi_vendor.id) as institution_id,
       COALESCE(fi_cred.vendor_code, fi_vendor.vendor_code, se.vendor) as institution_vendor_code,
       COALESCE(fi_cred.display_name_he, fi_vendor.display_name_he, se.vendor) as institution_name_he,
       COALESCE(fi_cred.display_name_en, fi_vendor.display_name_en, se.vendor) as institution_name_en,
       COALESCE(fi_cred.logo_url, fi_vendor.logo_url) as institution_logo,
       COALESCE(fi_cred.institution_type, fi_vendor.institution_type) as institution_type
    FROM scrape_events se
    LEFT JOIN vendor_credentials vc ON se.vendor = vc.vendor
    LEFT JOIN institution_nodes fi_cred ON vc.institution_id = fi_cred.id AND fi_cred.node_type = 'institution'
    LEFT JOIN institution_nodes fi_vendor ON se.vendor = fi_vendor.vendor_code AND fi_vendor.node_type = 'institution'
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
      vendor_code: row.institution_vendor_code,
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
       COALESCE(fi_cred.id, fi_vendor.id) as institution_id,
       COALESCE(fi_cred.vendor_code, fi_vendor.vendor_code, se.vendor) as institution_vendor_code,
       COALESCE(fi_cred.display_name_he, fi_vendor.display_name_he, se.vendor) as institution_name_he,
       COALESCE(fi_cred.display_name_en, fi_vendor.display_name_en, se.vendor) as institution_name_en,
       COALESCE(fi_cred.logo_url, fi_vendor.logo_url) as institution_logo,
       COALESCE(fi_cred.institution_type, fi_vendor.institution_type) as institution_type
    FROM scrape_events se
    LEFT JOIN vendor_credentials vc ON se.vendor = vc.vendor
    LEFT JOIN institution_nodes fi_cred ON vc.institution_id = fi_cred.id AND fi_cred.node_type = 'institution'
    LEFT JOIN institution_nodes fi_vendor ON se.vendor = fi_vendor.vendor_code AND fi_vendor.node_type = 'institution'
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
      vendor_code: row.institution_vendor_code,
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
