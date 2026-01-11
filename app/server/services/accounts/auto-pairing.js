const database = require('../database.js');
const pairingsService = require('./pairings.js');
const { getCreditCardRepaymentCategoryCondition } = require('./repayment-category.js');

// Credit card vendor keywords (Hebrew and English) - reused from smart-match.js
const VENDOR_KEYWORDS = {
  max: ['מקס', 'max'],
  visaCal: ['כ.א.ל', 'cal', 'ויזה כאל', 'visa cal'],
  isracard: ['ישראכרט', 'isracard'],
  amex: ['אמקס', 'אמריקן אקספרס', 'amex', 'american express'],
  leumi: ['לאומי כרט', 'leumi card'],
  diners: ['דיינרס', 'diners'],
};

function uniq(array) {
  return Array.from(new Set(array));
}

function normalizePattern(pattern) {
  const trimmed = String(pattern || '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickDiscrepancyPatterns(matchPatterns = [], ccVendor, ccAccountNumber) {
  const normalizedPatterns = uniq(matchPatterns.map(normalizePattern).filter(Boolean));
  const vendorKeywords = new Set((VENDOR_KEYWORDS[ccVendor] || []).map((kw) => kw.toLowerCase()));

  const nonVendorPatterns = normalizedPatterns.filter((pattern) => !vendorKeywords.has(pattern.toLowerCase()));
  const numericNonVendor = nonVendorPatterns.filter((pattern) => /^\d{4,}$/.test(pattern));

  const accountNumber = normalizePattern(ccAccountNumber);
  const accountPatterns = [];
  if (accountNumber && accountNumber !== 'undefined' && accountNumber !== 'null') {
    accountPatterns.push(accountNumber);
    if (accountNumber.length > 4) {
      accountPatterns.push(accountNumber.slice(-4));
    }
  }

  const accountPatternsUnique = uniq(accountPatterns);
  const numericAccountPatterns = accountPatternsUnique.filter((pattern) => /^\d{4,}$/.test(pattern));

  // Prefer account number patterns first, then other numeric patterns, then any non-vendor patterns.
  if (numericAccountPatterns.length > 0) return numericAccountPatterns;
  if (numericNonVendor.length > 0) return numericNonVendor;
  if (accountPatternsUnique.length > 0) return accountPatternsUnique;
  if (nonVendorPatterns.length > 0) return nonVendorPatterns;

  // If we only have vendor keywords, discrepancy matching is too ambiguous.
  return [];
}

function getDiscrepancyPatternSets(matchPatterns = [], ccVendor, ccAccountNumber) {
  const preferred = pickDiscrepancyPatterns(matchPatterns, ccVendor, ccAccountNumber);
  const normalizedAll = uniq(matchPatterns.map(normalizePattern).filter(Boolean));
  const vendorKeywords = uniq(VENDOR_KEYWORDS[ccVendor] || []);

  const sets = [];
  if (preferred.length > 0) sets.push({ patterns: preferred, label: 'preferred' });
  if (normalizedAll.length > 0) sets.push({ patterns: normalizedAll, label: 'all_patterns' });
  if (vendorKeywords.length > 0) sets.push({ patterns: vendorKeywords, label: 'vendor_keywords' });
  sets.push({ patterns: [], label: 'category_only' });

  // Ensure unique by pattern content
  const seen = new Set();
  return sets.filter((set) => {
    const key = set.patterns.map((p) => p.toLowerCase()).sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Extract potential match patterns from bank transactions
 */
function extractPatternsFromTransactions(transactions, ccVendor, ccAccountNumber) {
  const patterns = new Set();

  // Add vendor keywords
  const vendorKeywords = VENDOR_KEYWORDS[ccVendor] || [];
  vendorKeywords.forEach(kw => patterns.add(kw));

  // Add account number patterns if available
  if (ccAccountNumber) {
    patterns.add(ccAccountNumber);
    if (ccAccountNumber.length > 4) {
      patterns.add(ccAccountNumber.slice(-4));
    }
  }

  // Extract patterns from transaction names
  transactions.forEach(txn => {
    const name = (txn.name || '').toLowerCase();

    // Check which vendor keywords appear in name
    vendorKeywords.forEach(kw => {
      if (name.includes(kw.toLowerCase())) {
        patterns.add(kw);
      }
    });

    // Extract 4-digit sequences (potential card numbers)
    const digitMatches = name.match(/\d{4}/g);
    if (digitMatches) {
      digitMatches.forEach(digits => {
        // Only add if it looks like it could be a card number (appears in repayment context)
        if (ccAccountNumber && ccAccountNumber.includes(digits)) {
          patterns.add(digits);
        }
      });
    }
  });

  return Array.from(patterns).filter(p => p && p.length > 0);
}

/**
 * Calculate confidence score for a bank account match
 */
function calculateBankAccountConfidence(transactions, ccVendor) {
  let score = 0;
  const vendorKeywords = VENDOR_KEYWORDS[ccVendor] || [];

  transactions.forEach(txn => {
    const nameLower = (txn.name || '').toLowerCase();

    // Repayment category match - strong signal
    if (txn.is_repayment) {
      score += 3;
    }

    // Vendor keyword match
    vendorKeywords.forEach(kw => {
      if (nameLower.includes(kw.toLowerCase())) {
        score += kw.length > 4 ? 2 : 1;
      }
    });
  });

  // Boost for multiple transactions
  score += Math.min(Math.floor(transactions.length / 2), 5);

  return score;
}

/**
 * Find the best matching bank account for a credit card
 * Searches bank transactions for repayments that match the CC vendor
 */
async function findBestBankAccount(params) {
  const {
    creditCardVendor,
    creditCardAccountNumber = null,
    creditCardNickname = null,
  } = params;

  if (!creditCardVendor) {
    const error = new Error('creditCardVendor is required');
    error.status = 400;
    throw error;
  }

  const client = await database.getClient();

  try {
    // Build search patterns from CC info
    const searchPatterns = [];

    // Add vendor keywords
    const vendorKeywords = VENDOR_KEYWORDS[creditCardVendor] || [];
    searchPatterns.push(...vendorKeywords);

    // Add account number patterns
    if (creditCardAccountNumber) {
      searchPatterns.push(creditCardAccountNumber);
      if (creditCardAccountNumber.length > 4) {
        searchPatterns.push(creditCardAccountNumber.slice(-4));
      }
    }

    // Add nickname patterns
    if (creditCardNickname) {
      const words = creditCardNickname.split(/\s+/).filter(w => w.length > 2);
      searchPatterns.push(...words);
    }

    if (searchPatterns.length === 0) {
      return { found: false, reason: 'No search patterns could be derived from CC info' };
    }

    // Build query to find bank transactions matching CC patterns
    // Exclude transactions from CC vendors (we want bank transactions only)
    const ccVendors = Object.keys(VENDOR_KEYWORDS);
    const ccVendorPlaceholders = ccVendors.map((_, i) => `$${i + 1}`).join(', ');

    const patternConditions = searchPatterns.map(
      (_, idx) => `LOWER(t.name) LIKE '%' || LOWER($${ccVendors.length + idx + 1}) || '%'`
    );

    const repaymentCategoryCondition = getCreditCardRepaymentCategoryCondition('cd');

    const query = `
      SELECT
        t.identifier,
        t.vendor,
        t.account_number,
        t.name,
        t.price,
        t.date,
        t.category_definition_id,
        CASE WHEN ${repaymentCategoryCondition} THEN 1 ELSE 0 END as is_repayment
      FROM transactions t
      LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
      WHERE t.vendor NOT IN (${ccVendorPlaceholders})
        AND t.price < 0
        AND (
          ${repaymentCategoryCondition}
          OR (${patternConditions.join(' OR ')})
        )
      ORDER BY t.date DESC
      LIMIT 200
    `;

    const queryParams = [...ccVendors, ...searchPatterns];
    const result = await client.query(query, queryParams);

    if (result.rows.length === 0) {
      return { found: false, reason: 'No matching bank transactions found' };
    }

    // Group transactions by bank vendor + account number
    const bankAccountGroups = {};
    result.rows.forEach(row => {
      const key = `${row.vendor}|${row.account_number || 'null'}`;
      if (!bankAccountGroups[key]) {
        bankAccountGroups[key] = {
          bankVendor: row.vendor,
          bankAccountNumber: row.account_number,
          transactions: [],
        };
      }
      bankAccountGroups[key].transactions.push(row);
    });

    // Calculate confidence for each bank account
    const candidates = Object.values(bankAccountGroups).map(group => ({
      ...group,
      confidence: calculateBankAccountConfidence(group.transactions, creditCardVendor),
      transactionCount: group.transactions.length,
    }));

    // Sort by confidence (highest first)
    candidates.sort((a, b) => b.confidence - a.confidence);

    const bestMatch = candidates[0];

    if (!bestMatch || bestMatch.confidence < 3) {
      return {
        found: false,
        reason: 'No bank account with sufficient confidence found',
        candidates: candidates.slice(0, 3),
      };
    }

    // Extract match patterns from matched transactions
    const matchPatterns = extractPatternsFromTransactions(
      bestMatch.transactions,
      creditCardVendor,
      creditCardAccountNumber
    );

    return {
      found: true,
      bankVendor: bestMatch.bankVendor,
      bankAccountNumber: bestMatch.bankAccountNumber,
      confidence: bestMatch.confidence,
      transactionCount: bestMatch.transactionCount,
      matchPatterns,
      sampleTransactions: bestMatch.transactions.slice(0, 3).map(t => ({
        name: t.name,
        price: t.price,
        date: t.date,
      })),
      otherCandidates: candidates.slice(1, 3),
    };
  } finally {
    client.release();
  }
}

/**
 * Calculate exact discrepancy between bank repayments and CC expenses
 * Uses 0 tolerance (exact match required)
 */
async function calculateDiscrepancy(params) {
  const {
    bankVendor,
    bankAccountNumber = null,
    ccVendor,
    ccAccountNumber = null,
    matchPatterns = [],
    monthsBack = 3,
  } = params;

  if (!bankVendor || !ccVendor) {
    return null;
  }

  // Heuristics:
  // - Exclude CC cycles whose billed/processed date is in the future (installments / not-yet-posted charges).
  // - Treat very large diffs in the first observed CC cycle as incomplete history (avoid false alarms).
  const todayStr = new Date().toISOString().split('T')[0];
  const EPSILON = 0.01;
  const MAX_FEE_AMOUNT = 200; // ILS; above this is unlikely to be "just fees"
  const MIN_HISTORY_COVERAGE_DAYS = 20; // < 20 days of purchases in first cycle => likely incomplete history

  const client = await database.getClient();

  try {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsBack);
    const startDateStr = startDate.toISOString().split('T')[0];

    const repaymentCategoryCondition = getCreditCardRepaymentCategoryCondition('cd');

    let chosen = null;
    const patternSets = getDiscrepancyPatternSets(matchPatterns, ccVendor, ccAccountNumber);

    for (const candidate of patternSets) {
      const patterns = candidate.patterns;
      const patternConditions = patterns.length > 0
        ? `AND (${patterns.map((_, idx) => `LOWER(t.name) LIKE '%' || LOWER($${idx + 4}) || '%'`).join(' OR ')})`
        : '';

      const bankParams = [bankVendor, startDateStr, todayStr, ...patterns];
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
          date(t.date) as cycle_date,
          t.name,
          t.price
        FROM transactions t
        LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
        WHERE t.vendor = $1
          AND date(t.date) >= $2
          AND date(t.date) <= $3
          AND t.price < 0
          AND ${repaymentCategoryCondition}
          ${patternConditions}
          ${bankAccountFilter}
        ORDER BY t.date DESC
        LIMIT 500
      `;

      const repaymentRows = (await client.query(bankRepaymentsQuery, bankParams)).rows || [];
      if (repaymentRows.length === 0) {
        continue;
      }

      chosen = {
        label: candidate.label,
        patterns,
        repayments: repaymentRows.map((row) => ({
          identifier: row.identifier,
          vendor: row.vendor,
          accountNumber: row.account_number,
          date: row.date,
          cycleDate: row.cycle_date,
          name: row.name,
          price: parseFloat(row.price),
        })),
      };
      break;
    }

    if (!chosen) {
      return {
        exists: false,
        reason: 'No credit card repayment transactions found for this pairing',
        periodMonths: monthsBack,
      };
    }

    // Group repayments by cycleDate
    const cycleMap = new Map();
    for (const repayment of chosen.repayments) {
      const key = repayment.cycleDate;
      if (!cycleMap.has(key)) {
        cycleMap.set(key, { cycleDate: key, repayments: [], bankTotal: 0 });
      }
      const bucket = cycleMap.get(key);
      bucket.repayments.push(repayment);
      bucket.bankTotal += Math.abs(repayment.price);
    }

    // Fetch CC cycle totals by billed date (processed_date when available), excluding future cycles.
    const ccParams = [ccVendor, startDateStr, todayStr];
    let ccAccountFilter = '';
    if (ccAccountNumber) {
      ccParams.push(ccAccountNumber);
      ccAccountFilter = `AND t.account_number = $${ccParams.length}`;
    }

    const ccCyclesQuery = `
      SELECT
        date(COALESCE(t.processed_date, t.date)) AS cycle_date,
        COUNT(*) AS txn_count,
        MIN(date(t.date)) AS min_purchase_date,
        MAX(date(t.date)) AS max_purchase_date,
        COALESCE(SUM(ABS(t.price)), 0) AS total
      FROM transactions t
      WHERE t.vendor = $1
        AND t.price < 0
        AND date(COALESCE(t.processed_date, t.date)) >= $2
        AND date(COALESCE(t.processed_date, t.date)) <= $3
        ${ccAccountFilter}
      GROUP BY date(COALESCE(t.processed_date, t.date))
    `;

    const ccRows = (await client.query(ccCyclesQuery, ccParams)).rows || [];
    const ccCycleTotals = new Map(ccRows.map((row) => [row.cycle_date, {
      total: parseFloat(row.total) || 0,
      txnCount: parseInt(row.txn_count, 10) || 0,
      minPurchaseDate: row.min_purchase_date || null,
      maxPurchaseDate: row.max_purchase_date || null,
    }]));

    // Global CC bounds for "incomplete history" detection.
    const ccMetaParams = [ccVendor];
    let ccMetaAccountFilter = '';
    if (ccAccountNumber) {
      ccMetaParams.push(ccAccountNumber);
      ccMetaAccountFilter = `AND t.account_number = $${ccMetaParams.length}`;
    }

    const ccMetaQuery = `
      SELECT MIN(date(t.date)) AS min_purchase_date
      FROM transactions t
      WHERE t.vendor = $1
        AND t.price < 0
        ${ccMetaAccountFilter}
    `;

    const ccMetaRow = (await client.query(ccMetaQuery, ccMetaParams)).rows?.[0] || null;
    const globalMinPurchaseDate = ccMetaRow?.min_purchase_date || null;

    function dayDiff(later, earlier) {
      if (!later || !earlier) return null;
      const tLater = Date.parse(`${later}T00:00:00Z`);
      const tEarlier = Date.parse(`${earlier}T00:00:00Z`);
      if (Number.isNaN(tLater) || Number.isNaN(tEarlier)) return null;
      return Math.round((tLater - tEarlier) / 86400000);
    }

    const cycles = Array.from(cycleMap.values())
      .map((cycle) => {
        const ccInfo = ccCycleTotals.has(cycle.cycleDate) ? ccCycleTotals.get(cycle.cycleDate) : null;
        const ccTotal = ccInfo ? ccInfo.total : null;
        const difference = ccTotal === null ? null : (cycle.bankTotal - ccTotal);
        const coverageDays = ccInfo?.minPurchaseDate ? dayDiff(cycle.cycleDate, ccInfo.minPurchaseDate) : null;
        const isFirstHistoryCycle = Boolean(
          globalMinPurchaseDate &&
          ccInfo?.minPurchaseDate &&
          dayDiff(ccInfo.minPurchaseDate, globalMinPurchaseDate) !== null &&
          dayDiff(ccInfo.minPurchaseDate, globalMinPurchaseDate) <= 1,
        );

        const isIncompleteHistory = Boolean(
          ccTotal !== null &&
          difference !== null &&
          difference > MAX_FEE_AMOUNT &&
          isFirstHistoryCycle &&
          coverageDays !== null &&
          coverageDays >= 0 &&
          coverageDays < MIN_HISTORY_COVERAGE_DAYS,
        );

        let status;
        if (ccTotal === null) {
          status = 'missing_cc_cycle';
        } else if (difference === null || Math.abs(difference) <= EPSILON) {
          status = 'matched';
        } else if (difference > 0) {
          if (difference <= MAX_FEE_AMOUNT) {
            status = 'fee_candidate';
          } else if (isIncompleteHistory) {
            status = 'incomplete_history';
          } else {
            status = 'large_discrepancy';
          }
        } else {
          status = 'cc_over_bank';
        }

        return {
          cycleDate: cycle.cycleDate,
          bankTotal: Math.round(cycle.bankTotal * 100) / 100,
          ccTotal: ccTotal === null ? null : (Math.round(ccTotal * 100) / 100),
          difference: difference === null ? null : (Math.round(difference * 100) / 100),
          repayments: cycle.repayments,
          status,
          ccTxnCount: ccInfo?.txnCount ?? null,
          ccMinPurchaseDate: ccInfo?.minPurchaseDate ?? null,
          ccMaxPurchaseDate: ccInfo?.maxPurchaseDate ?? null,
          ccCoverageDays: coverageDays,
          maxFeeAmount: MAX_FEE_AMOUNT,
          excludedFutureCycles: true,
        };
      })
      .sort((a, b) => (a.cycleDate < b.cycleDate ? 1 : -1));

    const comparableCycles = cycles.filter((c) => c.ccTotal !== null && c.status !== 'incomplete_history');
    const totalBankMatched = comparableCycles.reduce((sum, c) => sum + c.bankTotal, 0);
    const totalCCMatched = comparableCycles.reduce((sum, c) => sum + (c.ccTotal || 0), 0);
    const totalDifference = totalBankMatched - totalCCMatched;
    const actionableStatuses = new Set(['fee_candidate', 'large_discrepancy', 'cc_over_bank']);
    const hasDiscrepancy = cycles.some((c) => c.difference !== null && actionableStatuses.has(c.status));

    return {
      exists: hasDiscrepancy,
      totalBankRepayments: Math.round(totalBankMatched * 100) / 100,
      totalCCExpenses: Math.round(totalCCMatched * 100) / 100,
      difference: Math.round(totalDifference * 100) / 100,
      differencePercentage: totalCCMatched > 0
        ? Math.round((totalDifference / totalCCMatched) * 10000) / 100
        : 0,
      periodMonths: monthsBack,
      matchedCycleCount: comparableCycles.length,
      matchPatternsUsed: chosen.patterns,
      method: `repayment_cycles:${chosen.label}`,
      cycles,
    };
  } finally {
    client.release();
  }
}

/**
 * Auto-pair a credit card to its bank account
 * Main orchestrator function
 */
async function autoPairCreditCard(params) {
  const {
    creditCardVendor,
    creditCardAccountNumber = null,
    creditCardNickname = null,
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
    creditCardNickname,
  });

  if (!bankAccountResult.found) {
    return {
      success: false,
      reason: bankAccountResult.reason,
      candidates: bankAccountResult.candidates || [],
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

  if (existingPairing) {
    pairingId = existingPairing.id;
    // If it was inactive, reactivate it
    if (!existingPairing.isActive) {
      await pairingsService.updatePairing({
        id: pairingId,
        isActive: true,
        matchPatterns: bankAccountResult.matchPatterns,
      });
    }
  } else {
    // Step 3: Create the pairing
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

  // Step 4: Calculate discrepancy
  const discrepancy = await calculateDiscrepancy({
    bankVendor: bankAccountResult.bankVendor,
    bankAccountNumber: bankAccountResult.bankAccountNumber,
    ccVendor: creditCardVendor,
    ccAccountNumber: creditCardAccountNumber,
    matchPatterns: bankAccountResult.matchPatterns,
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
      confidence: bankAccountResult.confidence,
    },
    detection: {
      transactionCount: bankAccountResult.transactionCount,
      sampleTransactions: bankAccountResult.sampleTransactions,
    },
    discrepancy,
  };
}

module.exports = {
  autoPairCreditCard,
  findBestBankAccount,
  calculateDiscrepancy,
  extractPatternsFromTransactions,
};

module.exports.default = module.exports;
