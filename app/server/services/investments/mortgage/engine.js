'use strict';

/**
 * Pure multi-track mortgage engine (Israeli מסלולים).
 *
 * No I/O, no clock: everything comes in through arguments. Market data reaches
 * the engine as path functions (see rate-paths.js):
 *   paths.primeAt(date)            -> prime rate, annual nominal %, or null
 *   paths.anchorAt(key, date)      -> anchor rate for variable tracks, annual %, or null
 *   paths.cpiKnownIndexAt(date)    -> CPI index known on that date (any base), or null
 *   paths.marketRateAt(type, date) -> assumed market rate for planned tranches, or null
 *
 * CPI-linked balances are simulated in "real" (base-index) money and converted
 * to shekels with ratio = knownIndex(date) / knownIndex(drawDate). That is how
 * Israeli linked Spitzer loans work: the real schedule is a plain annuity and
 * every payment / balance is multiplied by the index ratio.
 */

const {
  addMonths,
  daysBetween,
  endOfMonth,
  isIsoDate,
  monthIndex,
  monthKey,
  monthsBetween,
  parseIsoDate,
} = require('./dates.js');

const TRACK_TYPES = Object.freeze([
  'prime',
  'fixed_unlinked',
  'fixed_cpi',
  'variable_unlinked',
  'variable_cpi',
  'fx_linked',
  'legacy',
]);

const TRACK_DEFAULTS = Object.freeze({
  prime: { rateKind: 'prime', linkage: 'none', resetPeriodMonths: null },
  fixed_unlinked: { rateKind: 'fixed', linkage: 'none', resetPeriodMonths: null },
  fixed_cpi: { rateKind: 'fixed', linkage: 'cpi', resetPeriodMonths: null },
  variable_unlinked: { rateKind: 'anchor', linkage: 'none', resetPeriodMonths: 60 },
  variable_cpi: { rateKind: 'anchor', linkage: 'cpi', resetPeriodMonths: 60 },
  fx_linked: { rateKind: 'fixed', linkage: 'fx', resetPeriodMonths: null },
  legacy: { rateKind: 'fixed', linkage: 'none', resetPeriodMonths: null },
});

const AMORTIZATIONS = Object.freeze(['spitzer', 'equal_principal', 'balloon', 'bullet']);
const GRACE_TYPES = Object.freeze(['none', 'partial', 'full']);
const EVENT_TYPES = Object.freeze(['prepay_partial', 'prepay_full', 'refinance', 'rate_override']);
const EPSILON = 1e-7;

function round2(value) {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function finiteOr(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// Rate helpers
// ---------------------------------------------------------------------------

/** Monthly rate from an annual % quoted either nominally (÷12) or as an effective annual rate. */
function toMonthlyRate(annualPct, convention = 'nominal') {
  const annual = Number(annualPct) / 100;
  if (!Number.isFinite(annual)) return 0;
  if (convention === 'effective') {
    return Math.pow(1 + annual, 1 / 12) - 1;
  }
  return annual / 12;
}

function nominalToEffective(nominalPct) {
  return (Math.pow(1 + Number(nominalPct) / 1200, 12) - 1) * 100;
}

function effectiveToNominal(effectivePct) {
  return (Math.pow(1 + Number(effectivePct) / 100, 1 / 12) - 1) * 1200;
}

function annuityPayment(principal, monthlyRate, periods) {
  if (!(periods > 0)) return principal;
  if (Math.abs(monthlyRate) < 1e-12) return principal / periods;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -periods));
}

/** Number of payments needed to repay `principal` with a fixed `payment` (Infinity if it never amortizes). */
function remainingTermFromPayment(principal, monthlyRate, payment) {
  if (!(principal > 0)) return 0;
  if (!(payment > 0)) return Infinity;
  if (Math.abs(monthlyRate) < 1e-12) return Math.ceil(principal / payment - 1e-9);
  const ratio = (principal * monthlyRate) / payment;
  if (ratio >= 1) return Infinity;
  const periods = -Math.log(1 - ratio) / Math.log(1 + monthlyRate);
  return Math.max(1, Math.ceil(periods - 1e-6));
}

// ---------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------

function normalizeTrack(rawTrack, index) {
  const type = TRACK_TYPES.includes(rawTrack?.type) ? rawTrack.type : 'legacy';
  const defaults = TRACK_DEFAULTS[type];
  const tranches = (Array.isArray(rawTrack?.tranches) ? rawTrack.tranches : [])
    .map((tranche, trancheIndex) => ({
      id: tranche.id ?? `${rawTrack?.id ?? index}-t${trancheIndex}`,
      drawDate: tranche.drawDate,
      amount: finiteOr(tranche.amount, 0),
      status: tranche.status === 'planned' ? 'planned' : 'drawn',
      rate: finiteOr(tranche.rate),
      termMode: tranche.termMode === 'full_term' ? 'full_term' : 'same_maturity',
      termMonths: finiteOr(tranche.termMonths),
    }))
    .filter((tranche) => tranche.amount > 0 && isIsoDate(tranche.drawDate))
    .sort((a, b) => (a.drawDate < b.drawDate ? -1 : a.drawDate > b.drawDate ? 1 : 0));

  const firstDraw = tranches[0]?.drawDate || null;
  const firstPaymentDate = isIsoDate(rawTrack?.firstPaymentDate)
    ? rawTrack.firstPaymentDate
    : (firstDraw ? addMonths(firstDraw, 1) : null);
  const paymentDay = finiteOr(rawTrack?.paymentDay)
    || (firstPaymentDate ? parseIsoDate(firstPaymentDate).d : 1);

  const grace = rawTrack?.grace || {};
  const anchor = rawTrack?.anchor && isIsoDate(rawTrack.anchor.date) && finiteOr(rawTrack.anchor.balance) !== null
    ? {
      date: rawTrack.anchor.date,
      balance: finiteOr(rawTrack.anchor.balance),
      remainingMonths: finiteOr(rawTrack.anchor.remainingMonths),
    }
    : null;

  return {
    id: rawTrack?.id ?? `track-${index}`,
    label: rawTrack?.label || null,
    type,
    linkage: rawTrack?.linkage || defaults.linkage,
    rateKind: rawTrack?.rateKind || defaults.rateKind,
    rate: finiteOr(rawTrack?.rate),
    margin: finiteOr(rawTrack?.margin, 0),
    rateConvention: rawTrack?.rateConvention === 'effective' ? 'effective' : 'nominal',
    resetPeriodMonths: finiteOr(rawTrack?.resetPeriodMonths, defaults.resetPeriodMonths),
    anchorKey: rawTrack?.anchorKey || null,
    amortization: AMORTIZATIONS.includes(rawTrack?.amortization) ? rawTrack.amortization : 'spitzer',
    termMonths: Math.max(1, Math.round(finiteOr(rawTrack?.termMonths, 360))),
    firstPaymentDate,
    paymentDay: Math.min(31, Math.max(1, Math.round(paymentDay))),
    grace: {
      type: GRACE_TYPES.includes(grace.type) ? grace.type : 'none',
      endDate: isIsoDate(grace.endDate) ? grace.endDate : null,
    },
    cpiFloorAtBase: Boolean(rawTrack?.cpiFloorAtBase),
    tranches,
    anchor,
  };
}

function normalizeEvents(rawEvents) {
  return (Array.isArray(rawEvents) ? rawEvents : [])
    .filter((event) => event && EVENT_TYPES.includes(event.type) && isIsoDate(event.date))
    .map((event, index) => ({
      id: event.id ?? `event-${index}`,
      trackId: event.trackId ?? null,
      type: event.type,
      date: event.date,
      amount: finiteOr(event.amount, 0),
      mode: event.mode === 'reduce_term' ? 'reduce_term' : 'reduce_payment',
      fee: finiteOr(event.fee, 0),
      rate: finiteOr(event.rate ?? event.payload?.rate),
      closeTrackIds: Array.isArray(event.payload?.closeTrackIds) ? event.payload.closeTrackIds : null,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function eventsForTrack(events, trackId) {
  return events.filter((event) => {
    if (event.type === 'refinance') {
      return event.closeTrackIds ? event.closeTrackIds.includes(trackId) : event.trackId === trackId;
    }
    return event.trackId === trackId;
  });
}

// ---------------------------------------------------------------------------
// Rate resolution
// ---------------------------------------------------------------------------

function rateFromEntered(annualPct, convention) {
  const monthly = toMonthlyRate(annualPct, convention);
  return { monthly, annualNominal: monthly * 1200 };
}

function rateFromNominal(annualNominalPct) {
  return { monthly: annualNominalPct / 1200, annualNominal: annualNominalPct };
}

function createRateResolver(track, tranche, paths, overrides, warn, options = {}) {
  // Some banks reprice prime from the installment after a rate change.
  const primeLag = options.primeChangeLagMonths || 0;
  const resetCache = new Map();

  const baseRate = () => {
    if (tranche.rate !== null) return tranche.rate;
    if (tranche.status === 'planned' && typeof paths.marketRateAt === 'function') {
      const market = paths.marketRateAt(track.type, tranche.drawDate);
      if (Number.isFinite(market)) {
        tranche.assumedRate = market;
        return market;
      }
    }
    return track.rate;
  };

  return function resolveRate(periodStart) {
    const override = overrides.filter((event) => event.date <= periodStart).pop();
    if (override && override.rate !== null) {
      return rateFromEntered(override.rate, track.rateConvention);
    }

    if (track.rateKind === 'prime') {
      const lookupDate = primeLag ? addMonths(periodStart, -primeLag) : periodStart;
      const prime = typeof paths.primeAt === 'function' ? paths.primeAt(lookupDate) : null;
      if (Number.isFinite(prime)) return rateFromNominal(prime + track.margin);
      warn('prime_path_missing', `No prime rate available for ${periodStart}; using the entered rate`);
      const fallback = baseRate();
      return rateFromEntered(fallback ?? 0, track.rateConvention);
    }

    if (track.rateKind === 'anchor' && track.resetPeriodMonths > 0) {
      const resetIndex = Math.max(0, Math.floor(monthsBetween(tranche.drawDate, periodStart) / track.resetPeriodMonths));
      if (resetIndex === 0) {
        return rateFromEntered(baseRate() ?? 0, track.rateConvention);
      }
      if (!resetCache.has(resetIndex)) {
        const resetDate = addMonths(tranche.drawDate, resetIndex * track.resetPeriodMonths);
        const anchor = typeof paths.anchorAt === 'function'
          ? paths.anchorAt(track.anchorKey || track.type, resetDate)
          : null;
        if (Number.isFinite(anchor)) {
          resetCache.set(resetIndex, rateFromNominal(anchor + track.margin));
        } else {
          warn('anchor_path_missing', `No anchor rate for the ${resetDate} reset; keeping the previous rate`);
          resetCache.set(resetIndex, resetCache.get(resetIndex - 1) || rateFromEntered(baseRate() ?? 0, track.rateConvention));
        }
      }
      return resetCache.get(resetIndex);
    }

    const rate = baseRate();
    if (rate === null || rate === undefined) {
      warn('rate_missing', 'Track has no interest rate; assuming 0%');
      return rateFromNominal(0);
    }
    return rateFromEntered(rate, track.rateConvention);
  };
}

function createIndexRatio(track, paths, warn) {
  if (track.linkage === 'fx') {
    warn('fx_linkage_unsupported', 'Foreign-currency linkage is not modelled yet; treated as unlinked');
  }
  if (track.linkage !== 'cpi') return () => 1;
  if (typeof paths.cpiKnownIndexAt !== 'function') {
    warn('cpi_path_missing', 'No CPI data; CPI-linked balances are shown without indexation');
    return () => 1;
  }
  return (baseDate, date) => {
    const base = paths.cpiKnownIndexAt(baseDate);
    const current = paths.cpiKnownIndexAt(date);
    if (!(base > 0) || !(current > 0)) return 1;
    const ratio = current / base;
    return track.cpiFloorAtBase ? Math.max(1, ratio) : ratio;
  };
}

// ---------------------------------------------------------------------------
// Track simulation
// ---------------------------------------------------------------------------

function simulateTrack(track, trackEvents, paths, options, warnings) {
  const warned = new Set();
  const warn = (code, message) => {
    if (warned.has(code)) return;
    warned.add(code);
    warnings.push({ trackId: track.id, code, message });
  };

  const empty = {
    trackId: track.id,
    label: track.label,
    type: track.type,
    rows: [],
    rawRows: [],
    tranches: [],
    maturityDate: null,
    closedDate: null,
  };
  if (track.tranches.length === 0 || !track.firstPaymentDate) {
    if (track.tranches.length === 0) warn('no_tranches', 'Track has no drawn or planned amount');
    return empty;
  }

  const calendarDate = (k) => addMonths(track.firstPaymentDate, k, track.paymentDay);
  const separateBrokenPeriod = options.brokenPeriodInterest === 'separate';
  const brokenEntries = [];
  const maturityK = track.termMonths - 1;
  const overrides = trackEvents.filter((event) => event.type === 'rate_override');
  const balanceEvents = trackEvents.filter((event) => event.type !== 'rate_override');
  const indexRatio = createIndexRatio(track, paths, warn);

  // Tranche state. `remaining` counts payments left including the current one.
  const tranches = track.tranches.map((tranche) => {
    let startK = 0;
    while (calendarDate(startK) <= tranche.drawDate) startK += 1;
    let prevDate = tranche.drawDate;
    let brokenEntry = null;
    if (separateBrokenPeriod) {
      // The payment day right after the draw (may precede the first regular
      // payment date) starts the schedule. Interest from the draw to it is
      // charged that day on its own; regular payments start a month later.
      let brokenK = startK;
      while (calendarDate(brokenK - 1) > tranche.drawDate) brokenK -= 1;
      if (calendarDate(brokenK - 1) !== tranche.drawDate) {
        const brokenDate = calendarDate(brokenK);
        brokenEntry = { date: brokenDate, days: daysBetween(tranche.drawDate, brokenDate) };
        startK = Math.max(startK, brokenK + 1);
        prevDate = brokenDate;
      }
    }
    const periods = tranche.termMode === 'full_term'
      ? Math.max(1, Math.round(tranche.termMonths || track.termMonths))
      : Math.max(1, maturityK - startK + 1);
    const state = {
      ...tranche,
      startK,
      remaining: periods,
      real: tranche.amount,
      ratioPrev: 1,
      prevDate,
      active: false,
      done: false,
    };
    state.resolveRate = createRateResolver(track, state, paths, overrides, warn, options);
    if (brokenEntry) brokenEntries.push({ ...brokenEntry, tranche: state });
    return state;
  });

  // Dates sanity check: the first regular payment normally comes one month
  // after the draw (two at most when the broken period is charged apart).
  if (tranches[0] && track.grace.type === 'none') {
    const first = tranches[0];
    const gap = daysBetween(first.drawDate, calendarDate(first.startK));
    if (gap > (separateBrokenPeriod ? 62 : 45)) {
      warn('first_payment_gap', `First payment ${calendarDate(first.startK)} is ${gap} days after the ${first.drawDate} draw; check the dates`);
    }
  }

  const rows = [];
  let anchorApplied = !track.anchor;
  let closedDate = null;
  let eventCursor = 0;

  // Hard cap guards against a malformed input looping forever (100 years).
  for (let k = 0; k < 1200 && !closedDate; k += 1) {
    if (tranches.every((tranche) => tranche.done)) break;
    const date = calendarDate(k);
    if (options.horizonEnd && date > options.horizonEnd) break;

    // Statement anchor: re-base balances on the first period after the statement date.
    if (!anchorApplied && date > track.anchor.date) {
      anchorApplied = true;
      const live = tranches.filter((tranche) => tranche.drawDate <= track.anchor.date && !tranche.done);
      const modelBalance = live.reduce((sum, tranche) => sum + tranche.real * tranche.ratioPrev, 0);
      if (modelBalance > EPSILON) {
        const scale = track.anchor.balance / modelBalance;
        for (const tranche of live) tranche.real *= scale;
        const remaining = track.anchor.remainingMonths;
        if (remaining && remaining > 0) {
          for (const tranche of live) tranche.remaining = Math.max(1, Math.round(remaining));
        }
        warnings.push({
          trackId: track.id,
          code: 'anchor_applied',
          message: 'Balance re-based on the bank statement',
          modelBalance: round2(modelBalance),
          statementBalance: round2(track.anchor.balance),
        });
      }
    }

    const row = {
      date,
      phase: 'amortizing',
      openingBalance: 0,
      indexation: 0,
      interest: 0,
      principal: 0,
      payment: 0,
      prepayment: 0,
      fees: 0,
      closingBalance: 0,
      annualRate: null,
      indexRatio: null,
      planned: false,
    };
    let rateWeight = 0;
    let rateSum = 0;
    let anyActive = false;

    for (const tranche of tranches) {
      if (tranche.done || k < tranche.startK) continue;
      anyActive = true;
      if (tranche.status === 'planned') row.planned = true;

      const ratio = indexRatio(tranche.drawDate, date);
      const periodStart = tranche.prevDate;
      const rate = tranche.resolveRate(periodStart);
      const r = rate.monthly;
      const opening = tranche.real * tranche.ratioPrev;
      const indexation = tranche.real * (ratio - tranche.ratioPrev);
      let interestReal = tranche.real * r;
      let paymentReal = 0;
      let principalReal = 0;
      let capitalized = false;

      const inGrace = track.grace.type !== 'none' && track.grace.endDate && date <= track.grace.endDate;
      const isLast = tranche.remaining <= 1;
      let phase = 'amortizing';

      if (inGrace && track.grace.type === 'full') {
        capitalized = true;
        phase = 'grace_full';
      } else if (inGrace && track.grace.type === 'partial') {
        paymentReal = interestReal;
        phase = 'grace_partial';
      } else if (track.amortization === 'balloon' && !isLast) {
        paymentReal = interestReal;
        phase = 'interest_only';
      } else if (track.amortization === 'bullet' && !isLast) {
        capitalized = true;
        phase = 'accruing';
      } else if (track.amortization === 'equal_principal') {
        principalReal = tranche.real / Math.max(1, tranche.remaining);
        paymentReal = principalReal + interestReal;
      } else if (track.amortization === 'balloon' || track.amortization === 'bullet') {
        principalReal = tranche.real;
        paymentReal = tranche.real + interestReal;
        phase = 'final';
      } else {
        // After a "reduce term" prepayment the bank keeps the instalment fixed
        // until the rate changes; otherwise re-amortize over the remaining term.
        const keepFixed = tranche.fixedPayment && Math.abs(tranche.fixedPaymentRate - r) < 1e-12 && !isLast;
        paymentReal = keepFixed
          ? Math.min(tranche.fixedPayment, tranche.real + interestReal)
          : annuityPayment(tranche.real, r, Math.max(1, tranche.remaining));
        if (!keepFixed) tranche.fixedPayment = null;
        principalReal = paymentReal - interestReal;
      }

      // Broken first period: charge interest for the actual days since the draw.
      if (k === tranche.startK && options.brokenPeriodInterest === 'actual_days') {
        const days = daysBetween(tranche.drawDate, date);
        const actual = tranche.real * (rate.annualNominal / 100) * (days / 365);
        // The extra days' interest is paid with the first instalment (or
        // capitalized during a full grace period).
        if (!capitalized) paymentReal += actual - interestReal;
        interestReal = actual;
      }

      if (capitalized) {
        tranche.real += interestReal;
      } else {
        tranche.real = Math.max(0, tranche.real - principalReal);
      }

      row.openingBalance += opening;
      row.indexation += indexation;
      row.interest += interestReal * ratio;
      row.principal += principalReal * ratio;
      row.payment += paymentReal * ratio;
      row.phase = phase;
      rateSum += rate.annualNominal * opening;
      rateWeight += opening;

      tranche.ratioPrev = ratio;
      tranche.prevDate = date;
      tranche.remaining -= 1;
      tranche.active = true;
      if (tranche.remaining <= 0 || tranche.real <= EPSILON) {
        tranche.done = true;
        tranche.real = 0;
      }
      row.indexRatio = track.linkage === 'cpi' ? ratio : null;
    }

    // Balance events (prepayments / refinance) falling in (previous date, date].
    const previousDate = k === 0 ? '0000-00-00' : calendarDate(k - 1);
    while (eventCursor < balanceEvents.length && balanceEvents[eventCursor].date <= date) {
      const event = balanceEvents[eventCursor];
      eventCursor += 1;
      if (event.date <= previousDate && k > 0) continue;
      const live = tranches.filter((tranche) => !tranche.done && tranche.drawDate <= event.date);
      const liveBalance = live.reduce((sum, tranche) => sum + tranche.real * tranche.ratioPrev, 0);
      if (liveBalance <= EPSILON) continue;
      row.fees += event.fee;
      if (event.type === 'prepay_full' || event.type === 'refinance') {
        row.prepayment += liveBalance;
        for (const tranche of live) {
          tranche.real = 0;
          tranche.done = true;
        }
        if (tranches.every((tranche) => tranche.done)) closedDate = event.date;
        continue;
      }
      const amount = Math.min(event.amount, liveBalance);
      row.prepayment += amount;
      for (const tranche of live) {
        const nominal = tranche.real * tranche.ratioPrev;
        const share = amount * (nominal / liveBalance);
        const before = tranche.real;
        tranche.real = Math.max(0, before - share / tranche.ratioPrev);
        if (tranche.real <= EPSILON) {
          tranche.done = true;
          tranche.real = 0;
          continue;
        }
        if (event.mode === 'reduce_term' && tranche.remaining > 0) {
          const r = tranche.resolveRate(tranche.prevDate).monthly;
          if (track.amortization === 'equal_principal') {
            const perPeriod = before / tranche.remaining;
            tranche.remaining = Math.max(1, Math.ceil(tranche.real / perPeriod - 1e-9));
          } else if (track.amortization === 'spitzer') {
            const payment = tranche.fixedPayment || annuityPayment(before, r, tranche.remaining);
            const periods = remainingTermFromPayment(tranche.real, r, payment);
            if (Number.isFinite(periods)) {
              tranche.remaining = Math.min(tranche.remaining, periods);
              tranche.fixedPayment = payment;
              tranche.fixedPaymentRate = r;
            }
          }
        }
      }
      if (tranches.every((tranche) => tranche.done)) closedDate = event.date;
    }

    if (!anyActive && row.prepayment === 0) continue;

    row.closingBalance = tranches.reduce(
      (sum, tranche) => sum + (tranche.done || k < tranche.startK ? 0 : tranche.real * tranche.ratioPrev),
      0,
    );
    row.annualRate = rateWeight > 0 ? rateSum / rateWeight : null;
    // Tranches whose balance is included in closingBalance (see trackBalanceAt).
    row.covered = tranches.filter((tranche) => k >= tranche.startK).map((tranche) => tranche.id);

    rows.push(row);
  }

  // Broken-period interest charged on its own payment day (interest only).
  for (const entry of brokenEntries) {
    const rate = entry.tranche.resolveRate(entry.tranche.drawDate);
    const interest = entry.tranche.amount * (rate.annualNominal / 100) * (entry.days / 365);
    if (!(interest > 0)) continue;
    const existing = rows.find((row) => row.date === entry.date);
    if (existing) {
      existing.interest += interest;
      existing.payment += interest;
      continue;
    }
    const covered = tranches.filter((tranche) => tranche.drawDate <= entry.date);
    const balance = covered.reduce((sum, tranche) => sum + tranche.amount, 0);
    rows.push({
      date: entry.date,
      phase: 'broken_period',
      openingBalance: balance,
      indexation: 0,
      interest,
      principal: 0,
      payment: interest,
      prepayment: 0,
      fees: 0,
      closingBalance: balance,
      annualRate: rate.annualNominal,
      indexRatio: null,
      planned: entry.tranche.status === 'planned',
      covered: covered.map((tranche) => tranche.id),
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    trackId: track.id,
    label: track.label,
    type: track.type,
    rows: rows.map(roundRow),
    rawRows: rows,
    tranches: tranches.map((tranche) => ({
      id: tranche.id,
      drawDate: tranche.drawDate,
      amount: tranche.amount,
      status: tranche.status,
      firstPaymentDate: calendarDate(tranche.startK),
      assumedRate: tranche.assumedRate ?? null,
    })),
    maturityDate: rows.length ? rows[rows.length - 1].date : calendarDate(maturityK),
    closedDate,
  };
}

function roundRow({ covered: _covered, ...row }) {
  return {
    ...row,
    openingBalance: round2(row.openingBalance),
    indexation: round2(row.indexation),
    interest: round2(row.interest),
    principal: round2(row.principal),
    payment: round2(row.payment),
    prepayment: round2(row.prepayment),
    fees: round2(row.fees),
    closingBalance: round2(row.closingBalance),
    annualRate: row.annualRate === null ? null : Math.round(row.annualRate * 10000) / 10000,
    indexRatio: row.indexRatio === null ? null : Math.round(row.indexRatio * 1e6) / 1e6,
  };
}

/**
 * Balance of one simulated track at the end of `date`: the latest payment
 * row's closing balance, plus tranches drawn by then whose first payment is
 * still ahead (counted at face value).
 */
function trackBalanceAt(simulated, date) {
  let lastRow = null;
  for (const row of simulated.rawRows || []) {
    if (row.date <= date) lastRow = row;
    else break;
  }
  let balance = lastRow ? lastRow.closingBalance : 0;
  if (simulated.closedDate && simulated.closedDate <= date) return balance;
  const covered = new Set(lastRow?.covered || []);
  for (const tranche of simulated.tranches || []) {
    // Drawn by `date` but not yet part of a payment row's balance.
    if (tranche.drawDate <= date && !covered.has(tranche.id)) balance += tranche.amount;
  }
  return balance;
}

function sumRows(rows, predicate) {
  const totals = { payment: 0, interest: 0, principal: 0, indexation: 0, prepayment: 0, fees: 0 };
  for (const row of rows) {
    if (!predicate(row)) continue;
    totals.payment += row.payment;
    totals.interest += row.interest;
    totals.principal += row.principal;
    totals.indexation += row.indexation;
    totals.prepayment += row.prepayment;
    totals.fees += row.fees;
  }
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round2(value)]));
}

/**
 * Build the full schedule for a mortgage made of several tracks.
 *
 * @returns {{
 *   tracks: Array, monthly: Array, current: object, totals: object, warnings: Array
 * }}
 */
function buildMortgageSchedule(input = {}) {
  const asOf = isIsoDate(input.asOf) ? input.asOf : null;
  if (!asOf) throw new Error('buildMortgageSchedule requires asOf (YYYY-MM-DD)');
  const options = {
    brokenPeriodInterest: ['actual_days', 'separate'].includes(input.options?.brokenPeriodInterest)
      ? input.options.brokenPeriodInterest
      : 'monthly',
    primeChangeLagMonths: Number(input.options?.primeChangeLagMonths) === 1 ? 1 : 0,
    horizonEnd: isIsoDate(input.horizonEnd) ? input.horizonEnd : null,
  };
  const paths = input.paths || {};
  const warnings = [];
  const tracks = (Array.isArray(input.tracks) ? input.tracks : []).map(normalizeTrack);
  const events = normalizeEvents(input.events);

  const simulated = tracks.map((track) => simulateTrack(track, eventsForTrack(events, track.id), paths, options, warnings));

  // Monthly aggregation across tracks.
  const allDates = [];
  for (const track of simulated) {
    for (const tranche of track.tranches || []) allDates.push(tranche.drawDate);
    for (const row of track.rawRows || []) allDates.push(row.date);
  }
  const monthly = [];
  if (allDates.length > 0) {
    allDates.sort();
    const startIndex = monthIndex(allDates[0]);
    const endIndex = monthIndex(allDates[allDates.length - 1]);
    const byMonth = new Map();
    for (const track of simulated) {
      for (const row of track.rawRows || []) {
        const key = monthKey(row.date);
        const bucket = byMonth.get(key) || { payment: 0, interest: 0, principal: 0, indexation: 0, prepayment: 0, fees: 0 };
        bucket.payment += row.payment;
        bucket.interest += row.interest;
        bucket.principal += row.principal;
        bucket.indexation += row.indexation;
        bucket.prepayment += row.prepayment;
        bucket.fees += row.fees;
        byMonth.set(key, bucket);
      }
    }
    const drawsByMonth = new Map();
    for (const track of simulated) {
      for (const tranche of track.tranches || []) {
        const key = monthKey(tranche.drawDate);
        drawsByMonth.set(key, (drawsByMonth.get(key) || 0) + tranche.amount);
      }
    }
    for (let index = startIndex; index <= endIndex; index += 1) {
      const y = Math.floor(index / 12);
      const m = index - y * 12 + 1;
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const monthEnd = endOfMonth(`${key}-01`);
      const bucket = byMonth.get(key) || { payment: 0, interest: 0, principal: 0, indexation: 0, prepayment: 0, fees: 0 };
      const byTrack = {};
      let balance = 0;
      for (const track of simulated) {
        const trackBalance = trackBalanceAt(track, monthEnd);
        byTrack[track.trackId] = round2(trackBalance);
        balance += trackBalance;
      }
      monthly.push({
        month: key,
        payment: round2(bucket.payment),
        interest: round2(bucket.interest),
        principal: round2(bucket.principal),
        indexation: round2(bucket.indexation),
        prepayment: round2(bucket.prepayment),
        fees: round2(bucket.fees),
        drawn: round2(drawsByMonth.get(key) || 0),
        balance: round2(balance),
        byTrack,
        projected: monthEnd > asOf,
      });
    }
  }

  // Current snapshot.
  let balance = 0;
  const byTrack = [];
  let nextPaymentDate = null;
  for (const track of simulated) {
    const trackBalance = trackBalanceAt(track, asOf);
    balance += trackBalance;
    const nextRow = (track.rawRows || []).find((row) => row.date > asOf) || null;
    if (nextRow && (!nextPaymentDate || nextRow.date < nextPaymentDate)) nextPaymentDate = nextRow.date;
    byTrack.push({
      trackId: track.trackId,
      label: track.label,
      type: track.type,
      balance: round2(trackBalance),
      nextPayment: nextRow ? round2(nextRow.payment) : 0,
      nextPaymentDate: nextRow ? nextRow.date : null,
      currentRate: nextRow && nextRow.annualRate !== null ? Math.round(nextRow.annualRate * 10000) / 10000 : null,
      maturityDate: track.maturityDate,
      closedDate: track.closedDate,
      drawn: round2((track.tranches || []).filter((t) => t.drawDate <= asOf).reduce((s, t) => s + t.amount, 0)),
      planned: round2((track.tranches || []).filter((t) => t.drawDate > asOf).reduce((s, t) => s + t.amount, 0)),
    });
  }
  // Monthly instalment = each track's next payment. Tracks may pay on
  // different days, so sum the next row of every track due within a month of
  // the earliest one (tracks whose first payment is further out are excluded).
  let nextPayment = 0;
  if (nextPaymentDate) {
    const windowEnd = addMonths(nextPaymentDate, 1);
    for (const track of byTrack) {
      if (track.nextPaymentDate && track.nextPaymentDate < windowEnd) nextPayment += track.nextPayment;
    }
  }
  const rated = byTrack.filter((track) => track.currentRate !== null && track.balance > 0);
  const ratedBalance = rated.reduce((sum, track) => sum + track.balance, 0);
  const weightedRate = ratedBalance > 0
    ? rated.reduce((sum, track) => sum + track.currentRate * track.balance, 0) / ratedBalance
    : null;

  const allRows = simulated.flatMap((track) => track.rawRows || []);
  const paidToDate = sumRows(allRows, (row) => row.date <= asOf);
  const remaining = sumRows(allRows, (row) => row.date > asOf);
  const lifetime = sumRows(allRows, () => true);
  const drawnTotal = simulated.reduce(
    (sum, track) => sum + (track.tranches || []).reduce((acc, tranche) => acc + tranche.amount, 0),
    0,
  );

  return {
    asOf,
    tracks: simulated.map(({ rawRows, ...track }) => ({
      ...track,
      totals: sumRows(rawRows || [], () => true),
    })),
    monthly,
    current: {
      date: asOf,
      balance: round2(balance),
      nextPayment: round2(nextPayment),
      nextPaymentDate,
      weightedRate: weightedRate === null ? null : Math.round(weightedRate * 10000) / 10000,
      byTrack,
    },
    totals: {
      drawn: round2(drawnTotal),
      paidToDate,
      remaining,
      lifetime,
      // Cost of borrowing = interest + CPI indexation + fees over the loan's life.
      totalCost: round2(lifetime.interest + lifetime.indexation + lifetime.fees),
      maturityDate: simulated.reduce((latest, track) => (
        track.maturityDate && (!latest || track.maturityDate > latest) ? track.maturityDate : latest
      ), null),
    },
    warnings,
  };
}

/**
 * Compare a track's modelled state against a bank statement under the
 * plausible conventions (nominal vs effective rate quoting) and report the
 * best fit. Used to tell the user how their bank quotes rates.
 */
function calibrateTrack(rawTrack, statement, context = {}) {
  const asOf = statement?.date;
  if (!isIsoDate(asOf)) throw new Error('calibrateTrack requires statement.date');
  const candidates = [];
  for (const rateConvention of ['nominal', 'effective']) {
    const track = { ...rawTrack, rateConvention, anchor: null };
    const schedule = buildMortgageSchedule({
      tracks: [track],
      events: context.events,
      paths: context.paths,
      asOf,
      options: context.options,
    });
    const modelBalance = schedule.current.balance;
    const modelPayment = schedule.current.nextPayment;
    const balanceDiff = finiteOr(statement.balance) === null ? null : round2(modelBalance - statement.balance);
    const paymentDiff = finiteOr(statement.payment) === null ? null : round2(modelPayment - statement.payment);
    const score = Math.abs(paymentDiff ?? 0) * 10 + Math.abs(balanceDiff ?? 0) / 100;
    candidates.push({ rateConvention, modelBalance, modelPayment, balanceDiff, paymentDiff, score });
  }
  candidates.sort((a, b) => a.score - b.score);
  return { best: candidates[0], candidates };
}

module.exports = {
  AMORTIZATIONS,
  EVENT_TYPES,
  GRACE_TYPES,
  TRACK_DEFAULTS,
  TRACK_TYPES,
  annuityPayment,
  buildMortgageSchedule,
  calibrateTrack,
  effectiveToNominal,
  nominalToEffective,
  normalizeTrack,
  remainingTermFromPayment,
  round2,
  toMonthlyRate,
};
