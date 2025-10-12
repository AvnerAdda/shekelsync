import { getDB } from '../db.js';

/**
 * Detect potential duplicate transactions
 *
 * This API detects several types of duplicate transactions:
 * 1. Credit Card Payment Duplicates: Bank debits that match monthly credit card totals
 * 2. Similar Amount Duplicates: Transactions with similar amounts in close date ranges
 * 3. Transfer Duplicates: Money moving between accounts
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const {
      startDate,
      endDate,
      includeConfirmed = 'false',
      minConfidence = '0.7',
      matchType
    } = req.query;

    const start = startDate ? new Date(startDate) : new Date(new Date().setMonth(new Date().getMonth() - 3));
    const end = endDate ? new Date(endDate) : new Date();
    const minConf = parseFloat(minConfidence);

    const duplicates = [];

    // ============================================
    // 1. CREDIT CARD PAYMENT DETECTION
    // ============================================
    // Logic: Find bank transactions (category='Bank') that match monthly credit card totals
    // These are the monthly debits from bank account to pay credit card bills

    if (!matchType || matchType === 'credit_card_payment') {
      // Get monthly credit card totals per account_number
      const ccMonthlyTotalsResult = await client.query(`
        SELECT
          TO_CHAR(date, 'YYYY-MM') as month,
          vendor,
          account_number,
          SUM(ABS(price)) as total_spent,
          COUNT(*) as transaction_count,
          MIN(date) as first_transaction_date,
          MAX(date) as last_transaction_date
        FROM transactions
        WHERE price < 0
        AND category != 'Bank'
        AND category != 'Income'
        AND date >= $1 AND date <= $2
        AND vendor IN ('visaCal', 'max', 'isracard', 'amex')
        GROUP BY TO_CHAR(date, 'YYYY-MM'), vendor, account_number
        HAVING SUM(ABS(price)) > 100
        ORDER BY month DESC, vendor, account_number
      `, [start, end]);

      // For each monthly credit card total, look for matching bank transactions in the following month
      for (const ccTotal of ccMonthlyTotalsResult.rows) {
        const monthDate = new Date(ccTotal.month + '-01');
        const nextMonthStart = new Date(monthDate);
        nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);
        const nextMonthEnd = new Date(nextMonthStart);
        nextMonthEnd.setMonth(nextMonthEnd.getMonth() + 1);

        const amount = parseFloat(ccTotal.total_spent);
        const tolerance = Math.max(amount * 0.02, 10); // 2% tolerance or ₪10, whichever is larger

        // Look for bank transactions matching this amount
        const matchingBankTxns = await client.query(`
          SELECT
            identifier,
            vendor,
            date,
            name,
            price,
            account_number
          FROM transactions
          WHERE price < 0
          AND category = 'Bank'
          AND date >= $1 AND date < $2
          AND ABS(price) BETWEEN $3 AND $4
          AND NOT EXISTS (
            SELECT 1 FROM transaction_duplicates
            WHERE (
              (transaction1_identifier = identifier AND transaction1_vendor = vendor) OR
              (transaction2_identifier = identifier AND transaction2_vendor = vendor)
            )
            AND is_confirmed = true
          )
        `, [nextMonthStart, nextMonthEnd, amount - tolerance, amount + tolerance]);

        // Check if any credit card transactions from this total are already marked as duplicates
        const ccTransactions = await client.query(`
          SELECT identifier, vendor, date, name, price, account_number
          FROM transactions
          WHERE TO_CHAR(date, 'YYYY-MM') = $1
          AND vendor = $2
          AND account_number = $3
          AND price < 0
          AND category != 'Bank'
          ORDER BY date ASC
          LIMIT 5
        `, [ccTotal.month, ccTotal.vendor, ccTotal.account_number]);

        for (const bankTxn of matchingBankTxns.rows) {
          const amountDiff = Math.abs(Math.abs(bankTxn.price) - amount);
          const confidence = Math.max(0, 1 - (amountDiff / amount));

          if (confidence >= minConf) {
            duplicates.push({
              type: 'credit_card_payment',
              confidence: parseFloat(confidence.toFixed(3)),
              creditCardTransaction: {
                month: ccTotal.month,
                vendor: ccTotal.vendor,
                accountNumber: ccTotal.account_number,
                totalAmount: amount,
                transactionCount: parseInt(ccTotal.transaction_count),
                dateRange: {
                  start: ccTotal.first_transaction_date,
                  end: ccTotal.last_transaction_date
                },
                sampleTransactions: ccTransactions.rows.map(tx => ({
                  identifier: tx.identifier,
                  vendor: tx.vendor,
                  date: tx.date,
                  name: tx.name,
                  price: parseFloat(tx.price),
                  accountNumber: tx.account_number
                }))
              },
              bankTransaction: {
                identifier: bankTxn.identifier,
                vendor: bankTxn.vendor,
                date: bankTxn.date,
                name: bankTxn.name,
                price: parseFloat(bankTxn.price),
                accountNumber: bankTxn.account_number
              },
              amountDifference: parseFloat(amountDiff.toFixed(2)),
              description: `Bank debit for ${ccTotal.vendor} credit card (${ccTotal.month})`
            });
          }
        }
      }
    }

    // ============================================
    // 2. SIMILAR AMOUNT DUPLICATES
    // ============================================
    // Logic: Find transactions with similar amounts within a date range
    // Useful for rent, loan payments, investments

    if (!matchType || ['rent', 'investment', 'loan', 'transfer'].includes(matchType)) {
      const similarAmountResult = await client.query(`
        SELECT
          t1.identifier as id1,
          t1.vendor as vendor1,
          t1.date as date1,
          t1.name as name1,
          t1.price as price1,
          t1.category as cat1,
          t1.account_number as acc1,
          t2.identifier as id2,
          t2.vendor as vendor2,
          t2.date as date2,
          t2.name as name2,
          t2.price as price2,
          t2.category as cat2,
          t2.account_number as acc2,
          ABS(t1.price - t2.price) as price_diff,
          ABS(EXTRACT(EPOCH FROM (t1.date - t2.date)) / 86400) as days_apart
        FROM transactions t1
        INNER JOIN transactions t2 ON (
          t1.identifier != t2.identifier
          AND ABS(t1.price - t2.price) < GREATEST(ABS(t1.price) * 0.05, 20)
          AND ABS(EXTRACT(EPOCH FROM (t1.date - t2.date)) / 86400) <= 7
          AND t1.price < 0 AND t2.price < 0
          AND ABS(t1.price) > 500
        )
        WHERE t1.date >= $1 AND t1.date <= $2
        AND t2.date >= $1 AND t2.date <= $2
        AND NOT EXISTS (
          SELECT 1 FROM transaction_duplicates
          WHERE (
            (transaction1_identifier = t1.identifier AND transaction1_vendor = t1.vendor) OR
            (transaction2_identifier = t1.identifier AND transaction2_vendor = t1.vendor)
          )
          AND is_confirmed = true
        )
        ORDER BY t1.date DESC, price_diff ASC
        LIMIT 50
      `, [start, end]);

      for (const match of similarAmountResult.rows) {
        const amountDiff = parseFloat(match.price_diff);
        const amount = Math.abs(parseFloat(match.price1));
        const daysApart = parseFloat(match.days_apart);

        // Calculate confidence based on amount similarity and time proximity
        const amountSimilarity = 1 - (amountDiff / amount);
        const timeProximity = 1 - (daysApart / 7);
        const confidence = (amountSimilarity * 0.7 + timeProximity * 0.3);

        if (confidence >= minConf) {
          // Infer match type based on category and transaction names
          let inferredType = 'manual';
          const name1Lower = match.name1.toLowerCase();
          const name2Lower = match.name2.toLowerCase();

          if (name1Lower.includes('שכירות') || name1Lower.includes('דיור') ||
              name2Lower.includes('שכירות') || name2Lower.includes('דיור')) {
            inferredType = 'rent';
          } else if (name1Lower.includes('השקעה') || name2Lower.includes('השקעה')) {
            inferredType = 'investment';
          } else if (name1Lower.includes('הלוואה') || name2Lower.includes('הלוואה')) {
            inferredType = 'loan';
          } else if (name1Lower.includes('העברה') || name2Lower.includes('העברה')) {
            inferredType = 'transfer';
          }

          if (!matchType || matchType === inferredType) {
            duplicates.push({
              type: inferredType,
              confidence: parseFloat(confidence.toFixed(3)),
              transaction1: {
                identifier: match.id1,
                vendor: match.vendor1,
                date: match.date1,
                name: match.name1,
                price: parseFloat(match.price1),
                category: match.cat1,
                accountNumber: match.acc1
              },
              transaction2: {
                identifier: match.id2,
                vendor: match.vendor2,
                date: match.date2,
                name: match.name2,
                price: parseFloat(match.price2),
                category: match.cat2,
                accountNumber: match.acc2
              },
              amountDifference: parseFloat(amountDiff.toFixed(2)),
              daysApart: parseFloat(daysApart.toFixed(1)),
              description: `Similar amount transactions ${daysApart.toFixed(0)} days apart`
            });
          }
        }
      }
    }

    // ============================================
    // 3. GET EXISTING DUPLICATE RECORDS
    // ============================================
    // Include already confirmed duplicates if requested

    if (includeConfirmed === 'true') {
      const existingDuplicatesResult = await client.query(`
        SELECT
          td.id,
          td.match_type,
          td.confidence,
          td.is_confirmed,
          td.exclude_from_totals,
          td.notes,
          td.created_at,
          t1.identifier as t1_id,
          t1.vendor as t1_vendor,
          t1.date as t1_date,
          t1.name as t1_name,
          t1.price as t1_price,
          t1.category as t1_category,
          t1.account_number as t1_account,
          t2.identifier as t2_id,
          t2.vendor as t2_vendor,
          t2.date as t2_date,
          t2.name as t2_name,
          t2.price as t2_price,
          t2.category as t2_category,
          t2.account_number as t2_account
        FROM transaction_duplicates td
        INNER JOIN transactions t1 ON (
          td.transaction1_identifier = t1.identifier
          AND td.transaction1_vendor = t1.vendor
        )
        INNER JOIN transactions t2 ON (
          td.transaction2_identifier = t2.identifier
          AND td.transaction2_vendor = t2.vendor
        )
        WHERE t1.date >= $1 AND t1.date <= $2
        ORDER BY td.created_at DESC
      `, [start, end]);

      for (const dup of existingDuplicatesResult.rows) {
        duplicates.push({
          id: dup.id,
          type: dup.match_type,
          confidence: parseFloat(dup.confidence),
          isConfirmed: dup.is_confirmed,
          excludeFromTotals: dup.exclude_from_totals,
          notes: dup.notes,
          createdAt: dup.created_at,
          transaction1: {
            identifier: dup.t1_id,
            vendor: dup.t1_vendor,
            date: dup.t1_date,
            name: dup.t1_name,
            price: parseFloat(dup.t1_price),
            category: dup.t1_category,
            accountNumber: dup.t1_account
          },
          transaction2: {
            identifier: dup.t2_id,
            vendor: dup.t2_vendor,
            date: dup.t2_date,
            name: dup.t2_name,
            price: parseFloat(dup.t2_price),
            category: dup.t2_category,
            accountNumber: dup.t2_account
          }
        });
      }
    }

    // Sort by confidence (highest first)
    duplicates.sort((a, b) => b.confidence - a.confidence);

    res.status(200).json({
      dateRange: { start, end },
      totalDetected: duplicates.length,
      duplicates
    });

  } catch (error) {
    console.error('Error detecting duplicates:', error);
    res.status(500).json({
      error: 'Failed to detect duplicates',
      details: error.message
    });
  } finally {
    client.release();
  }
}
