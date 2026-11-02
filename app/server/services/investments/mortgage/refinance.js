'use strict';

/**
 * Pure refinance (מחזור משכנתא) comparison and stress scenarios.
 *
 * A refinance closes some tracks on date D (repaid by the new loan) and opens
 * offer tracks drawn on D for the same balance. We run the engine twice —
 * current loan vs. current loan + refinance event + offer tracks — and compare
 * the payments still to come. Costs: estimated early-repayment fees on the
 * closed tracks + switching costs (appraisal, file fee, lawyer…).
 */

const { addMonths, monthKey } = require('./dates.js');
const { buildMortgageSchedule, round2 } = require('./engine.js');
const { estimatePrepaymentFees } = require('./analysis.js');

const DEFAULT_SWITCHING_COSTS = 3000;
const DEFAULT_DISCOUNT_RATE_PCT = 4;

const STRESS_PRESETS = Object.freeze([
  { key: 'base', scenario: {} },
  { key: 'prime1', scenario: { primeShiftPct: 1 } },
  { key: 'prime2', scenario: { primeShiftPct: 2 } },
  { key: 'prime3', scenario: { primeShiftPct: 3 } },
  { key: 'cpi4', scenario: { cpiAnnualOverridePct: 4 } },
  { key: 'combined', scenario: { primeShiftPct: 2, cpiAnnualOverridePct: 4, anchorShiftPct: 1 } },
]);

function paymentsByMonth(schedule) {
  return new Map((schedule?.monthly || []).map((point) => [point.month, point.payment]));
}

/** First payment date on or after `asOf` across tracks (refinances usually happen on a payment date). */
function nextPaymentDate(schedule, asOf) {
  return schedule?.current?.nextPaymentDate || addMonths(asOf, 1);
}

function closedBalanceAt(schedule, trackIds, date) {
  const point = (schedule?.monthly || []).find((item) => item.month === monthKey(date));
  if (!point) return 0;
  return trackIds.reduce((sum, id) => sum + (point.byTrack[String(id)] || 0), 0);
}

/**
 * Fraction of the new loan for each offer track. Tracks without a share split
 * what the others leave (out of 100%); the result is normalized to sum to 1.
 */
function resolveShares(offers) {
  const given = offers.map((track) => {
    const value = Number(track.sharePct);
    return track.sharePct === null || track.sharePct === undefined || track.sharePct === '' || !Number.isFinite(value) ? null : Math.max(0, value);
  });
  const givenTotal = given.reduce((sum, value) => sum + (value ?? 0), 0);
  const missing = given.filter((value) => value === null).length;
  const filler = missing ? Math.max(0, 100 - givenTotal) / missing : 0;
  const raw = given.map((value) => (value === null ? filler : value));
  const total = raw.reduce((sum, value) => sum + value, 0);
  return total > 0 ? raw.map((value) => value / total) : offers.map(() => 1 / offers.length);
}

/**
 * @param input {
 *   asOf, input (engine input: tracks, events, options), paths, market,
 *   closeTrackIds: string[], offerTracks: [{ type, rate, margin, rateConvention, termMonths, sharePct, resetPeriodMonths }],
 *   date?, switchingCosts?, financeFees?, discountRatePct?
 * }
 */
function compareRefinance(params) {
  const { asOf, paths, market } = params;
  const base = params.input;
  const closeIds = (params.closeTrackIds || []).map(String);
  if (closeIds.length === 0) throw Object.assign(new Error('Choose at least one track to refinance'), { status: 400 });
  const offers = (params.offerTracks || []).filter((track) => track && track.type);
  if (offers.length === 0) throw Object.assign(new Error('Add at least one offer track'), { status: 400 });

  const current = buildMortgageSchedule({ ...base, paths, asOf });
  const date = params.date || nextPaymentDate(current, asOf);
  const closedBalance = closedBalanceAt(current, closeIds, date);
  if (!(closedBalance > 0)) throw Object.assign(new Error('The selected tracks have no balance on the refinance date'), { status: 400 });

  const fees = estimatePrepaymentFees(
    { tracks: current.tracks.filter((track) => closeIds.includes(String(track.trackId))) },
    base.tracks.filter((track) => closeIds.includes(String(track.id))),
    { asOf, market, cpiKnownIndexAt: paths.cpiKnownIndexAt },
  );
  const switchingCosts = Number.isFinite(Number(params.switchingCosts)) ? Number(params.switchingCosts) : DEFAULT_SWITCHING_COSTS;
  const totalCosts = fees.total + switchingCosts;
  const financeFees = Boolean(params.financeFees);
  const offerAmount = closedBalance + (financeFees ? totalCosts : 0);

  const shares = resolveShares(offers);
  let allocated = 0;
  const offerTracks = offers.map((track, index) => {
    const isLast = index === offers.length - 1;
    const share = shares[index];
    const amount = isLast ? offerAmount - allocated : Math.round(offerAmount * share);
    allocated += amount;
    return {
      id: `offer-${index}`,
      label: track.label || null,
      type: track.type,
      rate: track.rate ?? null,
      margin: track.margin ?? null,
      rateConvention: track.rateConvention === 'effective' ? 'effective' : 'nominal',
      resetPeriodMonths: track.resetPeriodMonths ?? null,
      amortization: track.amortization || 'spitzer',
      termMonths: Math.max(1, Math.round(Number(track.termMonths) || 360)),
      firstPaymentDate: addMonths(date, 1),
      // The offer's rate is contractual: set it on the tranche, or a future
      // (planned) tranche would be priced at the market average instead.
      tranches: [{ id: `offer-${index}-t0`, drawDate: date, amount, status: date > asOf ? 'planned' : 'drawn', rate: track.rate ?? null }],
    };
  });
  const offer = buildMortgageSchedule({
    tracks: [...base.tracks, ...offerTracks],
    events: [...(base.events || []), { id: 'refinance', type: 'refinance', date, payload: { closeTrackIds: closeIds } }],
    options: base.options,
    paths,
    asOf,
  });

  // Payments from the month after the refinance on (that month is shared).
  const fromMonth = monthKey(addMonths(date, 1));
  const currentPayments = paymentsByMonth(current);
  const offerPayments = paymentsByMonth(offer);
  const months = [...new Set([...currentPayments.keys(), ...offerPayments.keys()])].filter((m) => m >= fromMonth).sort();
  const discountMonthly = (Number(params.discountRatePct ?? DEFAULT_DISCOUNT_RATE_PCT) || 0) / 1200;
  let nominalSaving = 0;
  let pvSaving = 0;
  let cumulative = financeFees ? 0 : -totalCosts;
  let breakEvenMonth = null;
  const series = months.map((month, index) => {
    const cur = currentPayments.get(month) || 0;
    const off = offerPayments.get(month) || 0;
    const diff = cur - off;
    nominalSaving += diff;
    pvSaving += diff / Math.pow(1 + discountMonthly, index + 1);
    cumulative += diff;
    if (breakEvenMonth === null && cumulative >= 0 && (financeFees || totalCosts > 0 || diff > 0)) breakEvenMonth = index + 1;
    return { month, current: round2(cur), offer: round2(off) };
  });
  if (!financeFees) {
    nominalSaving -= totalCosts;
    pvSaving -= totalCosts;
  }
  const firstMonth = series[0] || { current: 0, offer: 0 };
  const verdict = pvSaving > Math.max(5000, closedBalance * 0.01) && breakEvenMonth !== null && breakEvenMonth <= 36
    ? 'worth_it'
    : pvSaving > 0 ? 'marginal' : 'not_worth_it';

  return {
    date,
    closedTrackIds: closeIds,
    closedBalance: round2(closedBalance),
    offerAmount: round2(offerAmount),
    offerTracks: offerTracks.map(({ tranches, ...track }) => ({ ...track, amount: tranches[0].amount })),
    costs: { prepaymentFees: fees.total, feeTracks: fees.tracks, switchingCosts, total: round2(totalCosts), financed: financeFees },
    current: {
      monthlyPayment: firstMonth.current,
      remainingPayments: round2(months.reduce((sum, m) => sum + (currentPayments.get(m) || 0), 0)),
      maturityDate: current.totals.maturityDate,
    },
    offer: {
      monthlyPayment: firstMonth.offer,
      remainingPayments: round2(months.reduce((sum, m) => sum + (offerPayments.get(m) || 0), 0)),
      maturityDate: offer.totals.maturityDate,
    },
    savings: {
      monthlyPaymentChange: round2(firstMonth.offer - firstMonth.current),
      nominal: round2(nominalSaving),
      presentValue: round2(pvSaving),
      discountRatePct: Number(params.discountRatePct ?? DEFAULT_DISCOUNT_RATE_PCT),
    },
    breakEvenMonths: breakEvenMonth,
    verdict,
    series,
    warnings: [
      ...base.tracks
        .filter((track) => closeIds.includes(String(track.id)) && (track.tranches || []).some((tranche) => tranche.drawDate > date))
        .map((track) => ({ trackId: String(track.id), code: 'planned_tranches_not_refinanced', message: 'Drawdowns after the refinance date stay on the original terms' })),
      ...offer.warnings.filter((warning) => warning.code !== 'anchor_applied'),
    ],
  };
}

/** Offer for one track at today's BoI market average (same type, same maturity). */
function marketOfferFor(track, snapshot, market) {
  const remaining = snapshot?.maturityDate && snapshot?.nextPaymentDate
    ? Math.max(1, (Number(snapshot.maturityDate.slice(0, 4)) * 12 + Number(snapshot.maturityDate.slice(5, 7)))
      - (Number(snapshot.nextPaymentDate.slice(0, 4)) * 12 + Number(snapshot.nextPaymentDate.slice(5, 7))))
    : track.termMonths;
  if (track.type === 'fixed_unlinked' || track.type === 'legacy') {
    return market?.fixed_unlinked ? { type: 'fixed_unlinked', rate: market.fixed_unlinked.value, termMonths: remaining, benchmark: market.fixed_unlinked } : null;
  }
  if (track.type === 'fixed_cpi') {
    return market?.fixed_cpi ? { type: 'fixed_cpi', rate: market.fixed_cpi.value, termMonths: remaining, benchmark: market.fixed_cpi } : null;
  }
  if (track.type === 'variable_cpi' && market?.variable_cpi?.margin !== null && market?.variable_cpi?.margin !== undefined) {
    return {
      type: 'variable_cpi',
      rate: market.variable_cpi.value,
      margin: market.variable_cpi.margin,
      resetPeriodMonths: track.resetPeriodMonths || 60,
      termMonths: remaining,
      benchmark: market.variable_cpi,
    };
  }
  return null; // prime / unlinked variable: no public average
}

/** Per-track "would refinancing at the market average pay off?" */
function buildRefinanceCheck({ asOf, input, paths, market, switchingCosts }) {
  const current = buildMortgageSchedule({ ...input, paths, asOf });
  return input.tracks.map((track) => {
    const snapshot = current.current.byTrack.find((item) => String(item.trackId) === String(track.id));
    const base = { trackId: String(track.id), type: track.type, label: track.label || null, balance: snapshot?.balance ?? 0, currentRate: snapshot?.currentRate ?? null };
    if (!snapshot || !(snapshot.balance > 0)) return { ...base, status: 'closed' };
    const offer = marketOfferFor(track, snapshot, market);
    if (!offer) return { ...base, status: 'no_benchmark' };
    try {
      const comparison = compareRefinance({
        asOf, input, paths, market,
        closeTrackIds: [String(track.id)],
        offerTracks: [{ ...offer, sharePct: 100 }],
        switchingCosts: switchingCosts ?? DEFAULT_SWITCHING_COSTS,
      });
      return {
        ...base,
        status: 'checked',
        marketRate: offer.rate,
        marketPeriod: offer.benchmark?.period ?? null,
        verdict: comparison.verdict,
        monthlyPaymentChange: comparison.savings.monthlyPaymentChange,
        saving: comparison.savings.presentValue,
        fees: comparison.costs.total,
        breakEvenMonths: comparison.breakEvenMonths,
      };
    } catch (error) {
      return { ...base, status: 'error', error: error.message };
    }
  });
}

/**
 * Payment path under several scenarios. `runSchedule(scenario)` returns an
 * engine schedule; income (optional) gives the peak payment-to-income.
 */
function buildStressTest({ asOf, runSchedule, scenarios = STRESS_PRESETS, monthlyIncome = null }) {
  const startMonth = monthKey(asOf);
  const results = scenarios.map(({ key, scenario, label }) => {
    const schedule = runSchedule(scenario || {});
    const monthly = (schedule.monthly || []).filter((point) => point.month >= startMonth && point.payment > 0);
    const at = (months) => monthly.find((point) => point.month === monthKey(addMonths(asOf, months)))?.payment ?? null;
    const peak = monthly.reduce((best, point) => (point.payment > (best?.payment ?? -Infinity) ? point : best), null);
    return {
      key,
      label: label || null,
      scenario: scenario || {},
      paymentIn1y: at(12),
      paymentIn3y: at(36),
      paymentIn5y: at(60),
      peakPayment: peak ? round2(peak.payment) : null,
      peakMonth: peak ? peak.month : null,
      totalCost: schedule.totals.totalCost,
      peakPaymentToIncomePct: monthlyIncome && peak ? round2((peak.payment / monthlyIncome) * 100) : null,
      payments: monthly.map((point) => ({ month: point.month, payment: round2(point.payment) })),
    };
  });
  const base = results.find((item) => item.key === 'base') || results[0];
  return {
    asOf,
    monthlyIncome,
    scenarios: results.map((item) => ({
      ...item,
      totalCostDelta: base ? round2(item.totalCost - base.totalCost) : null,
      peakDeltaPct: base?.peakPayment ? round2(((item.peakPayment - base.peakPayment) / base.peakPayment) * 100) : null,
    })),
  };
}

module.exports = {
  DEFAULT_DISCOUNT_RATE_PCT,
  DEFAULT_SWITCHING_COSTS,
  STRESS_PRESETS,
  buildRefinanceCheck,
  buildStressTest,
  compareRefinance,
  marketOfferFor,
  resolveShares,
};
