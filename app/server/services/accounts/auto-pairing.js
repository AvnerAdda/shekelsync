const database = require('../database.js');
const pairingsService = require('./pairings.js');
const { getCreditCardRepaymentCategoryCondition, getCreditCardRepaymentCategoryId } = require('./repayment-category.js');

// Credit card vendor keywords (Hebrew and English)
const VENDOR_KEYWORDS = {
  max: ['מקס', 'max'],
  visaCal: ['כ.א.ל', 'cal', 'ויזה כאל', 'visa cal'],
  isracard: ['ישראכרט', 'isracard'],
  amex: ['אמקס', 'אמריקן אקספרס', 'amex', 'american express'],
  leumi: ['לאומי כרט', 'leumi card'],
  diners: ['דיינרס', 'diners'],
};

async function getCCFeesCategoryId(client) {
  try {
    const result = await client.query(`
      SELECT id FROM category_definitions
      WHERE name_en = 'Bank & Card Fees'
         OR name = 'עמלות בנק וכרטיס'
      LIMIT 1
    `);
    return result.rows?.[0]?.id ?? null;
  } catch (_error) {
    return null;
  }
}

/**
 * Extract the last 4 digits from a CC account number
 */
function getAccountLast4(accountNumber) {
  if (!accountNumber || typeof accountNumber !== 'string') return null;
  const trimmed = accountNumber.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > 4 ? trimmed.slice(-4) : trimmed;
}

/**
 * Extract all 4-digit sequences from a string
 */
function extractDigitSequences(text) {
  if (!text) return [];
  const matches = text.match(/\d{4,}/g) || [];
  // For longer sequences, also extract the last 4 digits
  const result = new Set();
  matches.forEach(m => {
    result.add(m);
    if (m.length > 4) {
      result.add(m.slice(-4));
    }
  });
  return Array.from(result);
}

/**
 * Check if a transaction name contains any vendor keywords for the given CC vendor
 */
function nameContainsVendor(name, ccVendor) {
  if (!name || !ccVendor) return false;
  const nameLower = name.toLowerCase();
  const keywords = VENDOR_KEYWORDS[ccVendor] || [];
  return keywords.some(kw => nameLower.includes(kw.toLowerCase()));
}

function detectCCVendorFromName(name) {
  if (!name) return null;
  const nameLower = name.toLowerCase();
  for (const [vendor, keywords] of Object.entries(VENDOR_KEYWORDS)) {
    for (const kw of keywords) {
      if (nameLower.includes(String(kw).toLowerCase())) {
        return vendor;
      }
    }
  }
  return null;
}

/**
 * Build match patterns for the pairing from CC info
 */
function buildMatchPatterns(ccVendor, ccAccountNumber) {
  const patterns = [];

  const vendorKeywords = VENDOR_KEYWORDS[ccVendor] || [];
  patterns.push(...vendorKeywords);

  if (ccAccountNumber) {
    patterns.push(ccAccountNumber);
    const last4 = getAccountLast4(ccAccountNumber);
    if (last4 && last4 !== ccAccountNumber) {
      patterns.push(last4);
    }
  }

  return [...new Set(patterns.filter(p => p && p.length > 0))];
}

/**
 * SIMPLIFIED: Find the best matching bank account for a credit card
 *
 * Logic:
 * 1. Get the CC's last-4 digits
 * 2. Find all bank repayment transactions (by category)
 * 3. Check if repayment names contain the CC's last-4 or vendor keywords
 * 4. Group by bank vendor/account and pick the best match
 */
async function findBestBankAccount(params) {
  const {
    creditCardVendor,
    creditCardAccountNumber = null,
  } = params;

  if (!creditCardVendor) {
    const error = new Error('creditCardVendor is required');
    error.status = 400;
    throw error;
  }

  const client = await getDatabase().getClient();

  try {
    const ccLast4 = getAccountLast4(creditCardAccountNumber);

    // Exclude CC vendors from bank search
    const ccVendors = Object.keys(VENDOR_KEYWORDS);
    const ccVendorPlaceholders = ccVendors.map((_, i) => `$${i + 1}`).join(', ');

    const repaymentCategoryCondition = getCreditCardRepaymentCategoryCondition('cd');

    // Find all bank repayment transactions (by category only)
    const query = `
      SELECT
        t.identifier,
        t.vendor,
        t.account_number,
        t.name,
        t.price,
        t.date
      FROM transactions t
      LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
      WHERE t.vendor NOT IN (${ccVendorPlaceholders})
        AND t.price < 0
        AND ${repaymentCategoryCondition}
      ORDER BY t.date DESC
      LIMIT 500
    `;

    const result = await client.query(query, ccVendors);

    if (result.rows.length === 0) {
      return { found: false, reason: 'No bank repayment transactions found' 
};
    }

    // Group repayments by bank vendor + account
    const bankAccountGroups = {
};

    result.rows.forEach(row => {
      const key = `${row.vendor}|${row.account_number || 'null'}`;
      if (!bankAccountGroups[key]) {
        bankAccountGroups[key] = {
          bankVendor: row.vendor,
          bankAccountNumber: row.account_number,
          transactions: [],
          matchingLast4Count: 0,
          matchingVendorCount: 0,
        
};
      }

      const group = bankAccountGroups[key];
      group.transactions.push(row);

      // Check if this repayment matches our CC
      const nameContainsCC = ccLast4 && row.name && row.name.includes(ccLast4);
      const nameHasVendor = nameContainsVendor(row.name, creditCardVendor);

      if (nameContainsCC) {
        group.matchingLast4Count++;
      }
      if (nameHasVendor) {
        group.matchingVendorCount++;
      }
    });

    // Find best match
    const candidates = Object.values(bankAccountGroups)
      .filter(g => g.matchingLast4Count > 0 || g.matchingVendorCount > 0)
      .sort((a, b) => {
        if (a.matchingLast4Count !== b.matchingLast4Count) {
          return b.matchingLast4Count - a.matchingLast4Count;
        }
        if (a.matchingVendorCount !== b.matchingVendorCount) {
          return b.matchingVendorCount - a.matchingVendorCount;
        }
        return b.transactions.length - a.transactions.length;
      });

    if (candidates.length === 0) {
      return {
        found: false,
        reason: `No bank repayments reference this credit card (last4: ${ccLast4 || 'unknown'})`,
      
};
    }

    const bestMatch = candidates[0];
    const matchPatterns = buildMatchPatterns(creditCardVendor, creditCardAccountNumber);

    return {
      found: true,
      bankVendor: bestMatch.bankVendor,
      bankAccountNumber: bestMatch.bankAccountNumber,
      transactionCount: bestMatch.transactions.length,
      matchingLast4Count: bestMatch.matchingLast4Count,
      matchingVendorCount: bestMatch.matchingVendorCount,
      matchPatterns,
      sampleTransactions: bestMatch.transactions
        .filter(t => {
          const hasLast4 = ccLast4 && t.name && t.name.includes(ccLast4);
          const hasVendor = nameContainsVendor(t.name, creditCardVendor);
          return hasLast4 || hasVendor;
        })
        .slice(0, 3)
        .map(t => ({
          name: t.name,
          price: t.price,
          date: t.date,
        })),
      otherCandidates: candidates.slice(1, 3).map(c => ({
        bankVendor: c.bankVendor,
        bankAccountNumber: c.bankAccountNumber,
        transactionCount: c.transactions.length,
      })),
    
};
  } finally {
    client.release();
  }
}

/**
 * IMPROVED: Calculate discrepancy between bank repayments and CC expenses
 *
 * NEW LOGIC:
 * 1. Get all bank repayment transactions (by date)
 * 2. For each repayment date, query CC transactions with that processed_date
 * 3. Match by: processed_date == repayment_date AND amount matches AND account_number hint
 * 4. Report matches and unmatched cycles
 */
async function calculateDiscrepancy(params) {
  const {
    pairingId = null,
    bankVendor,
    bankAccountNumber = null,
    ccVendor,
    ccAccountNumber = null,
    monthsBack = 3,
  } = params;

  if (!bankVendor || !ccVendor) {
    return null;
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const EPSILON = 1.0; // Allow 1 ILS tolerance for rounding
  const MAX_FEE_AMOUNT = 200;

  const client = await getDatabase().getClient();

  try {
    // Check if discrepancy was already acknowledged
    let acknowledged = false;
    if (pairingId) {
      try {
        const ackRow = (await client.query(
          'SELECT discrepancy_acknowledged FROM account_pairings WHERE id = $1',
          [pairingId],
        )).rows?.[0];
        acknowledged = Boolean(ackRow?.discrepancy_acknowledged);
      } catch (error) {
        console.warn('[auto-pairing] Failed to read discrepancy_acknowledged', error);
      }
    }

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsBack);
    const startDateStr = startDate.toISOString().split('T')[0];

    const repaymentCategoryCondition = getCreditCardRepaymentCategoryCondition('cd');
    const ccFeesCategoryId = await getCCFeesCategoryId(client);
    let earliestCcCycleDate = null;
    try {
      const earliestParams = [ccVendor];
      let earliestAccountFilter = '';
      if (ccAccountNumber) {
        earliestParams.push(ccAccountNumber);
        earliestAccountFilter = `AND t.account_number = $${earliestParams.length}`;
      }

      let earliestFeesFilter = '';
      if (ccFeesCategoryId) {
        earliestParams.push(ccFeesCategoryId);
        earliestFeesFilter = `AND (t.category_definition_id IS NULL OR t.category_definition_id <> $${earliestParams.length})`;
      }

      const earliestRow = (await client.query(
        `
          SELECT MIN(substr(COALESCE(t.processed_date, t.date), 1, 10)) AS min_date
          FROM transactions t
          WHERE t.vendor = $1
            AND t.status = 'completed'
            AND t.price < 0
            ${earliestAccountFilter}
            ${earliestFeesFilter}
        `,
        earliestParams,
      )).rows?.[0];
      earliestCcCycleDate = earliestRow?.min_date || null;
    } catch (_error) {
      earliestCcCycleDate = null;
    }

    // Get CC's last-4 and vendor keywords for filtering repayments
    const ccLast4 = getAccountLast4(ccAccountNumber);
    const ccKeywords = VENDOR_KEYWORDS[ccVendor] || [];

    /**
     * Check if a bank repayment matches this specific credit card
     * by looking for the CC's last-4 digits or vendor keywords in the name
     */
    function repaymentMatchesCC(name) {
      if (!name) return false;
      const nameLower = name.toLowerCase();

      // Check for last-4 digits
      if (ccLast4 && name.includes(ccLast4)) {
        return true;
      }

      // Check for vendor keywords
      for (const kw of ccKeywords) {
        if (nameLower.includes(kw.toLowerCase())) {
          return true;
        }
      }

      return false;
    }

    // Step 1: Get all bank repayment transactions
    const bankParams = [bankVendor, startDateStr, todayStr];
    let bankAccountFilter = '';
    if (bankAccountNumber) {
      bankParams.push(bankAccountNumber);
      bankAccountFilter = `AND t.account_number = $${bankParams.length}`;
    }

    const bankRepaymentsQuery = `
      SELECT
        t.identifier,
        t.vendor,
        t.account_number,
        t.date,
        substr(t.date, 1, 10) as repayment_date,
        t.name,
        t.price
      FROM transactions t
      LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
      WHERE t.vendor = $1
        AND substr(t.date, 1, 10) >= $2
        AND substr(t.date, 1, 10) <= $3
        AND t.status = 'completed'
        AND t.price < 0
        AND ${repaymentCategoryCondition}
        ${bankAccountFilter}
      ORDER BY t.date DESC
      LIMIT 500
    `;

    const repaymentRows = (await client.query(bankRepaymentsQuery, bankParams)).rows || [];

    // Step 2: Filter repayments for THIS CC. If multiple CCs of the same vendor share
    // the same bank account, allocate ambiguous repayments (e.g. "מקס ...") across accounts
    // so we don't duplicate a repayment under multiple cards.
    let method = 'direct';
    let matchingRepayments = repaymentRows.filter(row => repaymentMatchesCC(row.name));

    if (bankAccountNumber && ccAccountNumber) {
      try {
        const rows = (await client.query(
          `
            SELECT credit_card_account_number
            FROM account_pairings
            WHERE is_active = 1
              AND bank_vendor = $1
              AND bank_account_number = $2
              AND credit_card_vendor = $3
              AND credit_card_account_number IS NOT NULL
          `,
          [bankVendor, bankAccountNumber, ccVendor],
        )).rows || [];

        const groupAccounts = Array.from(new Set(
          rows
            .map(r => r.credit_card_account_number)
            .filter(Boolean)
            .concat([ccAccountNumber]),
        ));

        if (groupAccounts.length >= 2) {
          const accountPlaceholders = groupAccounts.map((_, i) => `$${i + 5}`).join(', ');
          const ccTotalsParams = [ccVendor, startDateStr, todayStr, ccFeesCategoryId || -1, ...groupAccounts];

          const ccTotalsQuery = `
            SELECT
              t.account_number,
              substr(COALESCE(t.processed_date, t.date), 1, 10) AS cycle_date,
              COALESCE(SUM(
                CASE
                  WHEN t.category_definition_id = $4
                    AND t.price < 0
                    AND lower(COALESCE(t.name, '')) LIKE '%דמי כרטיס%'
                    AND (
                      lower(COALESCE(t.name, '')) LIKE '%פטור%'
                      OR lower(COALESCE(t.name, '')) LIKE '%הנחה%'
                    )
                    THEN t.price
                  ELSE -t.price
                END
              ), 0) AS total
            FROM transactions t
            WHERE t.vendor = $1
              AND t.status = 'completed'
              AND substr(COALESCE(t.processed_date, t.date), 1, 10) >= $2
              AND substr(COALESCE(t.processed_date, t.date), 1, 10) <= $3
              AND t.account_number IN (${accountPlaceholders})
            GROUP BY t.account_number, substr(COALESCE(t.processed_date, t.date), 1, 10)
          `;

          const ccTotalsRows = (await client.query(ccTotalsQuery, ccTotalsParams)).rows || [];
          const ccTotalsByAccount = new Map();
          for (const row of ccTotalsRows) {
            const acct = row.account_number;
            const dateKey = row.cycle_date;
            const total = Math.max(0, Number.parseFloat(row.total) || 0);
            if (!acct || !dateKey) continue;
            if (!ccTotalsByAccount.has(acct)) {
              ccTotalsByAccount.set(acct, new Map());
            }
            ccTotalsByAccount.get(acct).set(dateKey, total);
          }

          // Allocate repayments per date across the groupAccounts.
          const repaymentRowsByDate = new Map();
          for (const row of repaymentRows) {
            const dateKey = row.repayment_date;
            if (!dateKey) continue;
            if (!repaymentRowsByDate.has(dateKey)) {
              repaymentRowsByDate.set(dateKey, []);
            }
            repaymentRowsByDate.get(dateKey).push(row);
          }

          const allocatedForThisAccount = [];
          for (const [dateKey, dayRows] of repaymentRowsByDate) {
            const assignedTotal = Object.fromEntries(groupAccounts.map(a => [a, 0]));
            const assignedRows = Object.fromEntries(groupAccounts.map(a => [a, []]));

            const sorted = [...dayRows].sort((a, b) => Math.abs(Number.parseFloat(b.price) || 0) - Math.abs(Number.parseFloat(a.price) || 0));
            for (const row of sorted) {
              const amount = Math.abs(Number.parseFloat(row.price) || 0);
              if (amount <= 0) continue;

              const name = row.name || '';
              const hints = extractDigitSequences(name);

              const digitCandidates = groupAccounts.filter(acct => {
                const last4 = getAccountLast4(acct);
                return hints.includes(acct) || (last4 && hints.includes(last4));
              });

              let candidates = groupAccounts;
              let hasSignal = true;
              if (digitCandidates.length > 0) {
                candidates = digitCandidates;
              } else if (nameContainsVendor(name, ccVendor)) {
                candidates = groupAccounts;
              } else {
                candidates = groupAccounts;
                hasSignal = false;
              }

              if (!hasSignal) {
                const detectedVendor = detectCCVendorFromName(name);
                if (detectedVendor && detectedVendor !== ccVendor) {
                  continue;
                }
              }

              let bestAccount = null;
              let bestNewDiff = null;
              for (const acct of candidates) {
                const ccTotal = ccTotalsByAccount.get(acct)?.get(dateKey);
                if (ccTotal === undefined) continue;
                const newDiff = Math.abs((assignedTotal[acct] + amount) - ccTotal);
                if (bestNewDiff === null || newDiff < bestNewDiff) {
                  bestNewDiff = newDiff;
                  bestAccount = acct;
                }
              }

              if (bestAccount === null) {
                if (!hasSignal) {
                  continue;
                }
                bestAccount = candidates[0];
              } else if (!hasSignal && bestNewDiff !== null && bestNewDiff > EPSILON) {
                continue;
              }

              assignedTotal[bestAccount] += amount;
              assignedRows[bestAccount].push(row);
            }

            allocatedForThisAccount.push(...(assignedRows[ccAccountNumber] || []));
          }

          matchingRepayments = allocatedForThisAccount;
          method = 'allocated';
        }
      } catch (_error) {
        // Fall back to direct matching.
      }
    }

    if (matchingRepayments.length === 0) {
      return {
        exists: false,
        acknowledged,
        reason: `No bank repayments found matching this credit card (${ccVendor} ${ccLast4 || ''})`,
        periodMonths: monthsBack,
        method,
        cycles: [],
      };
    }

    // Step 3: Group matching repayments by date
    const repaymentsByDate = new Map();
    for (const row of matchingRepayments) {
      const dateKey = row.repayment_date;
      if (!repaymentsByDate.has(dateKey)) {
        repaymentsByDate.set(dateKey, {
          repaymentDate: dateKey,
          repayments: [],
          bankTotal: 0,
        });
      }
      const bucket = repaymentsByDate.get(dateKey);
      bucket.repayments.push({
        identifier: row.identifier,
        vendor: row.vendor,
        accountNumber: row.account_number,
        date: row.date,
        cycleDate: dateKey,
        name: row.name,
        price: Number.parseFloat(row.price),
      });
      bucket.bankTotal += Math.abs(Number.parseFloat(row.price));
    }

    // Step 3: For each repayment date, query CC transactions with that processed_date
    const cycles = [];

    for (const [dateKey, repaymentBucket] of repaymentsByDate) {
      // Query CC transactions for this specific processed_date
      const ccParams = [ccVendor, dateKey, ccFeesCategoryId || -1];
      let ccAccountFilter = '';
      if (ccAccountNumber) {
        ccParams.push(ccAccountNumber);
        ccAccountFilter = `AND t.account_number = $${ccParams.length}`;
      }

      // Use substr for consistent date comparison (handles both ISO strings and date-only)
      const ccQuery = `
        SELECT
          t.account_number,
          COALESCE(SUM(
            CASE
              WHEN t.category_definition_id = $3
                AND t.price < 0
                AND lower(COALESCE(t.name, '')) LIKE '%דמי כרטיס%'
                AND (
                  lower(COALESCE(t.name, '')) LIKE '%פטור%'
                  OR lower(COALESCE(t.name, '')) LIKE '%הנחה%'
                )
                THEN t.price
              ELSE -t.price
            END
          ), 0) AS total,
          COUNT(*) as txn_count
        FROM transactions t
        WHERE t.vendor = $1
          AND t.status = 'completed'
          AND substr(COALESCE(t.processed_date, t.date), 1, 10) = $2
          ${ccAccountFilter}
        GROUP BY t.account_number
      `;

      const ccRows = (await client.query(ccQuery, ccParams)).rows || [];

      // Find the best matching CC account for this repayment
      let ccTotal = null;
      let matchedAccount = null;
      let status = 'missing_cc_cycle';

      if (ccRows.length > 0) {
        // Extract account number hints from repayment names
        const accountHints = new Set();
        repaymentBucket.repayments.forEach(r => {
          const hints = extractDigitSequences(r.name);
          hints.forEach(h => accountHints.add(h));
        });

        // Try to find exact or near match
        for (const ccRow of ccRows) {
          const rowTotal = Math.max(0, Number.parseFloat(ccRow.total) || 0);
          const diff = Math.abs(repaymentBucket.bankTotal - rowTotal);

          // Check if this CC account matches based on amount
          if (diff <= EPSILON) {
            // Exact match (within tolerance)
            ccTotal = rowTotal;
            matchedAccount = ccRow.account_number;
            status = 'matched';
            break;
          } else if (diff <= MAX_FEE_AMOUNT && diff > EPSILON) {
            // Could be a fee candidate - bank paid more than CC total
            if (repaymentBucket.bankTotal > rowTotal) {
              ccTotal = rowTotal;
              matchedAccount = ccRow.account_number;
              status = 'fee_candidate';
            }
          }
        }

        // If no exact match, check if CC account matches by account number hint
        if (status === 'missing_cc_cycle' && ccAccountNumber) {
          const ccRow = ccRows.find(r => r.account_number === ccAccountNumber);
          if (ccRow) {
            const rowTotal = Math.max(0, Number.parseFloat(ccRow.total) || 0);
            const diff = repaymentBucket.bankTotal - rowTotal;
            ccTotal = rowTotal;
            matchedAccount = ccRow.account_number;

            if (Math.abs(diff) <= EPSILON) {
              status = 'matched';
            } else if (diff > 0 && diff <= MAX_FEE_AMOUNT) {
              status = 'fee_candidate';
            } else if (diff > MAX_FEE_AMOUNT) {
              status = 'large_discrepancy';
            } else {
              status = 'cc_over_bank';
            }
          }
        }
      }

      const difference = ccTotal === null ? null : (repaymentBucket.bankTotal - ccTotal);

      cycles.push({
        cycleDate: dateKey,
        bankTotal: Math.round(repaymentBucket.bankTotal * 100) / 100,
        ccTotal: ccTotal === null ? null : (Math.round(ccTotal * 100) / 100),
        difference: difference === null ? null : (Math.round(difference * 100) / 100),
        repayments: repaymentBucket.repayments,
        status,
        matchedAccount,
      });
    }

    // Sort cycles by date descending
    cycles.sort((a, b) => (a.cycleDate < b.cycleDate ? 1 : -1));

    const actionableStatuses = new Set(['fee_candidate', 'large_discrepancy', 'cc_over_bank', 'missing_cc_cycle']);
    const EARLY_GRACE_DAYS = 14;
    const RECENT_GRACE_DAYS = 14;
    const todayDate = new Date(`${todayStr}T00:00:00Z`);
    const earliestDate = earliestCcCycleDate ? new Date(`${earliestCcCycleDate}T00:00:00Z`) : null;

    for (const cycle of cycles) {
      if (!actionableStatuses.has(cycle.status)) {
        continue;
      }
      const cycleDate = new Date(`${cycle.cycleDate}T00:00:00Z`);
      if (Number.isNaN(cycleDate.getTime())) {
        continue;
      }

      if (earliestDate) {
        const daysFromEarliest = Math.floor((cycleDate.getTime() - earliestDate.getTime()) / (24 * 60 * 60 * 1000));
        if (daysFromEarliest <= EARLY_GRACE_DAYS) {
          cycle.status = 'incomplete_history';
          continue;
        }
      }

      const daysAgo = Math.floor((todayDate.getTime() - cycleDate.getTime()) / (24 * 60 * 60 * 1000));
      if (daysAgo >= 0 && daysAgo <= RECENT_GRACE_DAYS) {
        cycle.status = 'incomplete_history';
      }
    }

    // Calculate overall stats
    const comparableCycles = cycles.filter(c => c.ccTotal !== null && c.status !== 'incomplete_history');
    const totalBankMatched = comparableCycles.reduce((sum, c) => sum + c.bankTotal, 0);
    const totalCCMatched = comparableCycles.reduce((sum, c) => sum + (c.ccTotal || 0), 0);
    const totalDifference = totalBankMatched - totalCCMatched;

    const hasDiscrepancy = cycles.some(c => actionableStatuses.has(c.status));

	    return {
	      exists: hasDiscrepancy && !acknowledged,
	      acknowledged,
	      totalBankRepayments: Math.round(totalBankMatched * 100) / 100,
	      totalCCExpenses: Math.round(totalCCMatched * 100) / 100,
	      difference: Math.round(totalDifference * 100) / 100,
	      differencePercentage: totalCCMatched > 0
	        ? Math.round((totalDifference / totalCCMatched) * 10000) / 100
	        : 0,
	      periodMonths: monthsBack,
	      method,
	      matchedCycleCount: cycles.filter(c => c.status === 'matched').length,
	      totalCycles: cycles.length,
	      cycles,
	    };
  } finally {
    client.release();
  }
}

async function applyPairingToTransactions({
  pairingId,
  bankVendor,
  bankAccountNumber = null,
  matchPatterns = [],
}) {
  if (!bankVendor || !Array.isArray(matchPatterns) || matchPatterns.length === 0) {
    return { transactionsUpdated: 0 };
  }

  const client = await getDatabase().getClient();

  try {
    // Lookup the Credit Card Repayment category ID dynamically
    const creditCardRepaymentCategoryId = await getCreditCardRepaymentCategoryId(client);

    if (!creditCardRepaymentCategoryId) {
      console.warn('Credit Card Repayment category not found - skipping pairing categorization');
      return { transactionsUpdated: 0 };
    }

    const params = [bankVendor];
    const conditions = matchPatterns.map((pattern, idx) => {
      params.push(String(pattern).toLowerCase());
      return `LOWER(name) LIKE '%' || $${idx + 2} || '%'`;
    });

    // Add the category ID as a parameter
    params.push(creditCardRepaymentCategoryId);
    const categoryIdParamIndex = params.length;

    let query = `
      UPDATE transactions
         SET category_definition_id = $${categoryIdParamIndex}
       WHERE vendor = $1
         AND (${conditions.join(' OR ')})
    `;

    if (bankAccountNumber) {
      params.push(bankAccountNumber);
      query += ` AND account_number = $${params.length}`;
    }

    const updateResult = await client.query(query, params);
    const updated = updateResult?.rowCount || 0;

    if (updated > 0 && pairingId) {
      await client.query(
        `INSERT INTO account_pairing_log (pairing_id, action, transaction_count)
         VALUES ($1, $2, $3)`,
        [pairingId, 'applied', updated],
      );
    }

    return { transactionsUpdated: updated };
  } finally {
    client.release();
  }
}

/**
 * Auto-pair a credit card to its bank account
 */
async function autoPairCreditCard(params) {
  const {
    creditCardVendor,
    creditCardAccountNumber = null,
    applyTransactions = false,
  } = params;

  if (!creditCardVendor) {
    const error = new Error('creditCardVendor is required');
    error.status = 400;
    throw error;
  }

  // Step 1: Find best matching bank account
  const bankAccountResult = await findBestBankAccount({
    creditCardVendor,
    creditCardAccountNumber,
  });

  if (!bankAccountResult.found) {
    return {
      success: false,
      reason: bankAccountResult.reason,
    };
  }

  // Step 2: Check if pairing already exists
  const existingPairings = await pairingsService.listPairings({ include_inactive: true });
  const existingPairing = existingPairings.find(p =>
    p.creditCardVendor === creditCardVendor &&
    p.creditCardAccountNumber === creditCardAccountNumber &&
    p.bankVendor === bankAccountResult.bankVendor &&
    p.bankAccountNumber === bankAccountResult.bankAccountNumber
  );

  let pairingId;
  let wasCreated = false;
  let appliedTransactions = null;

  if (existingPairing) {
    pairingId = existingPairing.id;
    if (!existingPairing.isActive) {
      await pairingsService.updatePairing({
        id: pairingId,
        isActive: true,
        matchPatterns: bankAccountResult.matchPatterns,
      });
    }
  } else {
    const createResult = await pairingsService.createPairing({
      creditCardVendor,
      creditCardAccountNumber,
      bankVendor: bankAccountResult.bankVendor,
      bankAccountNumber: bankAccountResult.bankAccountNumber,
      matchPatterns: bankAccountResult.matchPatterns,
    });
    pairingId = createResult.pairingId;
    wasCreated = true;
  }

  if (applyTransactions) {
    try {
      appliedTransactions = await applyPairingToTransactions({
        pairingId,
        bankVendor: bankAccountResult.bankVendor,
        bankAccountNumber: bankAccountResult.bankAccountNumber,
        matchPatterns: bankAccountResult.matchPatterns,
      });
    } catch (error) {
      console.warn('[auto-pairing] Failed to apply pairing to existing transactions', error);
    }
  }

  // Step 4: Calculate discrepancy
  const discrepancy = await calculateDiscrepancy({
    bankVendor: bankAccountResult.bankVendor,
    bankAccountNumber: bankAccountResult.bankAccountNumber,
    ccVendor: creditCardVendor,
    ccAccountNumber: creditCardAccountNumber,
  });

  return {
    success: true,
    wasCreated,
    pairing: {
      id: pairingId,
      creditCardVendor,
      creditCardAccountNumber,
      bankVendor: bankAccountResult.bankVendor,
      bankAccountNumber: bankAccountResult.bankAccountNumber,
      matchPatterns: bankAccountResult.matchPatterns,
    },
    detection: {
      transactionCount: bankAccountResult.transactionCount,
      matchingLast4Count: bankAccountResult.matchingLast4Count,
      matchingVendorCount: bankAccountResult.matchingVendorCount,
      sampleTransactions: bankAccountResult.sampleTransactions,
    },
    discrepancy,
    ...(appliedTransactions ? { appliedTransactions } : {}),
  };
}

// Test helpers for dependency injection
let testDatabase = null;

function __setDatabase(db) {
  testDatabase = db;
}

function __resetDatabase() {
  testDatabase = null;
}

function getDatabase() {
  return testDatabase || database;
}

module.exports = {
  autoPairCreditCard,
  findBestBankAccount,
  calculateDiscrepancy,
  __setDatabase,
  __resetDatabase,
};

module.exports.default = module.exports;
