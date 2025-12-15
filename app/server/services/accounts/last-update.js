const database = require('../database.js');

async function listAccountLastUpdates() {
  const result = await database.query(
    `
      SELECT
        vc.id,
        vc.vendor,
        vc.nickname,
        -- Use GREATEST to get the most recent of scrape_events or vendor_credentials
        COALESCE(
          (
            SELECT MAX(
              CASE 
                WHEN se.status = 'success' THEN se.created_at
                ELSE NULL
              END
            )
            FROM scrape_events se
            WHERE (se.credential_id = vc.id OR (se.credential_id IS NULL AND se.vendor = vc.vendor))
          ),
          vc.last_scrape_success,
          vc.created_at
        ) AS last_update,
        -- Get the most recent scrape status
        COALESCE(
          vc.last_scrape_status,
          (
            SELECT se.status
            FROM scrape_events se
            WHERE se.credential_id = vc.id OR (se.credential_id IS NULL AND se.vendor = vc.vendor)
            ORDER BY se.created_at DESC
            LIMIT 1
          ),
          'never'
        ) AS last_scrape_status,
        account_numbers.account_numbers,
        COALESCE(fi.id, fi_vendor.id) as institution_id,
        COALESCE(fi.vendor_code, fi_vendor.vendor_code, vc.vendor) as institution_vendor_code,
        COALESCE(fi.display_name_he, fi_vendor.display_name_he, vc.vendor) as institution_name_he,
        COALESCE(fi.display_name_en, fi_vendor.display_name_en, vc.vendor) as institution_name_en,
        COALESCE(fi.logo_url, fi_vendor.logo_url) as institution_logo,
        COALESCE(fi.institution_type, fi_vendor.institution_type) as institution_type
      FROM vendor_credentials vc
      LEFT JOIN financial_institutions fi ON vc.institution_id = fi.id
      LEFT JOIN financial_institutions fi_vendor ON vc.vendor = fi_vendor.vendor_code
      LEFT JOIN (
        SELECT
          t.vendor,
          t.vendor_nickname,
          GROUP_CONCAT(DISTINCT t.account_number) AS account_numbers
        FROM transactions t
        WHERE t.account_number IS NOT NULL
        GROUP BY t.vendor, t.vendor_nickname
      ) account_numbers ON vc.vendor = account_numbers.vendor AND vc.nickname = account_numbers.vendor_nickname
      ORDER BY vc.nickname ASC
    `,
  );

  return result.rows.map((row) => ({
    id: row.id,
    vendor: row.vendor,
    nickname: row.nickname,
    lastUpdate: row.last_update,
    lastScrapeStatus: row.last_scrape_status || 'never',
    accountNumbers: row.account_numbers ? row.account_numbers.split(',') : [],
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

module.exports = {
  listAccountLastUpdates,
};

module.exports.default = module.exports;
