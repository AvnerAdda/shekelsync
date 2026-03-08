const actualPairingsService = require('./pairings.js');
const actualAutoPairingService = require('./auto-pairing.js');

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 30;
const DISCREPANCY_MONTHS_BACK = 2;
const MATCH_TOLERANCE = 2;
const ISRAEL_TIMEZONE = 'Asia/Jerusalem';

let pairingsService = actualPairingsService;
let autoPairingService = actualAutoPairingService;

function roundCurrency(value) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * 100) / 100;
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

function toIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function shiftIsoDate(isoDate, daysDelta) {
  const normalized = toIsoDate(isoDate);
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + daysDelta);
  return parsed.toISOString().slice(0, 10);
}

function getIsoDateInTimeZone(date = new Date(), timeZone = ISRAEL_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    return date.toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function validateParams(days) {
  if (!Number.isInteger(days) || days <= 0) {
    const error = new Error('days must be a positive integer');
    error.status = 400;
    throw error;
  }

  if (days > MAX_WINDOW_DAYS) {
    const error = new Error(`days must be less than or equal to ${MAX_WINDOW_DAYS}`);
    error.status = 400;
    throw error;
  }
}

function isWithinWindow(cycleDate, windowStartDate, windowEndDate) {
  const normalizedCycleDate = toIsoDate(cycleDate);
  if (!normalizedCycleDate) return false;
  return normalizedCycleDate >= windowStartDate && normalizedCycleDate <= windowEndDate;
}

function createBaseResponse({ days, windowStartDate, windowEndDate }) {
  return {
    windowDays: days,
    windowStartDate,
    windowEndDate,
    tolerance: MATCH_TOLERANCE,
    totals: {
      bankAmount: 0,
      cardAmount: 0,
      missingAmount: 0,
      affectedPairingsCount: 0,
      affectedCyclesCount: 0,
    },
    pairings: [],
    generatedAt: new Date().toISOString(),
  };
}

async function getCurrentMonthPairingGap(params = {}) {
  const days = params.days === undefined
    ? DEFAULT_WINDOW_DAYS
    : parseStrictPositiveInteger(params.days);

  validateParams(days);

  const windowEndDate = getIsoDateInTimeZone(new Date());
  const windowStartDate = shiftIsoDate(windowEndDate, -(days - 1));
  const response = createBaseResponse({ days, windowStartDate, windowEndDate });

  const pairings = await pairingsService.listPairings();
  if (!Array.isArray(pairings) || pairings.length === 0) {
    return response;
  }

  const pairingResults = await Promise.all(pairings.map(async (pairing) => {
    const discrepancy = await autoPairingService.calculateDiscrepancy({
      pairingId: pairing.id,
      bankVendor: pairing.bankVendor,
      bankAccountNumber: pairing.bankAccountNumber,
      ccVendor: pairing.creditCardVendor,
      ccAccountNumber: pairing.creditCardAccountNumber,
      monthsBack: DISCREPANCY_MONTHS_BACK,
    });

    const cycles = Array.isArray(discrepancy?.cycles) ? discrepancy.cycles : [];
    const scopedCycles = cycles.filter((cycle) =>
      isWithinWindow(cycle?.cycleDate, windowStartDate, windowEndDate),
    );

    if (!scopedCycles.length) {
      return null;
    }

    const affectedCycles = scopedCycles
      .map((cycle) => {
        const bankTotal = roundCurrency(cycle?.bankTotal || 0);
        const ccTotal = cycle?.ccTotal === null || cycle?.ccTotal === undefined
          ? null
          : roundCurrency(cycle.ccTotal);
        const rawMissingAmount = ccTotal === null
          ? bankTotal
          : roundCurrency(Math.max(0, bankTotal - ccTotal));
        const missingAmount = rawMissingAmount > MATCH_TOLERANCE ? rawMissingAmount : 0;

        if (missingAmount <= 0) {
          return null;
        }

        return {
          cycleDate: cycle.cycleDate,
          status: cycle.status || null,
          bankAmount: bankTotal,
          cardAmount: ccTotal === null ? 0 : ccTotal,
          missingAmount,
        };
      })
      .filter(Boolean);

    if (!affectedCycles.length) {
      return null;
    }

    const bankAmount = roundCurrency(
      affectedCycles.reduce((sum, cycle) => sum + cycle.bankAmount, 0),
    );
    const cardAmount = roundCurrency(
      affectedCycles.reduce((sum, cycle) => sum + cycle.cardAmount, 0),
    );
    const missingAmount = roundCurrency(
      affectedCycles.reduce((sum, cycle) => sum + cycle.missingAmount, 0),
    );

    return {
      pairingId: pairing.id,
      creditCardVendor: pairing.creditCardVendor,
      creditCardAccountNumber: pairing.creditCardAccountNumber,
      bankVendor: pairing.bankVendor,
      bankAccountNumber: pairing.bankAccountNumber,
      bankAmount,
      cardAmount,
      missingAmount,
      affectedCyclesCount: affectedCycles.length,
      cycles: affectedCycles,
    };
  }));

  const affectedPairings = pairingResults
    .filter(Boolean)
    .sort((a, b) => b.missingAmount - a.missingAmount || a.pairingId - b.pairingId);

  response.pairings = affectedPairings;
  response.totals.bankAmount = roundCurrency(
    affectedPairings.reduce((sum, pairing) => sum + pairing.bankAmount, 0),
  );
  response.totals.cardAmount = roundCurrency(
    affectedPairings.reduce((sum, pairing) => sum + pairing.cardAmount, 0),
  );
  response.totals.missingAmount = roundCurrency(
    affectedPairings.reduce((sum, pairing) => sum + pairing.missingAmount, 0),
  );
  response.totals.affectedPairingsCount = affectedPairings.length;
  response.totals.affectedCyclesCount = affectedPairings.reduce(
    (sum, pairing) => sum + pairing.affectedCyclesCount,
    0,
  );

  return response;
}

module.exports = {
  getCurrentMonthPairingGap,
  __setDependencies({ pairings, autoPairing } = {}) {
    if (pairings) {
      pairingsService = pairings;
    }
    if (autoPairing) {
      autoPairingService = autoPairing;
    }
  },
  __resetDependencies() {
    pairingsService = actualPairingsService;
    autoPairingService = actualAutoPairingService;
  },
};

module.exports.default = module.exports;
