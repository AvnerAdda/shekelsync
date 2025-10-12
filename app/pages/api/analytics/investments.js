import { getDB } from '../db.js';

/**
 * Get investment analytics
 * GET /api/analytics/investments
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { startDate, endDate } = req.query;

    let dateFilter = '';
    const params = [];

    if (startDate && endDate) {
      dateFilter = 'AND t.date >= $1 AND t.date <= $2';
      params.push(startDate, endDate);
    }

    // Get all investment and savings transactions
    const transactionsQuery = `
      SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.name,
        t.price,
        t.category as original_category,
        t.account_number,
        me.override_category,
        me.exclusion_reason,
        me.notes,
        me.created_at as excluded_at
      FROM transactions t
      JOIN manual_exclusions me ON
        me.transaction_identifier = t.identifier AND
        me.transaction_vendor = t.vendor
      WHERE me.override_category IN ('Investment', 'Savings')
      ${dateFilter}
      ORDER BY t.date DESC
    `;

    const transactionsResult = await client.query(transactionsQuery, params);
    const transactions = transactionsResult.rows;

    // Calculate summary statistics
    const summary = {
      totalInvested: 0,
      totalSavings: 0,
      totalCount: transactions.length,
      investmentCount: 0,
      savingsCount: 0,
    };

    // Breakdown by type
    const byType = {
      Investment: { total: 0, count: 0 },
      Savings: { total: 0, count: 0 },
    };

    // Breakdown by platform/name pattern
    const byPlatform = {};

    transactions.forEach(txn => {
      const amount = Math.abs(txn.price);
      const type = txn.override_category;

      // Update summary
      if (type === 'Investment') {
        summary.totalInvested += amount;
        summary.investmentCount++;
      } else if (type === 'Savings') {
        summary.totalSavings += amount;
        summary.savingsCount++;
      }

      // Update by type
      if (byType[type]) {
        byType[type].total += amount;
        byType[type].count++;
      }

      // Determine platform from transaction name
      let platform = 'Other';
      const name = txn.name.toLowerCase();

      if (name.includes('interactive') || name.includes('brokers')) {
        platform = 'Interactive Brokers';
      } else if (name.includes('bits of gold')) {
        platform = 'Bits of Gold';
      } else if (name.includes('פיקדון')) {
        platform = 'פיקדון';
      } else if (name.includes('קופת גמל')) {
        platform = 'קופת גמל';
      } else if (name.includes('חיסכון')) {
        platform = 'חיסכון';
      }

      if (!byPlatform[platform]) {
        byPlatform[platform] = { total: 0, count: 0, type };
      }
      byPlatform[platform].total += amount;
      byPlatform[platform].count++;
    });

    // Timeline data (monthly aggregation)
    const timelineQuery = `
      SELECT
        DATE_TRUNC('month', t.date) as month,
        me.override_category as type,
        SUM(ABS(t.price)) as total,
        COUNT(*) as count
      FROM transactions t
      JOIN manual_exclusions me ON
        me.transaction_identifier = t.identifier AND
        me.transaction_vendor = t.vendor
      WHERE me.override_category IN ('Investment', 'Savings')
      ${dateFilter}
      GROUP BY DATE_TRUNC('month', t.date), me.override_category
      ORDER BY month DESC
    `;

    const timelineResult = await client.query(timelineQuery, params);
    const timeline = timelineResult.rows.map(row => ({
      month: row.month,
      type: row.type,
      total: parseFloat(row.total),
      count: parseInt(row.count),
    }));

    // Format platform data for response
    const platformsArray = Object.entries(byPlatform).map(([name, data]) => ({
      platform: name,
      total: data.total,
      count: data.count,
      type: data.type,
    })).sort((a, b) => b.total - a.total);

    res.status(200).json({
      summary,
      byType: Object.entries(byType).map(([type, data]) => ({
        type,
        total: data.total,
        count: data.count,
      })),
      byPlatform: platformsArray,
      timeline,
      transactions: transactions.map(txn => ({
        ...txn,
        price: parseFloat(txn.price),
      })),
    });

  } catch (error) {
    console.error('Error fetching investment analytics:', error);
    res.status(500).json({
      error: 'Failed to fetch investment analytics',
      details: error.message
    });
  } finally {
    client.release();
  }
}
