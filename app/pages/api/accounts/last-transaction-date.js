import { getDB } from '../db.js';

/**
 * Get the last transaction date for a specific vendor
 * GET /api/accounts/last-transaction-date?vendor=vendorName
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { vendor } = req.query;

  if (!vendor) {
    return res.status(400).json({ error: 'Vendor parameter is required' });
  }

  const client = await getDB();

  try {
    // Get the most recent transaction date for this vendor
    const result = await client.query(`
      SELECT MAX(
        CASE
          WHEN transaction_datetime IS NOT NULL THEN transaction_datetime
          ELSE date::timestamp
        END
      ) as last_transaction_date
      FROM transactions
      WHERE vendor = $1`,
      [vendor]
    );

    const lastTransactionDate = result.rows[0]?.last_transaction_date;

    if (!lastTransactionDate) {
      // If no transactions found, default to 30 days ago
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      return res.status(200).json({
        lastTransactionDate: thirtyDaysAgo.toISOString(),
        hasTransactions: false,
        message: 'No previous transactions found, using 30 days ago as default'
      });
    }

    // Return the last transaction date plus one day to avoid duplicates
    const nextDay = new Date(lastTransactionDate);
    nextDay.setDate(nextDay.getDate() + 1);

    res.status(200).json({
      lastTransactionDate: nextDay.toISOString(),
      hasTransactions: true,
      message: `Starting from day after last transaction: ${new Date(lastTransactionDate).toLocaleDateString()}`
    });

  } catch (error) {
    console.error('Error fetching last transaction date:', error);
    res.status(500).json({
      error: 'Failed to fetch last transaction date',
      details: error.message
    });
  } finally {
    client.release();
  }
}