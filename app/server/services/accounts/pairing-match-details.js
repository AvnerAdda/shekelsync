const actualDatabase = require('../database.js');
const actualAutoPairingService = require('./auto-pairing.js');

const DEFAULT_MONTHS_BACK = 6;
const DEFAULT_MAX_CYCLES = 6;
const MAX_MONTHS_BACK = 36;
const MATCHED_TOLERANCE = 2;
const PENDING_SCAN_WINDOW_DAYS = 45;
const PENDING_CYCLE_MAX_LOOKAHEAD_DAYS = 40;

let database = actualDatabase;
let autoPairingService = actualAutoPairingService;

function roundCurrency(value) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * 100) / 100;
}

function makeCompositeKey(identifier, vendor) {
  return `${String(identifier || '')}::${String(vendor || '')}`;
}

function toAgorot(amount) {
  return Math.round(Math.abs(Number.parseFloat(amount) || 0) * 100);
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function subtractDays(isoDate, days) {
  const date = toIsoDate(isoDate);
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function diffDays(laterIsoDate, earlierIsoDate) {
  const later = laterIsoDate ? new Date(`${laterIsoDate.slice(0, 10)}T00:00:00Z`) : null;
  const earlier = earlierIsoDate ? new Date(`${earlierIsoDate.slice(0, 10)}T00:00:00Z`) : null;
  if (!later || !earlier || Number.isNaN(later.getTime()) || Number.isNaN(earlier.getTime())) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.floor((later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000));
}

function findCycleForPendingTransactionDate(txnDate, cycleDatesAsc) {
  const normalizedTxnDate = toIsoDate(txnDate);
  if (!normalizedTxnDate) {
    return null;
  }

  for (const cycleDate of cycleDatesAsc) {
    if (cycleDate < normalizedTxnDate) {
      continue;
    }

    const daysAhead = diffDays(cycleDate, normalizedTxnDate);
    if (daysAhead <= PENDING_CYCLE_MAX_LOOKAHEAD_DAYS) {
      return cycleDate;
    }
  }

  return null;
}

function normalizePairing(row) {
  return {
    id: row.id,
    creditCardVendor: row.credit_card_vendor,
    creditCardAccountNumber: row.credit_card_account_number,
    bankVendor: row.bank_vendor,
    bankAccountNumber: row.bank_account_number,
    matchPatterns: row.match_patterns ? JSON.parse(row.match_patterns) : [],
    isActive: Boolean(row.is_active),
    discrepancyAcknowledged: Boolean(row.discrepancy_acknowledged),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getInClausePlaceholders(values, startIndex = 1) {
  return values.map((_, idx) => `$${startIndex + idx}`).join(', ');
}

function parseStrictPositiveInteger(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildSummary(cycles) {
  const summary = {
    cyclesCount: cycles.length,
    repaymentCount: 0,
    cardTransactionCount: 0,
    totalBankAmount: 0,
    totalCardAmount: 0,
    totalMatchedAmount: 0,
    totalRemainingAmount: 0,
    statusCounts: {
      matched: 0,
      partial: 0,
      unmatched: 0,
      ambiguous: 0,
    },
  };

  for (const cycle of cycles) {
    summary.cardTransactionCount += (cycle.cardTransactions || []).length;

    for (const cardTxn of cycle.cardTransactions || []) {
      summary.totalCardAmount += Math.abs(Number.parseFloat(cardTxn.price) || 0);
    }

    for (const repayment of cycle.repayments || []) {
      summary.repaymentCount += 1;
      summary.totalBankAmount += repayment.absAmount;
      summary.totalMatchedAmount += repayment.matchedAmount;
      summary.totalRemainingAmount += repayment.remainingAmount;
      if (summary.statusCounts[repayment.status] !== undefined) {
        summary.statusCounts[repayment.status] += 1;
      }
    }
  }

  summary.totalBankAmount = roundCurrency(summary.totalBankAmount);
  summary.totalCardAmount = roundCurrency(summary.totalCardAmount);
  summary.totalMatchedAmount = roundCurrency(summary.totalMatchedAmount);
  summary.totalRemainingAmount = roundCurrency(summary.totalRemainingAmount);

  return summary;
}

async function getSharedPairingsMeta(client, repayments) {
  const map = new Map();
  if (!repayments.length) {
    return map;
  }

  const identifiers = Array.from(new Set(repayments.map((repayment) => repayment.identifier).filter(Boolean)));
  const vendors = Array.from(new Set(repayments.map((repayment) => repayment.vendor).filter(Boolean)));

  if (!identifiers.length || !vendors.length) {
    return map;
  }

  const idPlaceholders = getInClausePlaceholders(identifiers, 1);
  const vendorPlaceholders = getInClausePlaceholders(vendors, identifiers.length + 1);
  const params = [...identifiers, ...vendors];

  const result = await client.query(
    `
      SELECT
        transaction_identifier,
        transaction_vendor,
        COUNT(DISTINCT pairing_id) AS shared_pairings_count,
        GROUP_CONCAT(DISTINCT pairing_id) AS pairing_ids
      FROM transaction_pairing_exclusions
      WHERE transaction_identifier IN (${idPlaceholders})
        AND transaction_vendor IN (${vendorPlaceholders})
      GROUP BY transaction_identifier, transaction_vendor
    `,
    params,
  );

  for (const row of result.rows || []) {
    const pairingIds = String(row.pairing_ids || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => Number.parseInt(entry, 10))
      .filter(Number.isFinite);

    map.set(
      makeCompositeKey(row.transaction_identifier, row.transaction_vendor),
      {
        sharedPairingsCount: Number.parseInt(row.shared_pairings_count, 10) || 0,
        pairingIds,
      },
    );
  }

  return map;
}

async function getCardTransactionsByCycle(client, pairing, cycleDates) {
  const map = new Map();
  if (!cycleDates.length) {
    return map;
  }

  const params = [pairing.creditCardVendor];
  const cycleDatePlaceholders = getInClausePlaceholders(cycleDates, 2);
  params.push(...cycleDates);

  let accountFilter = '';
  if (pairing.creditCardAccountNumber) {
    params.push(pairing.creditCardAccountNumber);
    accountFilter = `AND t.account_number = $${params.length}`;
  }

  const result = await client.query(
    `
      SELECT
        t.identifier,
        t.vendor,
        t.account_number,
        t.date,
        t.processed_date,
        t.name,
        t.price,
        substr(COALESCE(t.processed_date, t.date), 1, 10) AS cycle_date
      FROM transactions t
      WHERE t.vendor = $1
        AND t.status = 'completed'
        AND substr(COALESCE(t.processed_date, t.date), 1, 10) IN (${cycleDatePlaceholders})
        ${accountFilter}
      ORDER BY cycle_date DESC, t.date DESC, t.identifier DESC
    `,
    params,
  );

  for (const row of result.rows || []) {
    const cycleDate = row.cycle_date;
    if (!map.has(cycleDate)) {
      map.set(cycleDate, []);
    }

    map.get(cycleDate).push({
      identifier: row.identifier,
      vendor: row.vendor,
      accountNumber: row.account_number,
      date: row.date,
      processedDate: row.processed_date,
      cycleDate,
      name: row.name,
      price: roundCurrency(row.price),
      absAmount: roundCurrency(Math.abs(Number.parseFloat(row.price) || 0)),
    });
  }

  return map;
}

async function getPendingCardTotalsByCycle(client, pairing, cycleDates) {
  const map = new Map();
  if (!cycleDates.length) {
    return map;
  }

  const cycleDatesAsc = Array.from(new Set(cycleDates.map(toIsoDate).filter(Boolean))).sort();
  if (!cycleDatesAsc.length) {
    return map;
  }
  const cycleDatesSet = new Set(cycleDatesAsc);
  const oldestCycleDate = cycleDatesAsc[0];
  const newestCycleDate = cycleDatesAsc[cycleDatesAsc.length - 1];
  const scanStartDate = subtractDays(oldestCycleDate, PENDING_SCAN_WINDOW_DAYS) || oldestCycleDate;

  const params = [pairing.creditCardVendor, scanStartDate, newestCycleDate];

  let accountFilter = '';
  if (pairing.creditCardAccountNumber) {
    params.push(pairing.creditCardAccountNumber);
    accountFilter = `AND t.account_number = $${params.length}`;
  }

  const result = await client.query(
    `
      SELECT
        t.identifier,
        substr(t.date, 1, 10) AS txn_date,
        substr(COALESCE(t.processed_date, t.date), 1, 10) AS hinted_cycle_date,
        t.price
      FROM transactions t
      WHERE t.vendor = $1
        AND t.status = 'pending'
        AND t.price < 0
        AND substr(t.date, 1, 10) >= $2
        AND substr(t.date, 1, 10) <= $3
        ${accountFilter}
    `,
    params,
  );

  for (const row of result.rows || []) {
    const hintedCycleDate = toIsoDate(row.hinted_cycle_date);
    const targetCycleDate = hintedCycleDate && cycleDatesSet.has(hintedCycleDate)
      ? hintedCycleDate
      : findCycleForPendingTransactionDate(row.txn_date, cycleDatesAsc);

    if (!targetCycleDate) {
      continue;
    }

    const current = map.get(targetCycleDate) || {
      pendingCardDelta: 0,
      pendingTransactionCount: 0,
    };

    map.set(targetCycleDate, {
      pendingCardDelta: roundCurrency(current.pendingCardDelta + Math.abs(Number.parseFloat(row.price) || 0)),
      pendingTransactionCount: current.pendingTransactionCount + 1,
    });
  }

  return map;
}

function classifyRepaymentStatus({ sharedPairingsCount, remainingAmount, matchedAmount }) {
  if ((sharedPairingsCount || 0) > 1) {
    return 'ambiguous';
  }
  if (remainingAmount <= MATCHED_TOLERANCE) {
    return 'matched';
  }
  if (matchedAmount > 0.01) {
    return 'partial';
  }
  return 'unmatched';
}

function applyInferredAmountCycleMatches(repayments, cardTransactions) {
  const nextRepayments = repayments.map((repayment) => ({ ...repayment }));
  const nextCardTransactions = cardTransactions.map((cardTxn) => ({ ...cardTxn }));

  const availableCardTxnIndexesByAmount = new Map();
  for (let idx = 0; idx < nextCardTransactions.length; idx += 1) {
    const cardTxn = nextCardTransactions[idx];
    const alreadyLinked = Number.parseInt(cardTxn.linkedRepaymentCount, 10) > 0;
    const isExpense = Number.parseFloat(cardTxn.price) < 0;
    if (alreadyLinked || !isExpense) {
      continue;
    }

    const amountKey = toAgorot(cardTxn.price);
    if (!availableCardTxnIndexesByAmount.has(amountKey)) {
      availableCardTxnIndexesByAmount.set(amountKey, []);
    }
    availableCardTxnIndexesByAmount.get(amountKey).push(idx);
  }

  for (let repaymentIdx = 0; repaymentIdx < nextRepayments.length; repaymentIdx += 1) {
    const repayment = nextRepayments[repaymentIdx];
    const alreadyLinked = Number.parseInt(repayment.linkedExpenseCount, 10) > 0;

    if (alreadyLinked) {
      continue;
    }

    const amountKey = toAgorot(repayment.absAmount);
    const candidateIndexes = (availableCardTxnIndexesByAmount.get(amountKey) || []).filter((cardTxnIdx) => {
      const cardTxn = nextCardTransactions[cardTxnIdx];
      return Number.parseInt(cardTxn.linkedRepaymentCount, 10) === 0;
    });

    if (candidateIndexes.length === 1) {
      const cardTxnIdx = candidateIndexes[0];
      const cardTxn = nextCardTransactions[cardTxnIdx];

      nextRepayments[repaymentIdx] = {
        ...repayment,
        matchedAmount: roundCurrency(repayment.absAmount),
        remainingAmount: 0,
        linkedExpenseCount: 1,
        linkedExpenseTxnIds: [cardTxn.identifier],
        status: 'matched',
        matchSource: 'inferred_amount_cycle',
      };

      nextCardTransactions[cardTxnIdx] = {
        ...cardTxn,
        linkedRepaymentCount: 1,
        linkedRepaymentIds: [repayment.identifier],
        isLinked: true,
        linkMethod: 'inferred_amount_cycle',
      };
      continue;
    }

    if (candidateIndexes.length > 1 && repayment.status === 'unmatched') {
      nextRepayments[repaymentIdx] = {
        ...repayment,
        status: 'ambiguous',
      };
    }
  }

  // Bundle matching fallback:
  // If one unlinked repayment remains and multiple unlinked expense rows in the cycle
  // sum exactly to that repayment, infer a bundled match for the selected pairing.
  const bundleCandidateRepaymentIndexes = nextRepayments
    .map((repayment, idx) => ({ repayment, idx }))
    .filter(({ repayment }) =>
      (repayment.status === 'ambiguous' || repayment.status === 'unmatched')
      && Number.parseInt(repayment.linkedExpenseCount, 10) === 0
    )
    .map(({ idx }) => idx);

  const unlinkedExpenseIndexes = nextCardTransactions
    .map((cardTxn, idx) => ({ cardTxn, idx }))
    .filter(({ cardTxn }) =>
      Number.parseFloat(cardTxn.price) < 0
      && Number.parseInt(cardTxn.linkedRepaymentCount, 10) === 0
    )
    .map(({ idx }) => idx);

  if (bundleCandidateRepaymentIndexes.length === 1 && unlinkedExpenseIndexes.length >= 2) {
    const repaymentIdx = bundleCandidateRepaymentIndexes[0];
    const repayment = nextRepayments[repaymentIdx];
    const bundledAmount = roundCurrency(
      unlinkedExpenseIndexes.reduce((sum, cardTxnIdx) => {
        const cardTxn = nextCardTransactions[cardTxnIdx];
        return sum + Math.abs(Number.parseFloat(cardTxn.price) || 0);
      }, 0),
    );
    const remainingAmount = roundCurrency(Math.max(0, repayment.absAmount - bundledAmount));

    if (remainingAmount <= MATCHED_TOLERANCE) {
      const linkedExpenseTxnIds = unlinkedExpenseIndexes.map((cardTxnIdx) => nextCardTransactions[cardTxnIdx].identifier);

      nextRepayments[repaymentIdx] = {
        ...repayment,
        matchedAmount: bundledAmount,
        remainingAmount,
        linkedExpenseCount: unlinkedExpenseIndexes.length,
        linkedExpenseTxnIds,
        status: 'matched',
        matchSource: 'inferred_amount_cycle',
      };

      for (const cardTxnIdx of unlinkedExpenseIndexes) {
        const cardTxn = nextCardTransactions[cardTxnIdx];
        nextCardTransactions[cardTxnIdx] = {
          ...cardTxn,
          linkedRepaymentCount: 1,
          linkedRepaymentIds: [repayment.identifier],
          isLinked: true,
          linkMethod: 'inferred_amount_cycle',
        };
      }
    }
  }

  return {
    repayments: nextRepayments,
    cardTransactions: nextCardTransactions,
  };
}

function validatePairingMatchParams({ pairingId, monthsBack, cycleDate }) {
  if (!Number.isInteger(pairingId) || pairingId <= 0) {
    const error = new Error('pairingId must be a positive integer');
    error.status = 400;
    throw error;
  }

  if (!Number.isInteger(monthsBack) || monthsBack <= 0) {
    const error = new Error('monthsBack must be a positive integer');
    error.status = 400;
    throw error;
  }
  if (monthsBack > MAX_MONTHS_BACK) {
    const error = new Error(`monthsBack must be less than or equal to ${MAX_MONTHS_BACK}`);
    error.status = 400;
    throw error;
  }

  if (cycleDate && !/^\d{4}-\d{2}-\d{2}$/.test(cycleDate)) {
    const error = new Error('cycleDate must be in YYYY-MM-DD format');
    error.status = 400;
    throw error;
  }
}

async function getPairingMatchDetails(params = {}) {
  const pairingId = parseStrictPositiveInteger(params.pairingId);
  const monthsBack = params.monthsBack !== undefined
    ? parseStrictPositiveInteger(params.monthsBack)
    : DEFAULT_MONTHS_BACK;
  const cycleDate = params.cycleDate ? String(params.cycleDate).trim() : null;

  validatePairingMatchParams({ pairingId, monthsBack, cycleDate });

  const client = await database.getClient();
  const startedAt = Date.now();

  try {
    const pairingResult = await client.query(
      `
        SELECT
          id,
          credit_card_vendor,
          credit_card_account_number,
          bank_vendor,
          bank_account_number,
          match_patterns,
          is_active,
          discrepancy_acknowledged,
          created_at,
          updated_at
        FROM account_pairings
        WHERE id = $1
      `,
      [pairingId],
    );

    if (!pairingResult.rows.length) {
      const error = new Error('Pairing not found');
      error.status = 404;
      throw error;
    }

    const pairing = normalizePairing(pairingResult.rows[0]);

    const discrepancy = await autoPairingService.calculateDiscrepancy({
      pairingId,
      bankVendor: pairing.bankVendor,
      bankAccountNumber: pairing.bankAccountNumber,
      ccVendor: pairing.creditCardVendor,
      ccAccountNumber: pairing.creditCardAccountNumber,
      monthsBack,
    });

    const baseCycles = Array.isArray(discrepancy?.cycles)
      ? discrepancy.cycles
      : [];

    let scopedCycles = baseCycles;
    if (cycleDate) {
      scopedCycles = scopedCycles.filter((cycle) => cycle.cycleDate === cycleDate);
    } else {
      scopedCycles = scopedCycles.slice(0, DEFAULT_MAX_CYCLES);
    }

    const repayments = scopedCycles.flatMap((cycle) =>
      (cycle.repayments || []).map((repayment) => ({
        identifier: repayment.identifier,
        vendor: repayment.vendor,
      }))
    );

    const sharedPairingsMeta = await getSharedPairingsMeta(client, repayments);

    const cycleDates = scopedCycles
      .map((cycle) => cycle.cycleDate)
      .filter(Boolean);

    const cardTransactionsByCycle = await getCardTransactionsByCycle(client, pairing, cycleDates);
    const pendingCardTotalsByCycle = await getPendingCardTotalsByCycle(client, pairing, cycleDates);

    const cycles = scopedCycles.map((cycle) => {
      const enrichedRepayments = (cycle.repayments || []).map((repayment) => {
        const key = makeCompositeKey(repayment.identifier, repayment.vendor);
        const matchMeta = {
          matchedAmount: 0,
          linkedExpenseCount: 0,
          linkedExpenseTxnIds: [],
        };
        const sharedMeta = sharedPairingsMeta.get(key) || {
          sharedPairingsCount: 0,
          pairingIds: [],
        };

        const absAmount = roundCurrency(Math.abs(Number.parseFloat(repayment.price) || 0));
        const remainingAmount = roundCurrency(Math.max(0, absAmount - matchMeta.matchedAmount));
        const status = classifyRepaymentStatus({
          sharedPairingsCount: sharedMeta.sharedPairingsCount,
          remainingAmount,
          matchedAmount: matchMeta.matchedAmount,
        });

        return {
          identifier: repayment.identifier,
          vendor: repayment.vendor,
          accountNumber: repayment.accountNumber || null,
          date: repayment.date,
          cycleDate: cycle.cycleDate,
          name: repayment.name,
          price: roundCurrency(repayment.price),
          absAmount,
          matchedAmount: roundCurrency(matchMeta.matchedAmount),
          remainingAmount,
          linkedExpenseCount: matchMeta.linkedExpenseCount,
          linkedExpenseTxnIds: matchMeta.linkedExpenseTxnIds,
          sharedPairingsCount: sharedMeta.sharedPairingsCount,
          sharedPairingIds: sharedMeta.pairingIds,
          status,
          matchSource: 'none',
        };
      });

      const enrichedCardTransactions = (cardTransactionsByCycle.get(cycle.cycleDate) || []).map((cardTxn) => {
        const linkMeta = {
          linkedRepaymentCount: 0,
          linkedRepaymentIds: [],
        };

        return {
          ...cardTxn,
          linkedRepaymentCount: linkMeta.linkedRepaymentCount,
          linkedRepaymentIds: linkMeta.linkedRepaymentIds,
          isLinked: linkMeta.linkedRepaymentCount > 0,
          linkMethod: 'none',
        };
      });

      const inferredMatches = applyInferredAmountCycleMatches(
        enrichedRepayments,
        enrichedCardTransactions,
      );

      const hasAmbiguousRepayment = inferredMatches.repayments.some((repayment) => repayment.status === 'ambiguous');
      const cycleStatus = hasAmbiguousRepayment ? 'ambiguous' : cycle.status;
      const pendingMeta = pendingCardTotalsByCycle.get(cycle.cycleDate) || {
        pendingCardDelta: 0,
        pendingTransactionCount: 0,
      };
      const ccTotal = cycle.ccTotal === null || cycle.ccTotal === undefined ? null : roundCurrency(cycle.ccTotal);
      const difference = cycle.difference === null || cycle.difference === undefined
        ? null
        : roundCurrency(cycle.difference);
      const provisionalCardTotal = ccTotal === null
        ? null
        : roundCurrency(ccTotal + pendingMeta.pendingCardDelta);
      const provisionalDifference = provisionalCardTotal === null
        ? null
        : roundCurrency((roundCurrency(cycle.bankTotal) || 0) - provisionalCardTotal);

      return {
        cycleDate: cycle.cycleDate,
        cycleStatus,
        bankTotal: roundCurrency(cycle.bankTotal),
        ccTotal,
        difference,
        pendingCardDelta: pendingMeta.pendingCardDelta,
        pendingTransactionCount: pendingMeta.pendingTransactionCount,
        provisionalCardTotal,
        provisionalDifference,
        matchedAccount: cycle.matchedAccount || null,
        repayments: inferredMatches.repayments,
        cardTransactions: inferredMatches.cardTransactions,
      };
    });

    const summary = buildSummary(cycles);

    console.info(
      `[pairing-match-details] pairing=${pairingId} cycles=${cycles.length} repayments=${summary.repaymentCount} durationMs=${Date.now() - startedAt}`,
    );

    return {
      pairing,
      summary,
      cycles,
      periodMonths: monthsBack,
      method: discrepancy?.method || null,
      acknowledged: Boolean(discrepancy?.acknowledged),
      generatedAt: new Date().toISOString(),
    };
  } finally {
    client.release();
  }
}

module.exports = {
  getPairingMatchDetails,
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
  },
  __setDependencies({ autoPairing } = {}) {
    if (autoPairing) {
      autoPairingService = autoPairing;
    }
  },
  __resetDependencies() {
    autoPairingService = actualAutoPairingService;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
