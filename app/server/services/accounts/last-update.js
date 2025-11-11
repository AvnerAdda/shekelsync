const database = require('../database.js');

async function listAccountLastUpdates() {
  const result = await database.query(
    `
      SELECT
        vc.id,
        vc.vendor,
        vc.nickname,
        COALESCE(last_scrapes.last_successful_scrape, vc.created_at) AS last_update,
        last_scrapes.status AS last_scrape_status,
        account_numbers.account_numbers,
        fi.id as institution_id,
        fi.display_name_he as institution_name_he,
        fi.display_name_en as institution_name_en,
        fi.logo_url as institution_logo,
        fi.institution_type as institution_type
      FROM vendor_credentials vc
      LEFT JOIN financial_institutions fi ON vc.institution_id = fi.id
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
