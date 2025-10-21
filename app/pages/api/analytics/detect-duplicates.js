import { getDB } from '../db.js';
import { subMonths, differenceInCalendarDays } from 'date-fns';

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

    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : subMonths(end, 3);
    const includeConfirmedBool = includeConfirmed === 'true';
    const minConf = parseFloat(minConfidence);

    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    const endBuffer = new Date(end);
    endBuffer.setMonth(endBuffer.getMonth() + 1);
    const endBufferStr = endBuffer.toISOString().split('T')[0];

    const cards = new Set(['visaCal', 'max', 'isracard', 'amex']);

    const confirmedDuplicatesResult = await client.query(
      `SELECT transaction1_identifier, transaction1_vendor, transaction2_identifier, transaction2_vendor
       FROM transaction_duplicates
       WHERE is_confirmed = true`
    );
    const confirmedSet = new Set(
      confirmedDuplicatesResult.rows.flatMap(row => {
        const key1 = `${row.transaction1_identifier}||${row.transaction1_vendor}`;
        const key2 = `${row.transaction2_identifier}||${row.transaction2_vendor}`;
        return [key1, key2];
      })
    );

    const transactionsResult = await client.query(
      `SELECT
        identifier,
        vendor,
        date,
        price,
        category,
        parent_category,
        account_number,
        name
      FROM transactions
      WHERE date >= $1 AND date <= $2`,
      [startStr, endBufferStr]
    );

    const transactions = transactionsResult.rows.map(row => ({
      identifier: row.identifier,
      vendor: row.vendor,
      date: new Date(row.date),
      dateStr: row.date,
      price: parseFloat(row.price),
      category: row.category,
      parentCategory: row.parent_category,
      accountNumber: row.account_number,
      name: row.name || '',
    }));

    const duplicates = [];

    // ============================================
    // 1. CREDIT CARD PAYMENT DETECTION
    // ============================================
    // Logic: Find bank transactions (category='Bank') that match monthly credit card totals
    // These are the monthly debits from bank account to pay credit card bills

    if (!matchType || matchType === 'credit_card_payment') {
      const cardGroups = new Map();
      const sampleTransactionsMap = new Map();

      transactions
        .filter(txn => txn.price < 0 && txn.date >= start && txn.date <= end && cards.has(txn.vendor) && txn.category !== 'Bank' && txn.category !== 'Income')
        .forEach(txn => {
          const monthKey = txn.date.toISOString().slice(0, 7);
          const key = `${monthKey}|${txn.vendor}|${txn.accountNumber || ''}`;
          if (!cardGroups.has(key)) {
            cardGroups.set(key, {
              vendor: txn.vendor,
              accountNumber: txn.accountNumber,
              month: monthKey,
              total: 0,
              count: 0,
              firstDate: txn.date,
              lastDate: txn.date,
            });
            sampleTransactionsMap.set(key, []);
          }
          const group = cardGroups.get(key);
          group.total += Math.abs(txn.price);
          group.count += 1;
          if (txn.date < group.firstDate) group.firstDate = txn.date;
          if (txn.date > group.lastDate) group.lastDate = txn.date;

          const samples = sampleTransactionsMap.get(key);
          if (samples.length < 5) {
            samples.push({
              identifier: txn.identifier,
              vendor: txn.vendor,
              date: txn.dateStr,
              name: txn.name,
              price: Math.abs(txn.price),
              accountNumber: txn.accountNumber,
            });
          }
        });

      const bankTransactions = transactions.filter(
        txn => txn.price < 0 && txn.category === 'Bank'
      );

      for (const [key, group] of cardGroups.entries()) {
        if (group.total <= 100) continue;
        const amount = group.total;
        const tolerance = Math.max(amount * 0.02, 10);

        const [monthStr] = key.split('|');
        const monthDate = new Date(`${monthStr}-01T00:00:00Z`);
        const nextMonthStart = new Date(monthDate);
        nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);
        const nextMonthEnd = new Date(nextMonthStart);
        nextMonthEnd.setMonth(nextMonthEnd.getMonth() + 1);

        bankTransactions
          .filter(txn => txn.date >= nextMonthStart && txn.date < nextMonthEnd)
          .forEach(bankTxn => {
            const bankAmount = Math.abs(bankTxn.price);
            if (Math.abs(bankAmount - amount) > tolerance) return;

            const key1 = `${bankTxn.identifier}||${bankTxn.vendor}`;
            if (confirmedSet.has(key1)) return;

            const amountDiff = Math.abs(bankAmount - amount);
            const confidence = Math.max(0, 1 - amountDiff / amount);
            if (confidence < minConf) return;

            duplicates.push({
              type: 'credit_card_payment',
              confidence: parseFloat(confidence.toFixed(3)),
              creditCardTransaction: {
                month: group.month,
                vendor: group.vendor,
                accountNumber: group.accountNumber,
                totalAmount: amount,
                transactionCount: group.count,
                dateRange: {
                  start: group.firstDate.toISOString(),
                  end: group.lastDate.toISOString(),
                },
            sampleTransactions: sampleTransactionsMap.get(key).map(sample => ({
              ...sample,
              price: sample.price,
            })),
              },
              bankTransaction: {
                identifier: bankTxn.identifier,
                vendor: bankTxn.vendor,
                date: bankTxn.dateStr,
                name: bankTxn.name,
                price: bankTxn.price,
                accountNumber: bankTxn.accountNumber,
              },
              amountDifference: parseFloat(amountDiff.toFixed(2)),
              description: `Bank debit for ${group.vendor} credit card (${group.month})`,
            });
          });
      }
    }

    // ============================================
    // 2. SIMILAR AMOUNT DUPLICATES
    // ============================================
    // Logic: Find transactions with similar amounts within a date range
    // Useful for rent, loan payments, investments

    if (!matchType || ['rent', 'investment', 'loan', 'transfer'].includes(matchType)) {
      const candidateTransactions = transactions
        .filter(txn => txn.price < 0 && Math.abs(txn.price) > 500 && txn.date >= start && txn.date <= end)
        .sort((a, b) => a.date - b.date);

      for (let i = 0; i < candidateTransactions.length; i++) {
        const txn1 = candidateTransactions[i];
        const amount1 = Math.abs(txn1.price);
        const threshold = Math.max(amount1 * 0.05, 20);

        for (let j = i + 1; j < candidateTransactions.length; j++) {
          const txn2 = candidateTransactions[j];
          const daysApart = Math.abs(differenceInCalendarDays(txn2.date, txn1.date));
          if (daysApart > 7) break;
          if (txn1.identifier === txn2.identifier && txn1.vendor === txn2.vendor) continue;

          const amount2 = Math.abs(txn2.price);
          const amountDiff = Math.abs(amount1 - amount2);
          if (amountDiff >= threshold) continue;

          const key1 = `${txn1.identifier}||${txn1.vendor}`;
          const key2 = `${txn2.identifier}||${txn2.vendor}`;
          if (confirmedSet.has(key1) || confirmedSet.has(key2)) continue;

          const amountSimilarity = 1 - amountDiff / amount1;
          const timeProximity = 1 - daysApart / 7;
          const confidence = amountSimilarity * 0.7 + timeProximity * 0.3;
          if (confidence < minConf) continue;

          let inferredType = 'manual';
          const name1Lower = (txn1.name || '').toLowerCase();
          const name2Lower = (txn2.name || '').toLowerCase();
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

          if (matchType && matchType !== inferredType && matchType !== 'manual') continue;

          duplicates.push({
            type: inferredType,
            confidence: parseFloat(confidence.toFixed(3)),
            transaction1: formatTxn(txn1),
            transaction2: formatTxn(txn2),
            amountDifference: parseFloat(amountDiff.toFixed(2)),
            daysApart,
            description: `Similar amount transactions ${daysApart} days apart`,
          });
        }
      }
    }

    // ============================================
    // 3. GET EXISTING DUPLICATE RECORDS
    // ============================================
    // Include already confirmed duplicates if requested

    if (includeConfirmedBool) {
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
      `, [startStr, endStr]);

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
    duplicates.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

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

function formatTxn(txn) {
  return {
    identifier: txn.identifier,
    vendor: txn.vendor,
    date: txn.dateStr,
    name: txn.name,
    price: parseFloat(txn.price.toFixed(2)),
    category: txn.category || txn.parentCategory,
    accountNumber: txn.accountNumber,
  };
}
