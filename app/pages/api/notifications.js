import { getDB } from './db.js';
import { STALE_SYNC_THRESHOLD_MS } from '../../utils/constants.js';

/**
 * Notifications API
 * GET /api/notifications
 * 
 * Returns smart notifications including stale sync alerts
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { limit = 20 } = req.query;
    const notifications = [];

    // Calculate the threshold timestamp (48 hours ago)
    const thresholdDate = new Date(Date.now() - STALE_SYNC_THRESHOLD_MS);

    // Check for stale accounts
    const staleAccountsQuery = `
      SELECT 
        vc.vendor,
        vc.nickname,
        COALESCE(last_scrapes.last_successful_scrape, vc.created_at) as last_update
      FROM vendor_credentials vc
      LEFT JOIN (
        SELECT 
          vendor,
          MAX(CASE WHEN status = 'success' THEN created_at ELSE NULL END) as last_successful_scrape
        FROM scrape_events
        GROUP BY vendor
      ) last_scrapes ON vc.vendor = last_scrapes.vendor
      WHERE COALESCE(last_scrapes.last_successful_scrape, vc.created_at) < $1
      ORDER BY last_update ASC
    `;

    const staleAccountsResult = await client.query(staleAccountsQuery, [thresholdDate]);
    const staleAccounts = staleAccountsResult.rows;

    if (staleAccounts.length > 0) {
      const oldestUpdate = new Date(staleAccounts[0].last_update);
      const daysSinceOldest = Math.floor((Date.now() - oldestUpdate.getTime()) / (24 * 60 * 60 * 1000));

      notifications.push({
        id: 'stale-sync-alert',
        type: 'stale_sync',
        severity: daysSinceOldest >= 7 ? 'critical' : 'warning',
        title: 'Accounts Need Sync',
        message: `${staleAccounts.length} account${staleAccounts.length > 1 ? 's' : ''} haven't synced in ${daysSinceOldest} day${daysSinceOldest > 1 ? 's' : ''}`,
        data: {
          staleCount: staleAccounts.length,
          oldestUpdateDays: daysSinceOldest,
          accounts: staleAccounts.map(a => ({
            vendor: a.vendor,
            nickname: a.nickname,
            lastUpdate: a.last_update
          }))
        },
        timestamp: new Date().toISOString(),
        actionable: true,
        actions: [
          {
            label: 'Sync All Now',
            action: 'bulk_refresh'
          }
        ]
      });
    }

    // Calculate summary
    const summary = {
      total: notifications.length,
      by_type: notifications.reduce((acc, n) => {
        acc[n.type] = (acc[n.type] || 0) + 1;
        return acc;
      }, {}),
      by_severity: notifications.reduce((acc, n) => {
        acc[n.severity] = (acc[n.severity] || 0) + 1;
        return acc;
      }, {})
    };

    // Ensure severity counts are always present
    summary.by_severity = {
      info: summary.by_severity.info || 0,
      warning: summary.by_severity.warning || 0,
      critical: summary.by_severity.critical || 0
    };

    return res.status(200).json({
      success: true,
      data: {
        notifications: notifications.slice(0, limit),
        summary
      }
    });

  } catch (error) {
    console.error('[Notifications API] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  } finally {
    client.release();
  }
}

