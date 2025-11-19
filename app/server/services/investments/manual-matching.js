const actualDatabase = require('../database.js');
let database = actualDatabase;

/**
 * Manual Credit Card Transaction Matching Service
 *
 * Provides functionality for users to manually match bank repayments
 * to their corresponding credit card expenses.
 */

/**
 * Get unmatched repayments for a specific pairing
 *
 * @param {Object} params
 * @param {string} params.creditCardAccountNumber - CC account number from pairing
 * @param {string} params.creditCardVendor - CC vendor from pairing
 * @param {string} params.bankVendor - Bank vendor from pairing
 * @param {string} params.bankAccountNumber - Bank account number from pairing
 * @param {Array<string>} params.matchPatterns - Patterns to filter repayment names (optional)
 * @param {Object} client - Database client (optional)
 * @returns {Promise<Array>} List of unmatched repayments
 */
async function getUnmatchedRepayments({ creditCardAccountNumber, creditCardVendor, bankVendor, bankAccountNumber, matchPatterns }, client = null) {
  const shouldRelease = !client;
  const dbClient = client || await database.getClient();

  try {
    // Get all bank repayments (category 25) for this pairing
    // that are NOT fully matched yet
    // Filter by match_patterns if provided (transaction name must contain at least one pattern)
    // FILTER OUT old/incomplete repayments: older than 30 days AND from first 10 days of month
    const query = `
      WITH repayment_matches AS (
        SELECT
          repayment_txn_id,
          repayment_vendor,
          SUM(ABS(expense_amount)) as matched_amount
        FROM credit_card_expense_matches
        GROUP BY repayment_txn_id, repayment_vendor
      )
      SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.name,
        t.price,
        t.account_number,
        COALESCE(rm.matched_amount, 0) as matched_amount,
        ABS(t.price) - COALESCE(rm.matched_amount, 0) as remaining_amount
      FROM transactions t
      LEFT JOIN repayment_matches rm
        ON t.identifier = rm.repayment_txn_id
        AND t.vendor = rm.repayment_vendor
      WHERE t.vendor = $1
        AND t.category_definition_id = 25
        AND t.price < 0
        AND (t.account_number = $2 OR $2 IS NULL OR $2 = '')
        AND (t.processed_date IS NULL OR DATE(t.processed_date) <= DATE('now'))
        AND (
          rm.matched_amount IS NULL
          OR ABS(t.price) - rm.matched_amount > 0.01
        )
        AND (
          -- Exclude old incomplete repayments: older than 30 days AND from first 10 days of month
          -- This prevents matching when we don't have complete credit card expense data
          julianday('now') - julianday(t.date) <= 30
          OR CAST(strftime('%d', t.date) AS INTEGER) > 10
        )
        ${matchPatterns && matchPatterns.length > 0 ?
          `AND (${matchPatterns.map((_, i) => `t.name LIKE $${i + 3}`).join(' OR ')})` :
          ''}
      ORDER BY t.date DESC
    `;

    const params = [bankVendor, bankAccountNumber || null];
    if (matchPatterns && matchPatterns.length > 0) {
      matchPatterns.forEach(pattern => {
        params.push(`%${pattern}%`);
      });
    }

    const result = await dbClient.query(query, params);

    return result.rows.map(row => ({
      identifier: row.identifier,
      vendor: row.vendor,
      date: row.date,
      name: row.name,
      price: parseFloat(row.price),
      accountNumber: row.account_number,
      matchedAmount: parseFloat(row.matched_amount),
      remainingAmount: parseFloat(row.remaining_amount),
      isPartiallyMatched: parseFloat(row.matched_amount) > 0
    }));
  } finally {
    if (shouldRelease) {
      dbClient.release();
    }
  }
}

/**
 * Get available processed dates (billing cycles) for a credit card account
 * Returns distinct processed_date values with counts and totals
 *
 * @param {Object} params
 * @param {string} params.creditCardAccountNumber - CC account number
 * @param {string} params.creditCardVendor - CC vendor
 * @param {string} params.startDate - Optional start date filter
 * @param {string} params.endDate - Optional end date filter
 * @param {Object} client - Database client (optional)
 * @returns {Promise<Array>} List of processed dates with metadata
 */
async function getAvailableProcessedDates({ creditCardAccountNumber, creditCardVendor, startDate, endDate }, client = null) {
  const shouldRelease = !client;
  const dbClient = client || await database.getClient();

  try {
    // Default date range: last 12 months
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end);
    if (!startDate) {
      start.setFullYear(start.getFullYear() - 1); // 12 months ago
    }

    const query = `
      SELECT
        processed_date,
        COUNT(*) as expense_count,
        SUM(ABS(price)) as total_amount,
        MIN(date) as earliest_expense_date,
        MAX(date) as latest_expense_date
      FROM transactions
      WHERE vendor = $1
        AND account_number = $2
        AND price < 0
        AND processed_date IS NOT NULL
        AND processed_date >= $3
        AND processed_date <= $4
      GROUP BY processed_date
      ORDER BY processed_date DESC
    `;

    const result = await dbClient.query(query, [
      creditCardVendor,
      creditCardAccountNumber,
      start.toISOString(),
      end.toISOString()
    ]);

    return result.rows.map(row => ({
      processedDate: row.processed_date,
      expenseCount: parseInt(row.expense_count),
      totalAmount: parseFloat(row.total_amount),
      earliestExpenseDate: row.earliest_expense_date,
      latestExpenseDate: row.latest_expense_date
    }));
  } finally {
    if (shouldRelease) {
      dbClient.release();
    }
  }
}

/**
 * Get available credit card expenses for a repayment
 * Shows expenses from repayment date up to 60 days before,
 * excluding expenses already matched to other repayments
 * ENHANCED: Now supports filtering by processed_date for smart matching
 *
 * @param {Object} params
 * @param {string} params.repaymentDate - Date of the repayment (ISO format)
 * @param {string} params.creditCardAccountNumber - CC account number
 * @param {string} params.creditCardVendor - CC vendor
 * @param {boolean} params.includeMatched - Include already matched expenses (default: false)
 * @param {string} params.processedDate - Optional: Filter by specific processed_date (smart matching)
 * @param {Object} client - Database client (optional)
 * @returns {Promise<Array>} List of available expenses
 */
async function getAvailableExpenses({ repaymentDate, creditCardAccountNumber, creditCardVendor, includeMatched = false, processedDate = null }, client = null) {
  const shouldRelease = !client;
  const dbClient = client || await database.getClient();

  try {
    // Smart matching: If processedDate is provided, use it directly
    // Otherwise, fall back to 60-day lookback window
    let dateFilter;
    let params;

    if (processedDate) {
      // SMART MODE: Filter by exact processed_date (billing cycle matching)
      dateFilter = 't.processed_date = $3';
      params = [creditCardVendor, creditCardAccountNumber, processedDate];
    } else {
      // LEGACY MODE: 60-day lookback window
      const endDate = new Date(repaymentDate);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 60);
      dateFilter = 't.date >= $3 AND t.date <= $4';
      params = [creditCardVendor, creditCardAccountNumber, startDate.toISOString(), endDate.toISOString()];
    }

    // Build query with optional matched exclusion
    const matchedFilter = includeMatched ? '' : `
      AND t.identifier NOT IN (
        SELECT expense_txn_id
        FROM credit_card_expense_matches
        WHERE expense_vendor = $1
      )
    `;

    const query = `
      SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.name,
        t.price,
        t.account_number,
        t.category_definition_id,
        t.processed_date,
        cd.name as category_name,
        CASE WHEN m.expense_txn_id IS NOT NULL THEN 1 ELSE 0 END as is_matched
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN credit_card_expense_matches m
        ON t.identifier = m.expense_txn_id AND t.vendor = m.expense_vendor
      WHERE t.vendor = $1
        AND t.account_number = $2
        AND t.price < 0
        AND ${dateFilter}
        AND (t.processed_date IS NULL OR DATE(t.processed_date) <= DATE('now'))
        ${matchedFilter}
      ORDER BY t.date DESC, t.name ASC
    `;

    const result = await dbClient.query(query, params);

    return result.rows.map(row => ({
      identifier: row.identifier,
      vendor: row.vendor,
      date: row.date,
      name: row.name,
      price: parseFloat(row.price),
      accountNumber: row.account_number,
      categoryId: row.category_definition_id,
      categoryName: row.category_name,
      processedDate: row.processed_date,
      isMatched: Boolean(row.is_matched)
    }));
  } finally {
    if (shouldRelease) {
      dbClient.release();
    }
  }
}

/**
 * Get bank repayments that match a specific processed_date
 * Finds bank transactions on the same date as CC billing cycle
 *
 * @param {Object} params
 * @param {string} params.processedDate - The processed_date from CC transactions
 * @param {string} params.bankVendor - Bank vendor
 * @param {string} params.bankAccountNumber - Bank account number (optional)
 * @param {Array<string>} params.matchPatterns - Patterns to filter repayment names (optional)
 * @param {Object} client - Database client (optional)
 * @returns {Promise<Object>} Repayments with totals and analysis
 */
async function getBankRepaymentsForProcessedDate({ processedDate, bankVendor, bankAccountNumber, matchPatterns }, client = null) {
  const shouldRelease = !client;
  const dbClient = client || await database.getClient();

  try {
    // Build pattern filter if provided
    let patternFilter = '';
    const params = [bankVendor, bankAccountNumber || null, processedDate];
    if (matchPatterns && matchPatterns.length > 0) {
      patternFilter = `AND (${matchPatterns.map((_, i) => `t.name LIKE $${i + 4}`).join(' OR ')})`;
      matchPatterns.forEach(pattern => {
        params.push(`%${pattern}%`);
      });
    }

    // Find bank transactions on the same date as processed_date
    // with category_definition_id = 25 (credit card repayments)
    const query = `
      SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.name,
        t.price,
        t.account_number
      FROM transactions t
      WHERE t.vendor = $1
        AND (t.account_number = $2 OR $2 IS NULL OR $2 = '')
        AND t.date = $3
        AND t.category_definition_id = 25
        AND t.price < 0
        ${patternFilter}
      ORDER BY ABS(t.price) DESC
    `;

    const result = await dbClient.query(query, params);
    const repayments = result.rows.map(row => ({
      identifier: row.identifier,
      vendor: row.vendor,
      date: row.date,
      name: row.name,
      price: parseFloat(row.price),
      accountNumber: row.account_number
    }));

    // Calculate totals
    const totalRepaymentAmount = repayments.reduce((sum, r) => sum + Math.abs(r.price), 0);

    return {
      processedDate,
      repayments,
      totalRepaymentAmount,
      repaymentCount: repayments.length
    };
  } finally {
    if (shouldRelease) {
      dbClient.release();
    }
  }
}

/**
 * Save a manual match between repayment and expenses
 *
 * @param {Object} params
 * @param {string} params.repaymentTxnId - Repayment transaction ID
 * @param {string} params.repaymentVendor - Repayment vendor
 * @param {string} params.repaymentDate - Repayment date
 * @param {number} params.repaymentAmount - Repayment amount (negative)
 * @param {string} params.cardNumber - Credit card account number
 * @param {string} params.ccVendor - Credit card vendor
 * @param {Array<Object>} params.expenses - Array of expense objects with identifier, vendor, date, amount
 * @param {number} params.tolerance - Maximum allowed difference in shekels (default: 2, can be up to 50 for fees/interest)
 * @param {Object} client - Database client (optional)
 * @returns {Promise<Object>} Result with success status and match count
 */
async function saveManualMatch({ repaymentTxnId, repaymentVendor, repaymentDate, repaymentAmount, cardNumber, ccVendor, expenses, tolerance = 2 }, client = null) {
  const shouldRelease = !client;
  const dbClient = client || await database.getClient();

  try {
    // Validate that sum of expenses matches repayment (within tolerance)
    // Default tolerance is ₪2 for exact matches
    // Can be increased to ₪50 for smart matching with fees/interest
    const expenseSum = expenses.reduce((sum, exp) => sum + Math.abs(exp.price), 0);
    const repaymentAbs = Math.abs(repaymentAmount);
    const difference = Math.abs(repaymentAbs - expenseSum);

    // Ensure tolerance is within reasonable bounds (max 50)
    const maxTolerance = Math.min(tolerance, 50);

    if (difference > maxTolerance) {
      throw new Error(`Amount mismatch: Repayment ₪${repaymentAbs.toFixed(2)} vs Expenses ₪${expenseSum.toFixed(2)} (diff: ₪${difference.toFixed(2)}). Must be within ₪${maxTolerance.toFixed(2)} tolerance.`);
    }

    // Check that none of the expenses are already matched
    const expenseIds = expenses.map(e => e.identifier);

    // SQLite doesn't support ANY() - use IN clause instead
    const placeholders = expenseIds.map((_, i) => `$${i + 1}`).join(', ');
    const checkQuery = `
      SELECT expense_txn_id
      FROM credit_card_expense_matches
      WHERE expense_txn_id IN (${placeholders}) AND expense_vendor = $${expenseIds.length + 1}
    `;
    const checkResult = await dbClient.query(checkQuery, [...expenseIds, ccVendor]);

    if (checkResult.rows.length > 0) {
      const alreadyMatched = checkResult.rows.map(r => r.expense_txn_id);
      throw new Error(`Some expenses are already matched: ${alreadyMatched.join(', ')}`);
    }

    // Insert matches
    const insertQuery = `
      INSERT INTO credit_card_expense_matches (
        repayment_txn_id,
        repayment_vendor,
        repayment_date,
        repayment_amount,
        card_number,
        expense_txn_id,
        expense_vendor,
        expense_date,
        expense_amount,
        match_confidence,
        match_method,
        matched_at,
        notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, $12)
    `;

    let insertCount = 0;
    for (const expense of expenses) {
      await dbClient.query(insertQuery, [
        repaymentTxnId,
        repaymentVendor,
        repaymentDate,
        repaymentAmount,
        cardNumber,
        expense.identifier,
        expense.vendor,
        expense.date,
        expense.price,
        1.0, // 100% confidence for manual matches
        'manual',
        `Manually matched. Difference: ₪${difference.toFixed(2)}`
      ]);
      insertCount++;
    }

    return {
      success: true,
      matchCount: insertCount,
      difference: difference,
      repaymentAmount: repaymentAbs,
      expenseSum: expenseSum
    };
  } catch (error) {
    throw error;
  } finally {
    if (shouldRelease) {
      dbClient.release();
    }
  }
}

/**
 * Get matching statistics for a pairing
 * Returns counts and amounts of matched vs unmatched repayments
 *
 * @param {Object} params
 * @param {string} params.bankVendor - Bank vendor
 * @param {string} params.bankAccountNumber - Bank account number
 * @param {Array<string>} params.matchPatterns - Optional patterns to filter repayments
 * @param {Object} client - Database client (optional)
 * @returns {Promise<Object>} Statistics object with counts and amounts
 */
async function getMatchingStats({ bankVendor, bankAccountNumber, matchPatterns }, client = null) {
  const shouldRelease = !client;
  const dbClient = client || await database.getClient();

  try {
    // Build pattern filter if provided
    let patternFilter = '';
    const params = [bankVendor, bankAccountNumber || null];
    if (matchPatterns && matchPatterns.length > 0) {
      patternFilter = `AND (${matchPatterns.map((_, i) => `t.name LIKE $${i + 3}`).join(' OR ')})`;
      matchPatterns.forEach(pattern => {
        params.push(`%${pattern}%`);
      });
    }

    const query = `
      WITH repayment_matches AS (
        SELECT
          repayment_txn_id,
          repayment_vendor,
          SUM(ABS(expense_amount)) as matched_amount
        FROM credit_card_expense_matches
        GROUP BY repayment_txn_id, repayment_vendor
      ),
      repayments AS (
        SELECT
          t.identifier,
          t.price,
          COALESCE(rm.matched_amount, 0) as matched_amount,
          ABS(t.price) - COALESCE(rm.matched_amount, 0) as remaining_amount,
          CASE
            WHEN COALESCE(rm.matched_amount, 0) = 0 THEN 'unmatched'
            WHEN ABS(t.price) - COALESCE(rm.matched_amount, 0) <= 2 THEN 'matched'
            ELSE 'partial'
          END as match_status
        FROM transactions t
        LEFT JOIN repayment_matches rm
          ON t.identifier = rm.repayment_txn_id
          AND t.vendor = rm.repayment_vendor
        WHERE t.vendor = $1
          AND t.category_definition_id = 25
          AND t.price < 0
          AND (t.account_number = $2 OR $2 IS NULL OR $2 = '')
          AND (
            -- Exclude old incomplete repayments: older than 30 days AND from first 10 days of month
            -- This ensures stats match what's visible in the UI
            julianday('now') - julianday(t.date) <= 30
            OR CAST(strftime('%d', t.date) AS INTEGER) > 10
          )
          ${patternFilter}
      )
      SELECT
        COUNT(*) as total_repayments,
        SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END) as matched_count,
        SUM(CASE WHEN match_status = 'partial' THEN 1 ELSE 0 END) as partial_count,
        SUM(CASE WHEN match_status = 'unmatched' THEN 1 ELSE 0 END) as unmatched_count,
        SUM(ABS(price)) as total_amount,
        SUM(matched_amount) as matched_amount,
        SUM(remaining_amount) as unmatched_amount
      FROM repayments
    `;

    const result = await dbClient.query(query, params);
    const row = result.rows[0];

    const totalRepayments = parseInt(row.total_repayments) || 0;
    const matchedCount = parseInt(row.matched_count) || 0;
    const unmatchedCount = parseInt(row.unmatched_count) || 0;
    const partialCount = parseInt(row.partial_count) || 0;
    const totalAmount = parseFloat(row.total_amount) || 0;
    const matchedAmount = parseFloat(row.matched_amount) || 0;
    const unmatchedAmount = parseFloat(row.unmatched_amount) || 0;

    // Calculate match percentage
    const matchPercentage = totalAmount > 0
      ? Math.round((matchedAmount / totalAmount) * 100)
      : 0;

    return {
      totalRepayments,
      matchedCount,
      partialCount,
      unmatchedCount,
      totalAmount,
      matchedAmount,
      unmatchedAmount,
      matchPercentage
    };
  } finally {
    if (shouldRelease) {
      dbClient.release();
    }
  }
}

/**
 * Find all possible combinations of expenses that match a repayment amount
 * Uses dynamic programming to find combinations with EXACT match (0.00 difference)
 *
 * @param {Object} params
 * @param {string} params.repaymentTxnId - Repayment transaction ID
 * @param {string} params.repaymentDate - Date of the repayment
 * @param {number} params.repaymentAmount - Amount to match (negative)
 * @param {string} params.creditCardAccountNumber - CC account number
 * @param {string} params.creditCardVendor - CC vendor
 * @param {number} params.tolerance - Tolerance in shekels (default: 0 for perfect match)
 * @param {number} params.maxCombinationSize - Max number of expenses per combination (default: 15)
 * @param {boolean} params.includeMatched - Include already matched expenses (default: false)
 * @param {Object} client - Database client (optional)
 * @returns {Promise<Array>} List of matching combinations
 */
async function findMatchingCombinations({
  repaymentTxnId,
  repaymentDate,
  repaymentAmount,
  creditCardAccountNumber,
  creditCardVendor,
  tolerance = 0,
  maxCombinationSize = 15,
  includeMatched = false,
  processedDate = null
}, client = null) {
  const shouldRelease = !client;
  const dbClient = client || await database.getClient();

  try {
    // Get available expenses (optionally including already matched ones)
    // ENHANCED: Support smart date matching via processedDate
    const expenses = await getAvailableExpenses({
      repaymentDate,
      creditCardAccountNumber,
      creditCardVendor,
      includeMatched,
      processedDate  // New: filter by processed_date if provided
    }, dbClient);

    if (expenses.length === 0) {
      return [];
    }

    const targetAmount = Math.abs(repaymentAmount);
    const results = [];

    // Convert expenses to simple format and work with integers (agorot) to avoid floating point issues
    const items = expenses.map(e => ({
      id: e.identifier,
      amount: Math.round(Math.abs(e.price) * 100), // Convert to agorot (cents)
      name: e.name,
      date: e.date,
      expense: e
    }));

    const targetAgorot = Math.round(targetAmount * 100);
    const toleranceAgorot = Math.round(tolerance * 100);

    // Sort by amount descending for better pruning
    items.sort((a, b) => b.amount - a.amount);

    // Limit search space for performance
    const maxResults = 50; // Find up to 50 combinations
    const maxIterations = 50000; // Safety limit to prevent infinite loops
    let iterationCount = 0;

    // Find combinations using optimized recursive search
    function findCombinations(index, currentCombo, currentSum, startTime) {
      iterationCount++;

      // Safety checks
      if (iterationCount > maxIterations) {
        console.log(`Combination search stopped after ${maxIterations} iterations`);
        return true; // Signal to stop
      }

      // Timeout after 5 seconds
      if (Date.now() - startTime > 5000) {
        console.log('Combination search timed out after 5 seconds');
        return true; // Signal to stop
      }

      if (results.length >= maxResults) {
        return true; // Found enough results
      }

      // Check if we found a match
      const diff = Math.abs(targetAgorot - currentSum);
      if (diff <= toleranceAgorot) {
        // Sort expenses by date (ascending) for consistent display
        const sortedExpenses = currentCombo
          .map(item => item.expense)
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        results.push({
          expenses: sortedExpenses,
          totalAmount: currentSum / 100, // Convert back to shekels
          difference: diff / 100,
          count: currentCombo.length
        });

        // For exact matches, continue searching for alternative combinations
        if (diff === 0 && results.length >= maxResults) {
          return true; // Found enough exact matches
        }
      }

      // Stop if we exceeded the amount or reached max size
      if (currentSum > targetAgorot + toleranceAgorot ||
          currentCombo.length >= maxCombinationSize ||
          index >= items.length) {
        return false;
      }

      // Pruning: Skip if remaining items can't possibly reach target
      const remainingSum = items.slice(index).reduce((sum, item) => sum + item.amount, 0);
      if (currentSum + remainingSum < targetAgorot - toleranceAgorot) {
        return false; // Can't reach target even with all remaining items
      }

      // Try adding each remaining expense
      for (let i = index; i < items.length && i < index + 20; i++) { // Limit branching factor
        const item = items[i];

        // Skip if this item alone would overshoot by too much
        if (currentSum + item.amount > targetAgorot + toleranceAgorot) {
          continue;
        }

        // Recursively search with this item
        const shouldStop = findCombinations(
          i + 1,
          [...currentCombo, item],
          currentSum + item.amount,
          startTime
        );

        if (shouldStop) {
          return true;
        }
      }

      return false;
    }

    // Start the search with timestamp
    const startTime = Date.now();
    findCombinations(0, [], 0, startTime);

    console.log(`Combination search completed: ${results.length} results found in ${iterationCount} iterations`);

    // Remove duplicate combinations (same set of expense IDs)
    const uniqueResults = [];
    const seenCombinations = new Set();

    for (const result of results) {
      // Create a unique key from sorted expense IDs
      const expenseIds = result.expenses.map(e => e.identifier).sort().join(',');

      if (!seenCombinations.has(expenseIds)) {
        seenCombinations.add(expenseIds);
        uniqueResults.push(result);
      }
    }

    console.log(`After deduplication: ${uniqueResults.length} unique combinations`);

    // Sort results by difference (best matches first), then by count
    uniqueResults.sort((a, b) => {
      if (a.difference !== b.difference) {
        return a.difference - b.difference;
      }
      return a.count - b.count;
    });

    // Return top 20 best combinations
    return uniqueResults.slice(0, 20);
  } finally {
    if (shouldRelease) {
      dbClient.release();
    }
  }
}

/**
 * Get weekly matching statistics for a pairing
 * Shows week-by-week breakdown of matched vs unmatched transactions
 *
 * @param {Object} params
 * @param {string} params.creditCardAccountNumber - CC account number
 * @param {string} params.creditCardVendor - CC vendor
 * @param {string} params.bankVendor - Bank vendor
 * @param {string} params.bankAccountNumber - Bank account number
 * @param {Array<string>} params.matchPatterns - Patterns to filter repayments
 * @param {string} params.startDate - Start date (optional, default: 3 months ago)
 * @param {string} params.endDate - End date (optional, default: now)
 * @param {Object} client - Database client (optional)
 * @returns {Promise<Array>} Array of weekly stats
 */
async function getWeeklyMatchingStats({
  creditCardAccountNumber,
  creditCardVendor,
  bankVendor,
  bankAccountNumber,
  matchPatterns,
  startDate,
  endDate
}, client = null) {
  const shouldRelease = !client;
  const dbClient = client || await database.getClient();

  try {
    // Default date range: last 12 weeks
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end);
    if (!startDate) {
      start.setDate(start.getDate() - (12 * 7)); // 12 weeks ago
    }

    // Get ALL repayments (both matched and unmatched) in date range
    // Build custom query with date filter
    const matchPatternsArray = matchPatterns || [];
    const query = `
      WITH repayment_matches AS (
        SELECT
          repayment_txn_id,
          repayment_vendor,
          SUM(ABS(expense_amount)) as matched_amount
        FROM credit_card_expense_matches
        GROUP BY repayment_txn_id, repayment_vendor
      )
      SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.name,
        t.price,
        t.account_number,
        COALESCE(rm.matched_amount, 0) as matched_amount,
        ABS(t.price) - COALESCE(rm.matched_amount, 0) as remaining_amount
      FROM transactions t
      LEFT JOIN repayment_matches rm
        ON t.identifier = rm.repayment_txn_id
        AND t.vendor = rm.repayment_vendor
      WHERE t.vendor = $1
        AND t.category_definition_id = 25
        AND t.price < 0
        AND (t.account_number = $2 OR $2 IS NULL OR $2 = '')
        AND t.date >= $3
        AND t.date <= $4
        AND (t.processed_date IS NULL OR DATE(t.processed_date) <= DATE('now'))
        ${matchPatternsArray.length > 0 ?
          `AND (${matchPatternsArray.map((_, i) => `t.name LIKE $${i + 5}`).join(' OR ')})` :
          ''}
      ORDER BY t.date DESC
    `;

    const params = [
      bankVendor,
      bankAccountNumber || null,
      start.toISOString(),
      end.toISOString()
    ];

    if (matchPatternsArray.length > 0) {
      matchPatternsArray.forEach(pattern => {
        params.push(`%${pattern}%`);
      });
    }

    const result = await dbClient.query(query, params);
    const repayments = result.rows.map(row => ({
      identifier: row.identifier,
      vendor: row.vendor,
      date: row.date,
      name: row.name,
      price: parseFloat(row.price),
      accountNumber: row.account_number,
      matchedAmount: parseFloat(row.matched_amount),
      remainingAmount: parseFloat(row.remaining_amount),
      isPartiallyMatched: parseFloat(row.matched_amount) > 0,
      isFullyMatched: parseFloat(row.remaining_amount) <= 2
    }));

    // Group repayments by week
    const weeklyData = {};

    // Initialize weeks
    const current = new Date(start);
    while (current <= end) {
      const weekStart = new Date(current);
      const weekEnd = new Date(current);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const weekKey = weekStart.toISOString().split('T')[0];
      weeklyData[weekKey] = {
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        bank: { total: 0, matched: 0, unmatched: 0 },
        cc: { total: 0, matched: 0, unmatched: 0 }
      };

      current.setDate(current.getDate() + 7);
    }

    // Process each repayment
    for (const repayment of repayments) {
      const repaymentDate = new Date(repayment.date);

      // Find which week this repayment belongs to
      const current = new Date(start);
      while (current <= end) {
        const weekStart = new Date(current);
        const weekEnd = new Date(current);
        weekEnd.setDate(weekEnd.getDate() + 6);

        if (repaymentDate >= weekStart && repaymentDate <= weekEnd) {
          const weekKey = weekStart.toISOString().split('T')[0];

          // Count bank repayment
          weeklyData[weekKey].bank.total++;
          if (repayment.isFullyMatched || repayment.remainingAmount <= 2) {
            weeklyData[weekKey].bank.matched++;
          } else {
            weeklyData[weekKey].bank.unmatched++;
          }

          // Get CC expenses for this repayment (60-day lookback)
          const expenses = await getAvailableExpenses({
            repaymentDate: repayment.date,
            creditCardAccountNumber,
            creditCardVendor,
            includeMatched: true  // Include all to get accurate counts
          }, dbClient);

          // Count CC expenses
          for (const expense of expenses) {
            weeklyData[weekKey].cc.total++;
            if (expense.isMatched) {
              weeklyData[weekKey].cc.matched++;
            } else {
              weeklyData[weekKey].cc.unmatched++;
            }
          }

          break;
        }

        current.setDate(current.getDate() + 7);
      }
    }

    // Convert to array and sort by date
    return Object.values(weeklyData).sort((a, b) =>
      new Date(a.weekStart).getTime() - new Date(b.weekStart).getTime()
    );
  } finally {
    if (shouldRelease) {
      dbClient.release();
    }
  }
}

module.exports = {
  getUnmatchedRepayments,
  getAvailableExpenses,
  getAvailableProcessedDates,
  getBankRepaymentsForProcessedDate,
  saveManualMatch,
  getMatchingStats,
  findMatchingCombinations,
  getWeeklyMatchingStats,
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};
