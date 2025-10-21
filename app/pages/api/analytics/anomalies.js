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
    const now = new Date();
    const sixMonthsAgo = subMonths(now, 6);
    const oneMonthAgo = subMonths(now, 1);
    const sixMonthsAgoStr = sixMonthsAgo.toISOString().split('T')[0];

    // Load transactions for analysis
    const transactionsResult = await client.query(
      `SELECT
        identifier,
        vendor,
        name,
        date,
        parent_category,
        subcategory,
        ABS(price) as amount
      FROM transactions
      WHERE date >= $1
        AND price < 0
        AND parent_category IS NOT NULL
        AND parent_category NOT IN ('Bank', 'Income')`,
      [sixMonthsAgoStr]
    );

    const transactions = transactionsResult.rows.map(row => ({
      identifier: row.identifier,
      vendor: row.vendor,
      name: row.name,
      date: new Date(row.date),
      parent_category: row.parent_category,
      subcategory: row.subcategory,
      amount: parseFloat(row.amount),
    }));

    // Step 1: Calculate spending patterns for each category
    await calculateSpendingPatterns(client, transactions);

    // Step 2: Detect unusual amounts (> 2 standard deviations from mean)
    const statsByCategory = computeTransactionStats(transactions);
    const existingAnomaliesResult = await client.query(
      `SELECT transaction_identifier, transaction_vendor
       FROM spending_anomalies
       WHERE anomaly_type = 'unusual_amount'`
    );
    const existingAnomalies = new Set(
      existingAnomaliesResult.rows.map(
        row => `${row.transaction_identifier}||${row.transaction_vendor}`
      )
    );

    for (const txn of transactions) {
      if (txn.date < oneMonthAgo) continue;
      const key = `${txn.parent_category}||${txn.subcategory || ''}`;
      const stats = statsByCategory.get(key);
      if (!stats || stats.count < 5 || stats.stdDev === 0) {
        continue;
      }

      const zScore = (txn.amount - stats.mean) / stats.stdDev;
      if (Math.abs(zScore) <= 2) {
        continue;
      }

      const deviation = ((txn.amount - stats.mean) / stats.mean) * 100;
      const severity =
        Math.abs(zScore) > 3 ? 'high' :
        Math.abs(zScore) > 2.5 ? 'medium' : 'low';

      const anomalyKey = `${txn.identifier}||${txn.vendor}`;
      if (!existingAnomalies.has(anomalyKey)) {
        await client.query(
          `INSERT INTO spending_anomalies
           (transaction_identifier, transaction_vendor, anomaly_type,
            category, subcategory, expected_amount, actual_amount,
            deviation_percentage, severity)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            txn.identifier,
            txn.vendor,
            'unusual_amount',
            txn.parent_category,
            txn.subcategory,
            stats.mean,
            txn.amount,
            deviation,
            severity,
          ]
        );
        existingAnomalies.add(anomalyKey);
      }

      anomalies.push({
        type: 'unusual_amount',
        transaction: txn.name,
        category: txn.parent_category,
        subcategory: txn.subcategory,
        amount: txn.amount,
        expected: stats.mean,
        deviation,
        severity,
      });
    }

    // Step 3: Detect category spending spikes (month-over-month)
    const categorySpikes = calculateCategorySpikes(transactions, oneMonthAgo);
    anomalies.push(...categorySpikes);

    // Step 4: Detect missing recurring transactions
    const recurringResult = await client.query(
      `SELECT
        merchant_name,
        parent_category,
        subcategory,
        expected_amount,
        next_expected_date
      FROM recurring_transactions
      WHERE is_active = true`
    );

    const missingRecurring = recurringResult.rows
      .map(row => ({
        merchant_name: row.merchant_name,
        parent_category: row.parent_category,
        subcategory: row.subcategory,
        expected_amount: parseFloat(row.expected_amount),
        next_expected_date: row.next_expected_date ? new Date(row.next_expected_date) : null,
      }))
      .filter(row => row.next_expected_date)
      .map(row => ({
        ...row,
        daysOverdue: diffInDays(now, row.next_expected_date),
      }))
      .filter(row => row.daysOverdue > 0 && row.next_expected_date >= oneMonthAgo);

    missingRecurring.forEach(row => {
      anomalies.push({
        type: 'missing_recurring',
        merchant: row.merchant_name,
        category: row.parent_category,
        subcategory: row.subcategory,
        expectedAmount: row.expected_amount,
        daysOverdue: row.daysOverdue,
        severity: row.daysOverdue > 7 ? 'high' : 'medium',
      });
    });

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
async function calculateSpendingPatterns(client, transactions) {
  const patterns = new Map();

  transactions.forEach(txn => {
    const key = `${txn.parent_category}||${txn.subcategory || ''}`;
    if (!patterns.has(key)) {
      patterns.set(key, {
        category: txn.parent_category,
        subcategory: txn.subcategory,
        monthTotals: new Map(),
        transactionCount: 0,
      });
    }
    const pattern = patterns.get(key);
    const monthKey = txn.date.toISOString().slice(0, 7);
    pattern.monthTotals.set(
      monthKey,
      (pattern.monthTotals.get(monthKey) || 0) + txn.amount
    );
    pattern.transactionCount += 1;
  });

  for (const pattern of patterns.values()) {
    const monthValues = Array.from(pattern.monthTotals.values());
    if (monthValues.length < 3) continue;

    const avgAmount = average(monthValues);
    const stdDeviation = standardDeviation(monthValues);
    const minAmount = Math.min(...monthValues);
    const maxAmount = Math.max(...monthValues);

    await client.query(
      `INSERT INTO spending_patterns
        (category, subcategory, period_type, avg_amount, std_deviation,
         min_amount, max_amount, transaction_count, last_calculated)
       VALUES ($1, $2, 'monthly', $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       ON CONFLICT (category, subcategory, period_type)
       DO UPDATE SET
         avg_amount = EXCLUDED.avg_amount,
         std_deviation = EXCLUDED.std_deviation,
         min_amount = EXCLUDED.min_amount,
         max_amount = EXCLUDED.max_amount,
         transaction_count = EXCLUDED.transaction_count,
         last_calculated = CURRENT_TIMESTAMP`,
      [
        pattern.category,
        pattern.subcategory,
        avgAmount,
        stdDeviation,
        minAmount,
        maxAmount,
        pattern.transactionCount,
      ]
    );
  }
}

function computeTransactionStats(transactions) {
  const stats = new Map();

  transactions.forEach(txn => {
    const key = `${txn.parent_category}||${txn.subcategory || ''}`;
    if (!stats.has(key)) {
      stats.set(key, { sum: 0, sumSquares: 0, count: 0 });
    }
    const entry = stats.get(key);
    entry.sum += txn.amount;
    entry.sumSquares += txn.amount * txn.amount;
    entry.count += 1;
  });

  const result = new Map();
  stats.forEach((entry, key) => {
    if (entry.count === 0) return;
    const mean = entry.sum / entry.count;
    const variance =
      entry.count > 1 ? entry.sumSquares / entry.count - mean * mean : 0;
    const stdDev = variance > 0 ? Math.sqrt(variance) : 0;
    result.set(key, { mean, stdDev, count: entry.count });
  });

  return result;
}

function calculateCategorySpikes(transactions, oneMonthAgo) {
  const parentMap = new Map();

  transactions.forEach(txn => {
    const monthKey = txn.date.toISOString().slice(0, 7);
    if (!parentMap.has(txn.parent_category)) {
      parentMap.set(txn.parent_category, new Map());
    }
    const monthTotals = parentMap.get(txn.parent_category);
    monthTotals.set(monthKey, (monthTotals.get(monthKey) || 0) + txn.amount);
  });

  const anomalies = [];
  const startMonth = new Date(Date.UTC(oneMonthAgo.getUTCFullYear(), oneMonthAgo.getUTCMonth(), 1));

  parentMap.forEach((monthTotals, parentCategory) => {
    const values = Array.from(monthTotals.values());
    if (values.length < 3) return;

    const avgMonthly = average(values);
    if (avgMonthly === 0) return;

    monthTotals.forEach((total, monthKey) => {
      const monthDate = new Date(`${monthKey}-01T00:00:00Z`);
      if (monthDate < startMonth) return;

      const deviationPct = ((total - avgMonthly) / avgMonthly) * 100;
      if (deviationPct <= 30) return;

      anomalies.push({
        type: 'category_spike',
        category: parentCategory,
        month: monthDate.toISOString(),
        amount: total,
        expected: avgMonthly,
        deviation: deviationPct,
        severity: deviationPct > 50 ? 'high' : 'medium',
      });
    });
  });

  return anomalies;
}

function diffInDays(later, earlier) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((later.getTime() - earlier.getTime()) / msPerDay);
}

function average(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function standardDeviation(values) {
  if (!values || values.length === 0) return 0;
  const mean = average(values);
  const variance =
    values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}
