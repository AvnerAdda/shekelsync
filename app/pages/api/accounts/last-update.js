import { getDB } from '../db';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const client = await getDB();
  try {
    // Get all accounts with their last successful scrape date
    const result = await client.query(`
      SELECT
        vc.id,
        vc.vendor,
        vc.nickname,
        COALESCE(last_scrapes.last_successful_scrape, vc.created_at) as last_update,
        last_scrapes.status as last_scrape_status
      FROM vendor_credentials vc
      LEFT JOIN (
        SELECT
          se.vendor,
          MAX(CASE WHEN se.status = 'success' THEN se.created_at ELSE NULL END) as last_successful_scrape,
          (
            SELECT se2.status
            FROM scrape_events se2
            WHERE se2.vendor = se.vendor
            ORDER BY se2.created_at DESC
            LIMIT 1
          ) as status
        FROM scrape_events se
        GROUP BY se.vendor
      ) last_scrapes ON vc.vendor = last_scrapes.vendor
      ORDER BY vc.nickname ASC
    `);

    const accountsWithLastUpdate = result.rows.map(row => ({
      id: row.id,
      vendor: row.vendor,
      nickname: row.nickname,
      lastUpdate: row.last_update,
      lastScrapeStatus: row.last_scrape_status || 'never'
    }));

    res.status(200).json(accountsWithLastUpdate);
  } catch (error) {
    console.error('Error fetching account last updates:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
}
