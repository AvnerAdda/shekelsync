const actualDatabase = require('../database.js');

let database = actualDatabase;

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Keywords to identify pikadon transactions (Hebrew and English)
const PIKADON_KEYWORDS = [
  'פיקדון',
  'פקדון',
  'pikadon',
  'term deposit',
  'fixed deposit',
  'תוכנית חסכון',
  'פק"מ',
  'פקמ',
];

/**
 * List all pikadon holdings
 */
async function listPikadon(params = {}) {
  const { accountId, status, includeTransactions = false } = params;

  let query = `
    SELECT
      ih.*,
      ia.account_name,
      ia.account_type,
      ia.institution,
      ia.currency
    FROM investment_holdings ih
    JOIN investment_accounts ia ON ih.account_id = ia.id
    WHERE ih.holding_type = 'pikadon'
  `;

  const queryParams = [];
  let paramIndex = 1;

  if (accountId) {
    query += ` AND ih.account_id = $${paramIndex++}`;
    queryParams.push(accountId);
  }

  if (status) {
    query += ` AND ih.status = $${paramIndex++}`;
    queryParams.push(status);
  }

  query += ' ORDER BY ih.maturity_date ASC, ih.as_of_date DESC';

  const result = await database.query(query, queryParams);

  const pikadonList = result.rows.map((row) => ({
    ...row,
    current_value: row.current_value !== null ? Number.parseFloat(row.current_value) : null,
    cost_basis: row.cost_basis !== null ? Number.parseFloat(row.cost_basis) : null,
    interest_rate: row.interest_rate !== null ? Number.parseFloat(row.interest_rate) : null,
    interest_earned: row.cost_basis && row.current_value
      ? Number.parseFloat(row.current_value) - Number.parseFloat(row.cost_basis)
      : 0,
  }));

  // Optionally fetch linked transactions
  if (includeTransactions && pikadonList.length > 0) {
    for (const pikadon of pikadonList) {
      pikadon.deposit_transaction = null;
      pikadon.return_transaction = null;

      if (pikadon.deposit_transaction_id && pikadon.deposit_transaction_vendor) {
        const depositTxn = await database.query(
          'SELECT * FROM transactions WHERE identifier = $1 AND vendor = $2',
          [pikadon.deposit_transaction_id, pikadon.deposit_transaction_vendor]
        );
        if (depositTxn.rows.length > 0) {
          pikadon.deposit_transaction = depositTxn.rows[0];
        }
      }

      if (pikadon.return_transaction_id && pikadon.return_transaction_vendor) {
        const returnTxn = await database.query(
          'SELECT * FROM transactions WHERE identifier = $1 AND vendor = $2',
          [pikadon.return_transaction_id, pikadon.return_transaction_vendor]
        );
        if (returnTxn.rows.length > 0) {
          pikadon.return_transaction = returnTxn.rows[0];
        }
      }
    }
  }

  return { pikadon: pikadonList };
}

/**
 * Get pikadon summary statistics
 */
async function getPikadonSummary() {
  const result = await database.query(`
    SELECT
      COUNT(*) as total_count,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count,
      SUM(CASE WHEN status = 'matured' THEN 1 ELSE 0 END) as matured_count,
      SUM(CASE WHEN status = 'rolled_over' THEN 1 ELSE 0 END) as rolled_over_count,
      SUM(CASE WHEN status = 'active' THEN cost_basis ELSE 0 END) as active_principal,
      SUM(cost_basis) as total_principal,
      SUM(current_value - cost_basis) as total_interest_earned,
      AVG(interest_rate) as avg_interest_rate
    FROM investment_holdings
    WHERE holding_type = 'pikadon'
  `);

  const row = result.rows[0];

  // Get upcoming maturities (next 30 days)
  const upcomingResult = await database.query(`
    SELECT
      ih.*,
      ia.account_name
    FROM investment_holdings ih
    JOIN investment_accounts ia ON ih.account_id = ia.id
    WHERE ih.holding_type = 'pikadon'
      AND ih.status = 'active'
      AND ih.maturity_date IS NOT NULL
      AND ih.maturity_date <= date('now', '+30 days')
    ORDER BY ih.maturity_date ASC
  `);

  return {
    summary: {
      total_count: parseInt(row.total_count) || 0,
      active_count: parseInt(row.active_count) || 0,
      matured_count: parseInt(row.matured_count) || 0,
      rolled_over_count: parseInt(row.rolled_over_count) || 0,
      active_principal: Number.parseFloat(row.active_principal) || 0,
      total_principal: Number.parseFloat(row.total_principal) || 0,
      total_interest_earned: Number.parseFloat(row.total_interest_earned) || 0,
      avg_interest_rate: Number.parseFloat(row.avg_interest_rate) || 0,
    },
    upcoming_maturities: upcomingResult.rows.map((r) => ({
      ...r,
      cost_basis: Number.parseFloat(r.cost_basis),
      current_value: Number.parseFloat(r.current_value),
    })),
  };
}

/**
 * Create a new pikadon holding
 */
async function createPikadon(payload = {}) {
  const {
    account_id,
    cost_basis, // principal amount
    maturity_date,
    deposit_transaction_id,
    deposit_transaction_vendor,
    interest_rate,
    notes,
    as_of_date, // deposit date
    parent_pikadon_id, // for rollover tracking
  } = payload;

  if (!account_id || !cost_basis || !as_of_date) {
    throw serviceError(400, 'account_id, cost_basis (principal), and as_of_date (deposit date) are required');
  }

  // Verify account exists
  const accountCheck = await database.query(
    'SELECT id FROM investment_accounts WHERE id = $1',
    [account_id]
  );
  if (accountCheck.rows.length === 0) {
    throw serviceError(404, 'Account not found');
  }

  // If parent_pikadon_id provided, verify it exists and mark as rolled_over
  if (parent_pikadon_id) {
    const parentCheck = await database.query(
      'SELECT id, status FROM investment_holdings WHERE id = $1 AND holding_type = $2',
      [parent_pikadon_id, 'pikadon']
    );
    if (parentCheck.rows.length === 0) {
      throw serviceError(404, 'Parent pikadon not found');
    }
    // Mark parent as rolled over
    await database.query(
      'UPDATE investment_holdings SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['rolled_over', parent_pikadon_id]
    );
  }

  // For a new pikadon, current_value starts equal to cost_basis (no interest yet)
  const current_value = cost_basis;

  const result = await database.query(
    `
    INSERT INTO investment_holdings (
      account_id, current_value, cost_basis, as_of_date,
      holding_type, deposit_transaction_id, deposit_transaction_vendor,
      maturity_date, interest_rate, status, notes, parent_pikadon_id
    ) VALUES ($1, $2, $3, $4, 'pikadon', $5, $6, $7, $8, 'active', $9, $10)
    RETURNING *
    `,
    [
      account_id,
      current_value,
      cost_basis,
      as_of_date,
      deposit_transaction_id || null,
      deposit_transaction_vendor || null,
      maturity_date || null,
      interest_rate || null,
      notes || null,
      parent_pikadon_id || null,
    ]
  );

  const row = result.rows[0];
  return {
    pikadon: {
      ...row,
      current_value: Number.parseFloat(row.current_value),
      cost_basis: Number.parseFloat(row.cost_basis),
      interest_earned: 0,
    },
  };
}

/**
 * Link a return transaction to a pikadon and mark as matured
 */
async function linkReturnTransaction(pikadonId, payload = {}) {
  const {
    return_transaction_id,
    return_transaction_vendor,
    return_amount, // total amount returned (principal + interest)
  } = payload;

  if (!return_transaction_id || !return_transaction_vendor || return_amount === undefined) {
    throw serviceError(400, 'return_transaction_id, return_transaction_vendor, and return_amount are required');
  }

  // Get the pikadon
  const pikadonResult = await database.query(
    'SELECT * FROM investment_holdings WHERE id = $1 AND holding_type = $2',
    [pikadonId, 'pikadon']
  );

  if (pikadonResult.rows.length === 0) {
    throw serviceError(404, 'Pikadon not found');
  }

  const pikadon = pikadonResult.rows[0];
  const interest_earned = return_amount - Number.parseFloat(pikadon.cost_basis);

  // Update the pikadon with return info
  const updateResult = await database.query(
    `
    UPDATE investment_holdings
    SET
      return_transaction_id = $1,
      return_transaction_vendor = $2,
      current_value = $3,
      status = 'matured',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $4
    RETURNING *
    `,
    [return_transaction_id, return_transaction_vendor, return_amount, pikadonId]
  );

  const row = updateResult.rows[0];
  return {
    pikadon: {
      ...row,
      current_value: Number.parseFloat(row.current_value),
      cost_basis: Number.parseFloat(row.cost_basis),
      interest_earned,
    },
  };
}

/**
 * Detect potential pikadon deposit/return pairs from transactions
 */
async function detectPikadonPairs(params = {}) {
  const { startDate, endDate, vendor } = params;

  // Build keyword pattern for SQL LIKE
  const keywordPatterns = PIKADON_KEYWORDS.map((k) => `%${k}%`);

  // Find potential deposit transactions (outgoing, negative price)
  let depositQuery = `
    SELECT
      t.identifier,
      t.vendor,
      t.date,
      t.name,
      t.price,
      t.memo,
      t.account_number
    FROM transactions t
    WHERE t.price < 0
      AND (
        ${keywordPatterns.map((_, i) => `LOWER(t.name) LIKE LOWER($${i + 1})`).join(' OR ')}
        OR ${keywordPatterns.map((_, i) => `LOWER(t.memo) LIKE LOWER($${i + 1})`).join(' OR ')}
      )
  `;

  const depositParams = [...keywordPatterns];
  let paramIndex = keywordPatterns.length + 1;

  if (startDate) {
    depositQuery += ` AND t.date >= $${paramIndex++}`;
    depositParams.push(startDate);
  }
  if (endDate) {
    depositQuery += ` AND t.date <= $${paramIndex++}`;
    depositParams.push(endDate);
  }
  if (vendor) {
    depositQuery += ` AND t.vendor = $${paramIndex++}`;
    depositParams.push(vendor);
  }

  depositQuery += ' ORDER BY t.date DESC';

  const depositResult = await database.query(depositQuery, depositParams);

  // Find potential return transactions (incoming, positive price)
  let returnQuery = `
    SELECT
      t.identifier,
      t.vendor,
      t.date,
      t.name,
      t.price,
      t.memo,
      t.account_number
    FROM transactions t
    WHERE t.price > 0
      AND (
        ${keywordPatterns.map((_, i) => `LOWER(t.name) LIKE LOWER($${i + 1})`).join(' OR ')}
        OR ${keywordPatterns.map((_, i) => `LOWER(t.memo) LIKE LOWER($${i + 1})`).join(' OR ')}
      )
  `;

  const returnParams = [...keywordPatterns];
  paramIndex = keywordPatterns.length + 1;

  if (startDate) {
    returnQuery += ` AND t.date >= $${paramIndex++}`;
    returnParams.push(startDate);
  }
  if (endDate) {
    returnQuery += ` AND t.date <= $${paramIndex++}`;
    returnParams.push(endDate);
  }
  if (vendor) {
    returnQuery += ` AND t.vendor = $${paramIndex++}`;
    returnParams.push(vendor);
  }

  returnQuery += ' ORDER BY t.date DESC';

  const returnResult = await database.query(returnQuery, returnParams);

  // Check which transactions are already linked to pikadon
  const linkedDeposits = await database.query(`
    SELECT deposit_transaction_id, deposit_transaction_vendor
    FROM investment_holdings
    WHERE holding_type = 'pikadon'
      AND deposit_transaction_id IS NOT NULL
  `);

  const linkedReturns = await database.query(`
    SELECT return_transaction_id, return_transaction_vendor
    FROM investment_holdings
    WHERE holding_type = 'pikadon'
      AND return_transaction_id IS NOT NULL
  `);

  const linkedDepositSet = new Set(
    linkedDeposits.rows.map((r) => `${r.deposit_transaction_id}|${r.deposit_transaction_vendor}`)
  );
  const linkedReturnSet = new Set(
    linkedReturns.rows.map((r) => `${r.return_transaction_id}|${r.return_transaction_vendor}`)
  );

  // Filter out already linked transactions
  const unlinkedDeposits = depositResult.rows.filter(
    (t) => !linkedDepositSet.has(`${t.identifier}|${t.vendor}`)
  );
  const unlinkedReturns = returnResult.rows.filter(
    (t) => !linkedReturnSet.has(`${t.identifier}|${t.vendor}`)
  );

  // Match deposits with returns
  const suggestions = [];

  for (const deposit of unlinkedDeposits) {
    const depositAmount = Math.abs(Number.parseFloat(deposit.price));
    const depositDate = new Date(deposit.date);

    // Find potential matching returns
    const matchingReturns = unlinkedReturns
      .filter((ret) => {
        const returnAmount = Number.parseFloat(ret.price);
        const returnDate = new Date(ret.date);

        // Return must be after deposit
        if (returnDate <= depositDate) return false;

        // Return should be within 13 months
        const monthsDiff = (returnDate - depositDate) / (1000 * 60 * 60 * 24 * 30);
        if (monthsDiff > 13) return false;

        // Return amount should be 100-115% of deposit (allowing for interest)
        const ratio = returnAmount / depositAmount;
        if (ratio < 1.0 || ratio > 1.15) return false;

        // Prefer same vendor
        return true;
      })
      .map((ret) => {
        const returnAmount = Number.parseFloat(ret.price);
        const interest = returnAmount - depositAmount;
        const interestRate = (interest / depositAmount) * 100;
        const returnDate = new Date(ret.date);
        const monthsDiff = (returnDate - depositDate) / (1000 * 60 * 60 * 24 * 30);

        // Calculate confidence score
        let confidence = 0.5;
        if (ret.vendor === deposit.vendor) confidence += 0.2;
        if (ret.account_number === deposit.account_number) confidence += 0.15;
        if (monthsDiff >= 1 && monthsDiff <= 12) confidence += 0.1;
        if (interestRate > 0 && interestRate < 10) confidence += 0.05;

        return {
          return_transaction: ret,
          return_amount: returnAmount,
          interest_earned: interest,
          interest_rate: interestRate,
          confidence: Math.min(confidence, 1.0),
        };
      })
      .sort((a, b) => b.confidence - a.confidence);

    suggestions.push({
      deposit_transaction: {
        ...deposit,
        price: Number.parseFloat(deposit.price),
      },
      deposit_amount: depositAmount,
      deposit_date: deposit.date,
      potential_returns: matchingReturns,
      best_match: matchingReturns[0] || null,
    });
  }

  // Also include unmatched returns (orphan returns)
  const matchedReturnIds = new Set();
  suggestions.forEach((s) => {
    s.potential_returns.forEach((r) => {
      matchedReturnIds.add(`${r.return_transaction.identifier}|${r.return_transaction.vendor}`);
    });
  });

  const orphanReturns = unlinkedReturns.filter(
    (r) => !matchedReturnIds.has(`${r.identifier}|${r.vendor}`)
  );

  // Detect potential rollovers: return followed by new deposit within 7 days
  const rolloverSuggestions = [];

  for (const suggestion of suggestions) {
    if (!suggestion.best_match) continue;

    const returnDate = new Date(suggestion.best_match.return_transaction.date);
    const returnAmount = suggestion.best_match.return_amount;

    // Find deposits that occur within 7 days after this return
    const potentialRollovers = unlinkedDeposits
      .filter((dep) => {
        const depDate = new Date(dep.date);
        const daysDiff = (depDate - returnDate) / (1000 * 60 * 60 * 24);

        // Deposit should be within 7 days after return
        if (daysDiff < 0 || daysDiff > 7) return false;

        // Different transaction than original deposit
        if (dep.identifier === suggestion.deposit_transaction.identifier &&
            dep.vendor === suggestion.deposit_transaction.vendor) return false;

        // Same vendor/account preferred
        return true;
      })
      .map((dep) => {
        const newDepositAmount = Math.abs(Number.parseFloat(dep.price));
        const depDate = new Date(dep.date);
        const daysDiff = (depDate - returnDate) / (1000 * 60 * 60 * 24);

        // Calculate reinvestment details
        const originalPrincipal = suggestion.deposit_amount;
        const interestEarned = suggestion.best_match.interest_earned;
        const interestReinvested = newDepositAmount - originalPrincipal;
        const interestWithdrawn = interestEarned - interestReinvested;

        // Calculate confidence for rollover
        let confidence = 0.5;
        if (dep.vendor === suggestion.deposit_transaction.vendor) confidence += 0.2;
        if (dep.account_number === suggestion.deposit_transaction.account_number) confidence += 0.15;
        if (daysDiff <= 3) confidence += 0.1;
        // Higher confidence if new deposit is close to return amount (most interest reinvested)
        if (Math.abs(newDepositAmount - returnAmount) / returnAmount < 0.05) confidence += 0.05;

        return {
          new_deposit_transaction: {
            ...dep,
            price: Number.parseFloat(dep.price),
          },
          new_deposit_amount: newDepositAmount,
          new_deposit_date: dep.date,
          days_after_return: Math.round(daysDiff),
          interest_reinvested: interestReinvested,
          interest_withdrawn: interestWithdrawn,
          confidence: Math.min(confidence, 1.0),
        };
      })
      .sort((a, b) => b.confidence - a.confidence);

    if (potentialRollovers.length > 0) {
      rolloverSuggestions.push({
        original_deposit: suggestion.deposit_transaction,
        original_deposit_amount: suggestion.deposit_amount,
        return_transaction: suggestion.best_match.return_transaction,
        return_amount: suggestion.best_match.return_amount,
        interest_earned: suggestion.best_match.interest_earned,
        potential_rollovers: potentialRollovers,
        best_rollover: potentialRollovers[0] || null,
      });
    }
  }

  return {
    suggestions,
    rollover_suggestions: rolloverSuggestions,
    unmatched_deposits: unlinkedDeposits.length,
    unmatched_returns: orphanReturns.length,
    orphan_returns: orphanReturns.map((r) => ({
      ...r,
      price: Number.parseFloat(r.price),
    })),
  };
}

/**
 * Update pikadon status (e.g., mark as rolled over)
 */
async function updatePikadonStatus(pikadonId, status) {
  const validStatuses = ['active', 'matured', 'rolled_over'];
  if (!validStatuses.includes(status)) {
    throw serviceError(400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  const result = await database.query(
    `
    UPDATE investment_holdings
    SET status = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2 AND holding_type = 'pikadon'
    RETURNING *
    `,
    [status, pikadonId]
  );

  if (result.rows.length === 0) {
    throw serviceError(404, 'Pikadon not found');
  }

  const row = result.rows[0];
  return {
    pikadon: {
      ...row,
      current_value: Number.parseFloat(row.current_value),
      cost_basis: Number.parseFloat(row.cost_basis),
      interest_earned: Number.parseFloat(row.current_value) - Number.parseFloat(row.cost_basis),
    },
  };
}

/**
 * Delete a pikadon holding
 */
async function deletePikadon(pikadonId) {
  const result = await database.query(
    'DELETE FROM investment_holdings WHERE id = $1 AND holding_type = $2 RETURNING *',
    [pikadonId, 'pikadon']
  );

  if (result.rows.length === 0) {
    throw serviceError(404, 'Pikadon not found');
  }

  return {
    message: 'Pikadon deleted',
    pikadon: result.rows[0],
  };
}

/**
 * Get pikadon interest income for analytics
 * Returns only the interest earned, not the principal
 */
async function getPikadonInterestIncome(params = {}) {
  const { startDate, endDate } = params;

  let query = `
    SELECT
      ih.id,
      ih.cost_basis as principal,
      ih.current_value as total_return,
      (ih.current_value - ih.cost_basis) as interest_earned,
      ih.as_of_date as deposit_date,
      ih.maturity_date,
      ih.return_transaction_id,
      ih.return_transaction_vendor,
      ia.account_name
    FROM investment_holdings ih
    JOIN investment_accounts ia ON ih.account_id = ia.id
    WHERE ih.holding_type = 'pikadon'
      AND ih.status = 'matured'
      AND ih.return_transaction_id IS NOT NULL
  `;

  const queryParams = [];
  let paramIndex = 1;

  if (startDate) {
    query += ` AND ih.maturity_date >= $${paramIndex++}`;
    queryParams.push(startDate);
  }
  if (endDate) {
    query += ` AND ih.maturity_date <= $${paramIndex++}`;
    queryParams.push(endDate);
  }

  query += ' ORDER BY ih.maturity_date DESC';

  const result = await database.query(query, queryParams);

  const maturedPikadon = result.rows.map((row) => ({
    ...row,
    principal: Number.parseFloat(row.principal),
    total_return: Number.parseFloat(row.total_return),
    interest_earned: Number.parseFloat(row.interest_earned),
  }));

  const totalInterest = maturedPikadon.reduce((sum, p) => sum + p.interest_earned, 0);

  return {
    matured_pikadon: maturedPikadon,
    total_interest_earned: totalInterest,
    count: maturedPikadon.length,
  };
}

/**
 * Rollover a matured pikadon into a new one
 * This links return transaction to old pikadon, marks it rolled_over,
 * and creates new pikadon linked to the old one
 */
async function rolloverPikadon(pikadonId, payload = {}) {
  const {
    return_transaction_id,
    return_transaction_vendor,
    return_amount, // total returned (principal + interest)
    new_principal, // principal for new pikadon (may include some interest reinvested)
    new_maturity_date,
    new_interest_rate,
    new_deposit_transaction_id,
    new_deposit_transaction_vendor,
    new_as_of_date, // deposit date for new pikadon
  } = payload;

  if (!return_transaction_id || !return_transaction_vendor || return_amount === undefined) {
    throw serviceError(400, 'return_transaction_id, return_transaction_vendor, and return_amount are required');
  }
  if (!new_principal || !new_as_of_date) {
    throw serviceError(400, 'new_principal and new_as_of_date are required for rollover');
  }

  // Get the original pikadon
  const pikadonResult = await database.query(
    'SELECT * FROM investment_holdings WHERE id = $1 AND holding_type = $2',
    [pikadonId, 'pikadon']
  );

  if (pikadonResult.rows.length === 0) {
    throw serviceError(404, 'Pikadon not found');
  }

  const oldPikadon = pikadonResult.rows[0];
  const old_principal = Number.parseFloat(oldPikadon.cost_basis);
  const interest_earned = return_amount - old_principal;
  const interest_reinvested = new_principal - old_principal;
  const interest_withdrawn = interest_earned - interest_reinvested;

  // Update old pikadon with return info and mark as rolled_over
  await database.query(
    `
    UPDATE investment_holdings
    SET
      return_transaction_id = $1,
      return_transaction_vendor = $2,
      current_value = $3,
      status = 'rolled_over',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $4
    `,
    [return_transaction_id, return_transaction_vendor, return_amount, pikadonId]
  );

  // Create new pikadon linked to the old one
  const newPikadonResult = await database.query(
    `
    INSERT INTO investment_holdings (
      account_id, current_value, cost_basis, as_of_date,
      holding_type, deposit_transaction_id, deposit_transaction_vendor,
      maturity_date, interest_rate, status, parent_pikadon_id
    ) VALUES ($1, $2, $3, $4, 'pikadon', $5, $6, $7, $8, 'active', $9)
    RETURNING *
    `,
    [
      oldPikadon.account_id,
      new_principal, // current_value = cost_basis for new pikadon
      new_principal,
      new_as_of_date,
      new_deposit_transaction_id || null,
      new_deposit_transaction_vendor || null,
      new_maturity_date || null,
      new_interest_rate || null,
      pikadonId, // link to parent
    ]
  );

  const newRow = newPikadonResult.rows[0];

  return {
    rollover: {
      old_pikadon_id: pikadonId,
      new_pikadon_id: newRow.id,
      old_principal,
      interest_earned,
      return_amount,
      new_principal: Number.parseFloat(newRow.cost_basis),
      interest_reinvested,
      interest_withdrawn,
    },
    old_pikadon: {
      ...oldPikadon,
      current_value: return_amount,
      status: 'rolled_over',
      interest_earned,
    },
    new_pikadon: {
      ...newRow,
      current_value: Number.parseFloat(newRow.current_value),
      cost_basis: Number.parseFloat(newRow.cost_basis),
      interest_earned: 0,
    },
  };
}

/**
 * Get the rollover chain for a pikadon (all ancestors and descendants)
 */
async function getRolloverChain(pikadonId) {
  // Get the starting pikadon
  const startResult = await database.query(
    `SELECT * FROM investment_holdings WHERE id = $1 AND holding_type = 'pikadon'`,
    [pikadonId]
  );

  if (startResult.rows.length === 0) {
    throw serviceError(404, 'Pikadon not found');
  }

  const chain = [];

  // Get all ancestors (traverse up via parent_pikadon_id)
  let currentId = startResult.rows[0].parent_pikadon_id;
  const ancestors = [];
  while (currentId) {
    const ancestorResult = await database.query(
      `SELECT * FROM investment_holdings WHERE id = $1`,
      [currentId]
    );
    if (ancestorResult.rows.length === 0) break;
    const ancestor = ancestorResult.rows[0];
    ancestors.unshift({
      ...ancestor,
      current_value: Number.parseFloat(ancestor.current_value),
      cost_basis: Number.parseFloat(ancestor.cost_basis),
      interest_earned: Number.parseFloat(ancestor.current_value) - Number.parseFloat(ancestor.cost_basis),
    });
    currentId = ancestor.parent_pikadon_id;
  }

  // Add ancestors to chain
  chain.push(...ancestors);

  // Add current pikadon
  const current = startResult.rows[0];
  chain.push({
    ...current,
    current_value: Number.parseFloat(current.current_value),
    cost_basis: Number.parseFloat(current.cost_basis),
    interest_earned: Number.parseFloat(current.current_value) - Number.parseFloat(current.cost_basis),
    is_current: true,
  });

  // Get all descendants (traverse down via parent_pikadon_id)
  const getDescendants = async (parentId) => {
    const childResult = await database.query(
      `SELECT * FROM investment_holdings WHERE parent_pikadon_id = $1 AND holding_type = 'pikadon'`,
      [parentId]
    );
    const descendants = [];
    for (const child of childResult.rows) {
      descendants.push({
        ...child,
        current_value: Number.parseFloat(child.current_value),
        cost_basis: Number.parseFloat(child.cost_basis),
        interest_earned: Number.parseFloat(child.current_value) - Number.parseFloat(child.cost_basis),
      });
      const furtherDescendants = await getDescendants(child.id);
      descendants.push(...furtherDescendants);
    }
    return descendants;
  };

  const descendants = await getDescendants(pikadonId);
  chain.push(...descendants);

  // Calculate summary
  const totalInterestEarned = chain.reduce((sum, p) => sum + p.interest_earned, 0);
  const originalPrincipal = chain.length > 0 ? chain[0].cost_basis : 0;
  const currentPrincipal = chain.length > 0 ? chain[chain.length - 1].cost_basis : 0;

  return {
    chain,
    summary: {
      chain_length: chain.length,
      original_principal: originalPrincipal,
      current_principal: currentPrincipal,
      total_interest_earned: totalInterestEarned,
      principal_growth: currentPrincipal - originalPrincipal,
    },
  };
}

/**
 * Get pikadon maturity breakdown for analytics
 * Shows principal returned, interest earned, and new deposits (for rollovers)
 */
async function getPikadonMaturityBreakdown(params = {}) {
  const { startDate, endDate } = params;

  let query = `
    SELECT
      ih.id,
      ih.cost_basis as principal,
      ih.current_value as total_return,
      (ih.current_value - ih.cost_basis) as interest_earned,
      ih.as_of_date as deposit_date,
      ih.maturity_date,
      ih.status,
      ih.parent_pikadon_id,
      ia.account_name,
      ia.institution,
      -- Get child pikadon info if rolled over
      child.id as child_pikadon_id,
      child.cost_basis as child_principal,
      child.as_of_date as child_deposit_date
    FROM investment_holdings ih
    JOIN investment_accounts ia ON ih.account_id = ia.id
    LEFT JOIN investment_holdings child ON child.parent_pikadon_id = ih.id AND child.holding_type = 'pikadon'
    WHERE ih.holding_type = 'pikadon'
      AND ih.status IN ('matured', 'rolled_over')
      AND ih.return_transaction_id IS NOT NULL
  `;

  const queryParams = [];
  let paramIndex = 1;

  if (startDate) {
    query += ` AND ih.maturity_date >= $${paramIndex++}`;
    queryParams.push(startDate);
  }
  if (endDate) {
    query += ` AND ih.maturity_date <= $${paramIndex++}`;
    queryParams.push(endDate);
  }

  query += ' ORDER BY ih.maturity_date DESC';

  const result = await database.query(query, queryParams);

  const maturities = result.rows.map((row) => {
    const principal = Number.parseFloat(row.principal);
    const totalReturn = Number.parseFloat(row.total_return);
    const interestEarned = Number.parseFloat(row.interest_earned);
    const childPrincipal = row.child_principal ? Number.parseFloat(row.child_principal) : null;

    return {
      id: row.id,
      account_name: row.account_name,
      institution: row.institution,
      deposit_date: row.deposit_date,
      maturity_date: row.maturity_date,
      status: row.status,
      // Core breakdown
      principal_returned: principal,
      interest_earned: interestEarned,
      total_return: totalReturn,
      // Rollover info
      is_rolled_over: row.status === 'rolled_over',
      child_pikadon_id: row.child_pikadon_id,
      new_deposit: childPrincipal,
      interest_reinvested: childPrincipal ? childPrincipal - principal : null,
      interest_withdrawn: childPrincipal ? interestEarned - (childPrincipal - principal) : interestEarned,
    };
  });

  // Calculate totals
  const totals = {
    total_principal_returned: 0,
    total_interest_earned: 0,
    total_return: 0,
    total_new_deposits: 0,
    total_interest_reinvested: 0,
    total_interest_withdrawn: 0,
    count: maturities.length,
  };

  maturities.forEach((m) => {
    totals.total_principal_returned += m.principal_returned;
    totals.total_interest_earned += m.interest_earned;
    totals.total_return += m.total_return;
    if (m.new_deposit) {
      totals.total_new_deposits += m.new_deposit;
      totals.total_interest_reinvested += m.interest_reinvested || 0;
    }
    totals.total_interest_withdrawn += m.interest_withdrawn;
  });

  return {
    maturities,
    totals,
  };
}

/**
 * SMART EVENT-BASED PIKADON DETECTION AND AUTO-SETUP
 * Groups transactions by date into maturity events and builds chains automatically
 */

/**
 * Auto-detect pikadon events from transactions
 * Groups by date and identifies: principal returns, interest, tax, and new deposits
 */
async function autoDetectPikadonEvents(params = {}) {
  const { startDate, endDate, vendor } = params;

  // Get all pikadon-related transactions
  const keywordConditions = PIKADON_KEYWORDS.map((_, i) => `LOWER(t.name) LIKE $${i + 1}`).join(' OR ');
  const keywordParams = PIKADON_KEYWORDS.map((k) => `%${k.toLowerCase()}%`);

  let query = `
    SELECT
      t.identifier,
      t.vendor,
      t.date,
      t.name,
      t.price,
      t.account_number
    FROM transactions t
    WHERE (${keywordConditions})
  `;

  const queryParams = [...keywordParams];
  let paramIndex = keywordParams.length + 1;

  if (startDate) {
    query += ` AND t.date >= $${paramIndex++}`;
    queryParams.push(startDate);
  }
  if (endDate) {
    query += ` AND t.date <= $${paramIndex++}`;
    queryParams.push(endDate);
  }
  if (vendor) {
    query += ` AND t.vendor = $${paramIndex++}`;
    queryParams.push(vendor);
  }

  query += ' ORDER BY t.date DESC, t.price DESC';

  const result = await database.query(query, queryParams);
  const transactions = result.rows;

  // Group transactions by date
  const eventsByDate = new Map();

  transactions.forEach((txn) => {
    const dateKey = txn.date.split('T')[0];
    if (!eventsByDate.has(dateKey)) {
      eventsByDate.set(dateKey, {
        date: dateKey,
        principal_returns: [],
        interest_earned: [],
        tax_paid: [],
        new_deposits: [],
        all_transactions: [],
      });
    }

    const event = eventsByDate.get(dateKey);
    event.all_transactions.push(txn);

    const price = Number.parseFloat(txn.price);
    const name = txn.name.toLowerCase();

    // Categorize transaction
    if (name.includes('פירעון') || name.includes('פרעון')) {
      event.principal_returns.push({ ...txn, amount: price });
    } else if (name.includes('רווח')) {
      event.interest_earned.push({ ...txn, amount: price });
    } else if (name.includes('מס') || name.includes('ניכוי')) {
      event.tax_paid.push({ ...txn, amount: price });
    } else if (name.includes('הפקדה')) {
      event.new_deposits.push({ ...txn, amount: Math.abs(price) });
    }
  });

  // Build maturity events (dates with principal + interest)
  const maturityEvents = [];
  const depositEvents = [];

  for (const [dateKey, event] of eventsByDate) {
    const totalPrincipal = event.principal_returns.reduce((sum, t) => sum + t.amount, 0);
    const totalInterest = event.interest_earned.reduce((sum, t) => sum + t.amount, 0);
    const totalTax = event.tax_paid.reduce((sum, t) => sum + t.amount, 0);
    const totalDeposits = event.new_deposits.reduce((sum, t) => sum + t.amount, 0);

    if (totalPrincipal > 0) {
      // This is a maturity event
      const netReceived = totalPrincipal + totalInterest + totalTax; // tax is negative
      const isRollover = totalDeposits > 0;
      const cashFlow = netReceived - totalDeposits;

      maturityEvents.push({
        date: dateKey,
        principal_returned: totalPrincipal,
        interest_earned: totalInterest,
        tax_paid: Math.abs(totalTax),
        net_received: netReceived,
        rolled_over: isRollover,
        new_deposit_amount: totalDeposits,
        cash_flow: cashFlow, // positive = withdrawn, negative = added
        transactions: event.all_transactions,
        deposit_transactions: event.new_deposits,
        return_transactions: event.principal_returns,
        interest_transactions: event.interest_earned,
        tax_transactions: event.tax_paid,
      });
    } else if (totalDeposits > 0) {
      // Deposit-only event (no maturity on this date)
      event.new_deposits.forEach((dep) => {
        depositEvents.push({
          date: dateKey,
          amount: dep.amount,
          name: dep.name,
          transaction: dep,
          type: categorizeDepositType(dep.name),
        });
      });
    }
  }

  // Match deposits to maturities to build chains
  const chains = buildPikadonChains(maturityEvents, depositEvents);

  // Calculate totals
  const totals = {
    total_interest_earned: maturityEvents.reduce((sum, e) => sum + e.interest_earned, 0),
    total_tax_paid: maturityEvents.reduce((sum, e) => sum + e.tax_paid, 0),
    total_principal_returned: maturityEvents.reduce((sum, e) => sum + e.principal_returned, 0),
    maturity_count: maturityEvents.length,
    active_deposits: chains.active_deposits,
    total_active_principal: chains.active_deposits.reduce((sum, d) => sum + d.amount, 0),
  };

  return {
    maturity_events: maturityEvents,
    deposit_events: depositEvents,
    chains: chains.chains,
    active_deposits: chains.active_deposits,
    totals,
  };
}

/**
 * Categorize deposit by type based on name
 */
function categorizeDepositType(name) {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('מפתח')) return 'recurring';
  if (lowerName.includes('נזיל') || lowerName.includes('יומי')) return 'liquid';
  if (lowerName.includes('קבועה') || lowerName.includes('חודש')) return 'fixed_term';
  if (lowerName.includes('משתנה')) return 'variable';
  return 'other';
}

/**
 * Build pikadon chains by matching deposits to maturities
 */
function buildPikadonChains(maturityEvents, depositEvents) {
  const chains = [];
  const usedDeposits = new Set();

  // Sort events by date
  maturityEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
  depositEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

  // For each maturity, find the deposit that started it
  for (const maturity of maturityEvents) {
    // Find deposit that matches this maturity (same amount, before maturity date)
    const matchingDeposit = depositEvents.find((dep) => {
      if (usedDeposits.has(dep.transaction.identifier)) return false;
      const depDate = new Date(dep.date);
      const matDate = new Date(maturity.date);
      // Deposit should be before maturity
      if (depDate >= matDate) return false;
      // Amount should be similar (within 5%)
      const diff = Math.abs(dep.amount - maturity.principal_returned) / maturity.principal_returned;
      return diff < 0.05;
    });

    if (matchingDeposit) {
      usedDeposits.add(matchingDeposit.transaction.identifier);

      // Check if this maturity rolled over to a new deposit
      let rolloverDeposit = null;
      if (maturity.rolled_over && maturity.deposit_transactions.length > 0) {
        // Find the largest deposit on the maturity date (the main rollover)
        const mainRollover = maturity.deposit_transactions.reduce((max, dep) =>
          dep.amount > max.amount ? dep : max
        );
        usedDeposits.add(mainRollover.identifier);
        rolloverDeposit = {
          date: maturity.date,
          amount: mainRollover.amount,
          name: mainRollover.name,
          transaction: mainRollover,
          type: categorizeDepositType(mainRollover.name),
        };
      }

      chains.push({
        start_deposit: matchingDeposit,
        maturity_event: maturity,
        rollover_deposit: rolloverDeposit,
        interest_earned: maturity.interest_earned,
        tax_paid: maturity.tax_paid,
        net_gain: maturity.interest_earned - maturity.tax_paid,
      });
    }
  }

  // Active deposits = deposits not used in any chain
  const activeDeposits = depositEvents
    .filter((dep) => !usedDeposits.has(dep.transaction.identifier))
    .concat(
      // Also include rollover deposits from the latest maturity in each chain
      chains
        .filter((c) => c.rollover_deposit)
        .map((c) => c.rollover_deposit)
    );

  return { chains, active_deposits: activeDeposits };
}

/**
 * One-click auto-setup: Create all pikadon entries from detected events
 * Also marks related transactions and creates synthetic interest income entries
 */
async function autoSetupPikadon(accountId, params = {}) {
  if (!accountId) {
    throw serviceError(400, 'account_id is required');
  }

  // Verify account exists and get account name
  const accountCheck = await database.query(
    'SELECT id, account_name FROM investment_accounts WHERE id = $1',
    [accountId]
  );
  if (accountCheck.rows.length === 0) {
    throw serviceError(404, 'Account not found');
  }
  const accountName = accountCheck.rows[0].account_name;

  // Get detected events
  const detected = await autoDetectPikadonEvents(params);

  if (detected.chains.length === 0 && detected.active_deposits.length === 0) {
    return {
      created: 0,
      message: 'No pikadon transactions found to setup',
    };
  }

  const created = [];
  const interestIncomeCreated = [];
  const transactionsToMark = []; // Collect all transaction IDs to mark as pikadon-related

  // Process chains in chronological order
  for (const chain of detected.chains) {
    // Collect all transactions from this chain to mark
    chain.maturity_event.transactions.forEach((txn) => {
      transactionsToMark.push({ identifier: txn.identifier, vendor: txn.vendor });
    });
    transactionsToMark.push({
      identifier: chain.start_deposit.transaction.identifier,
      vendor: chain.start_deposit.transaction.vendor,
    });

    // Create the initial deposit
    const depositResult = await database.query(
      `
      INSERT INTO investment_holdings (
        account_id, current_value, cost_basis, as_of_date,
        holding_type, deposit_transaction_id, deposit_transaction_vendor,
        maturity_date, status, notes
      ) VALUES ($1, $2, $3, $4, 'pikadon', $5, $6, $7, $8, $9)
      RETURNING id
      `,
      [
        accountId,
        chain.maturity_event.principal_returned + chain.maturity_event.interest_earned,
        chain.start_deposit.amount,
        chain.start_deposit.date,
        chain.start_deposit.transaction.identifier,
        chain.start_deposit.transaction.vendor,
        chain.maturity_event.date,
        chain.rollover_deposit ? 'rolled_over' : 'matured',
        `Auto-created: ${chain.start_deposit.name}`,
      ]
    );

    const pikadonId = depositResult.rows[0].id;

    // Link the return transaction
    await database.query(
      `
      UPDATE investment_holdings
      SET
        return_transaction_id = $1,
        return_transaction_vendor = $2,
        interest_rate = $3
      WHERE id = $4
      `,
      [
        chain.maturity_event.return_transactions[0]?.identifier,
        chain.maturity_event.return_transactions[0]?.vendor,
        (chain.interest_earned / chain.start_deposit.amount) * 100,
        pikadonId,
      ]
    );

    // Create synthetic interest income transaction
    const netInterest = chain.interest_earned - chain.tax_paid;
    if (netInterest > 0) {
      const interestIdentifier = `pikadon_interest_${pikadonId}_${Date.now()}`;

      // Get the Investment Interest category ID
      const categoryResult = await database.query(
        `SELECT id FROM category_definitions WHERE name = 'ריבית מהשקעות' AND category_type = 'income' LIMIT 1`
      );
      const investmentInterestCategoryId = categoryResult.rows[0]?.id || null;

      await database.query(
        `
        INSERT INTO transactions (
          identifier, vendor, date, name, price, type, status,
          memo, category_type, is_pikadon_related, category_definition_id
        ) VALUES ($1, $2, $3, $4, $5, 'normal', 'completed', $6, 'income', 0, $7)
        `,
        [
          interestIdentifier,
          'pikadon_interest',
          chain.maturity_event.date,
          `ריבית פיקדון - ${accountName}`,
          netInterest,
          `Pikadon interest (gross: ${chain.interest_earned}, tax: ${chain.tax_paid})`,
          investmentInterestCategoryId,
        ]
      );

      interestIncomeCreated.push({
        identifier: interestIdentifier,
        amount: netInterest,
        date: chain.maturity_event.date,
        gross_interest: chain.interest_earned,
        tax_paid: chain.tax_paid,
      });
    }

    created.push({
      id: pikadonId,
      type: 'matured',
      amount: chain.start_deposit.amount,
      interest: chain.interest_earned,
      date: chain.start_deposit.date,
    });

    // If rolled over, create the new deposit linked to the old one
    if (chain.rollover_deposit) {
      transactionsToMark.push({
        identifier: chain.rollover_deposit.transaction.identifier,
        vendor: chain.rollover_deposit.transaction.vendor,
      });

      const rolloverResult = await database.query(
        `
        INSERT INTO investment_holdings (
          account_id, current_value, cost_basis, as_of_date,
          holding_type, deposit_transaction_id, deposit_transaction_vendor,
          status, parent_pikadon_id, notes
        ) VALUES ($1, $2, $3, $4, 'pikadon', $5, $6, 'active', $7, $8)
        RETURNING id
        `,
        [
          accountId,
          chain.rollover_deposit.amount,
          chain.rollover_deposit.amount,
          chain.rollover_deposit.date,
          chain.rollover_deposit.transaction.identifier,
          chain.rollover_deposit.transaction.vendor,
          pikadonId,
          `Auto-created rollover: ${chain.rollover_deposit.name}`,
        ]
      );

      created.push({
        id: rolloverResult.rows[0].id,
        type: 'active_rollover',
        amount: chain.rollover_deposit.amount,
        date: chain.rollover_deposit.date,
        parent_id: pikadonId,
      });
    }
  }

  // Create standalone active deposits (not part of any chain)
  for (const deposit of detected.active_deposits) {
    // Skip if already created as part of a chain
    const alreadyCreated = created.some(
      (c) => c.type === 'active_rollover' &&
             deposit.transaction &&
             c.date === deposit.date
    );
    if (alreadyCreated) continue;

    if (deposit.transaction) {
      transactionsToMark.push({
        identifier: deposit.transaction.identifier,
        vendor: deposit.transaction.vendor,
      });
    }

    const result = await database.query(
      `
      INSERT INTO investment_holdings (
        account_id, current_value, cost_basis, as_of_date,
        holding_type, deposit_transaction_id, deposit_transaction_vendor,
        status, notes
      ) VALUES ($1, $2, $3, $4, 'pikadon', $5, $6, 'active', $7)
      RETURNING id
      `,
      [
        accountId,
        deposit.amount,
        deposit.amount,
        deposit.date,
        deposit.transaction?.identifier,
        deposit.transaction?.vendor,
        `Auto-created: ${deposit.name || 'Standalone deposit'}`,
      ]
    );

    created.push({
      id: result.rows[0].id,
      type: 'active_standalone',
      amount: deposit.amount,
      date: deposit.date,
    });
  }

  // Mark all related transactions as pikadon-related
  for (const txn of transactionsToMark) {
    if (txn.identifier && txn.vendor) {
      await database.query(
        `UPDATE transactions SET is_pikadon_related = 1 WHERE identifier = $1 AND vendor = $2`,
        [txn.identifier, txn.vendor]
      );
    }
  }

  return {
    created: created.length,
    details: created,
    totals: detected.totals,
    interest_income_created: interestIncomeCreated,
    transactions_marked: transactionsToMark.length,
  };
}

module.exports = {
  listPikadon,
  getPikadonSummary,
  createPikadon,
  linkReturnTransaction,
  detectPikadonPairs,
  updatePikadonStatus,
  deletePikadon,
  getPikadonInterestIncome,
  rolloverPikadon,
  getRolloverChain,
  getPikadonMaturityBreakdown,
  autoDetectPikadonEvents,
  autoSetupPikadon,
  PIKADON_KEYWORDS,
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
