import { getDB } from '../db.js';
import { subMonths } from 'date-fns';

/**
 * Anomaly detection API - identifies unusual spending patterns
 * Detects: unusual amounts, missing recurring transactions, category spikes
 */
export default async function handler(req, res) {
  const client = await getDB();

  try {
    if (req.method === 'GET') {
      // Get detected anomalies
      const { dismissed = 'false', limit = 50 } = req.query;

      const result = await client.query(
        `SELECT
          a.*,
          t.name as transaction_name,
          t.date as transaction_date,
          t.vendor
        FROM spending_anomalies a
        JOIN transactions t ON a.transaction_identifier = t.identifier
          AND a.transaction_vendor = t.vendor
        WHERE a.is_dismissed = $1
        ORDER BY a.detected_at DESC
        LIMIT $2`,
        [dismissed === 'true', parseInt(limit)]
      );

      return res.status(200).json(result.rows);

    } else if (req.method === 'POST') {
      // Run anomaly detection
      const anomalies = await detectAnomalies(client);
      return res.status(200).json({
        message: 'Anomaly detection completed',
        anomaliesDetected: anomalies.length,
        anomalies
      });

    } else if (req.method === 'PUT') {
      // Dismiss an anomaly
      const { anomaly_id, dismissed } = req.body;

      if (!anomaly_id) {
        return res.status(400).json({ error: 'anomaly_id is required' });
      }

      const result = await client.query(
        'UPDATE spending_anomalies SET is_dismissed = $1 WHERE id = $2 RETURNING *',
        [dismissed !== false, anomaly_id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Anomaly not found' });
      }

      return res.status(200).json(result.rows[0]);

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in anomalies API:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  } finally {
    client.release();
  }
}

/**
 * Core anomaly detection logic
 */
async function detectAnomalies(client) {
  const anomalies = [];

  try {
    // Step 1: Calculate spending patterns for each category
    await calculateSpendingPatterns(client);

    // Step 2: Detect unusual amounts (> 2 standard deviations from mean)
    const unusualAmounts = await client.query(
      `WITH category_stats AS (
        SELECT
          parent_category,
          subcategory,
          AVG(ABS(price::numeric)) as avg_amount,
          STDDEV(ABS(price::numeric)) as std_dev
        FROM transactions
        WHERE date >= $1::date
        AND price < 0
        AND parent_category IS NOT NULL
        AND parent_category NOT IN ('Bank', 'Income')
        GROUP BY parent_category, subcategory
        HAVING COUNT(*) >= 5
      )
      SELECT
        t.identifier,
        t.vendor,
        t.name,
        t.parent_category,
        t.subcategory,
        ABS(t.price::numeric) as amount,
        cs.avg_amount as expected_amount,
        cs.std_dev,
        ((ABS(t.price::numeric) - cs.avg_amount) / NULLIF(cs.std_dev, 0)) as z_score
      FROM transactions t
      JOIN category_stats cs ON
        t.parent_category = cs.parent_category
        AND (t.subcategory = cs.subcategory OR (t.subcategory IS NULL AND cs.subcategory IS NULL))
      WHERE t.date >= $1::date
      AND t.price < 0
      AND cs.std_dev > 0
      AND ABS((ABS(t.price::numeric) - cs.avg_amount) / cs.std_dev) > 2
      ORDER BY z_score DESC
      LIMIT 50`,
      [subMonths(new Date(), 1).toISOString().split('T')[0]]
    );

    // Insert unusual amount anomalies
    for (const row of unusualAmounts.rows) {
      const deviation = ((row.amount - row.expected_amount) / row.expected_amount * 100).toFixed(1);

      const severity =
        Math.abs(row.z_score) > 3 ? 'high' :
        Math.abs(row.z_score) > 2.5 ? 'medium' : 'low';

      // Check if anomaly already exists
      const existing = await client.query(
        `SELECT id FROM spending_anomalies
         WHERE transaction_identifier = $1
         AND transaction_vendor = $2
         AND anomaly_type = 'unusual_amount'`,
        [row.identifier, row.vendor]
      );

      if (existing.rowCount === 0) {
        await client.query(
          `INSERT INTO spending_anomalies
           (transaction_identifier, transaction_vendor, anomaly_type,
            category, subcategory, expected_amount, actual_amount,
            deviation_percentage, severity)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            row.identifier,
            row.vendor,
            'unusual_amount',
            row.parent_category,
            row.subcategory,
            parseFloat(row.expected_amount),
            parseFloat(row.amount),
            parseFloat(deviation),
            severity
          ]
        );

        anomalies.push({
          type: 'unusual_amount',
          transaction: row.name,
          category: row.parent_category,
          subcategory: row.subcategory,
          amount: parseFloat(row.amount),
          expected: parseFloat(row.expected_amount),
          deviation: parseFloat(deviation),
          severity
        });
      }
    }

    // Step 3: Detect category spending spikes (month-over-month)
    const categorySpikes = await client.query(
      `WITH monthly_spending AS (
        SELECT
          parent_category,
          DATE_TRUNC('month', date::timestamp) as month,
          SUM(ABS(price::numeric)) as monthly_total
        FROM transactions
        WHERE date >= $1::date
        AND price < 0
        AND parent_category IS NOT NULL
        AND parent_category NOT IN ('Bank', 'Income')
        GROUP BY parent_category, DATE_TRUNC('month', date::timestamp)
      ),
      category_avg AS (
        SELECT
          parent_category,
          AVG(monthly_total) as avg_monthly,
          STDDEV(monthly_total) as std_dev
        FROM monthly_spending
        GROUP BY parent_category
        HAVING COUNT(*) >= 3
      )
      SELECT
        ms.parent_category,
        ms.month,
        ms.monthly_total,
        ca.avg_monthly,
        ((ms.monthly_total - ca.avg_monthly) / ca.avg_monthly * 100) as deviation_pct
      FROM monthly_spending ms
      JOIN category_avg ca ON ms.parent_category = ca.parent_category
      WHERE ms.month >= DATE_TRUNC('month', $2::timestamp)
      AND ms.monthly_total > ca.avg_monthly * 1.3
      ORDER BY deviation_pct DESC`,
      [subMonths(new Date(), 6).toISOString().split('T')[0], subMonths(new Date(), 1).toISOString().split('T')[0]]
    );

    for (const row of categorySpikes.rows) {
      anomalies.push({
        type: 'category_spike',
        category: row.parent_category,
        month: row.month,
        amount: parseFloat(row.monthly_total),
        expected: parseFloat(row.avg_monthly),
        deviation: parseFloat(row.deviation_pct),
        severity: parseFloat(row.deviation_pct) > 50 ? 'high' : 'medium'
      });
    }

    // Step 4: Detect missing recurring transactions
    const missingRecurring = await client.query(
      `SELECT
        merchant_name,
        parent_category,
        subcategory,
        expected_amount,
        next_expected_date,
        CURRENT_DATE - next_expected_date as days_overdue
      FROM recurring_transactions
      WHERE is_active = true
      AND next_expected_date < CURRENT_DATE
      AND next_expected_date >= $1::date`,
      [subMonths(new Date(), 1).toISOString().split('T')[0]]
    );

    for (const row of missingRecurring.rows) {
      anomalies.push({
        type: 'missing_recurring',
        merchant: row.merchant_name,
        category: row.parent_category,
        subcategory: row.subcategory,
        expectedAmount: parseFloat(row.expected_amount),
        daysOverdue: parseInt(row.days_overdue),
        severity: parseInt(row.days_overdue) > 7 ? 'high' : 'medium'
      });
    }

    console.log(`Anomaly detection completed: found ${anomalies.length} anomalies`);
    return anomalies;

  } catch (error) {
    console.error('Error in anomaly detection:', error);
    throw error;
  }
}

/**
 * Calculate and store spending patterns for anomaly detection
 */
async function calculateSpendingPatterns(client) {
  try {
    // Calculate monthly patterns for each category
    await client.query(`
      INSERT INTO spending_patterns
        (category, subcategory, period_type, avg_amount, std_deviation,
         min_amount, max_amount, transaction_count, last_calculated)
      SELECT
        parent_category,
        subcategory,
        'monthly',
        AVG(monthly_total),
        STDDEV(monthly_total),
        MIN(monthly_total),
        MAX(monthly_total),
        SUM(transaction_count),
        CURRENT_TIMESTAMP
      FROM (
        SELECT
          parent_category,
          subcategory,
          DATE_TRUNC('month', date) as month,
          SUM(ABS(price)) as monthly_total,
          COUNT(*) as transaction_count
        FROM transactions
        WHERE date >= $1
        AND price < 0
        AND parent_category IS NOT NULL
        AND parent_category NOT IN ('Bank', 'Income')
        GROUP BY parent_category, subcategory, DATE_TRUNC('month', date)
      ) monthly_data
      GROUP BY parent_category, subcategory
      HAVING COUNT(*) >= 3
      ON CONFLICT (category, subcategory, period_type)
      DO UPDATE SET
        avg_amount = EXCLUDED.avg_amount,
        std_deviation = EXCLUDED.std_deviation,
        min_amount = EXCLUDED.min_amount,
        max_amount = EXCLUDED.max_amount,
        transaction_count = EXCLUDED.transaction_count,
        last_calculated = CURRENT_TIMESTAMP
    `, [subMonths(new Date(), 6)]);

    console.log('Spending patterns calculated successfully');
  } catch (error) {
    console.error('Error calculating spending patterns:', error);
    throw error;
  }
}
