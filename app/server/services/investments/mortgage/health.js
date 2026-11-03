'use strict';

/**
 * Pure "mortgage health" assessment: four dimensions with a verdict each
 * (good / watch / risk / unknown) and the numbers behind it. Deliberately no
 * single composite score.
 *
 * Thresholds:
 *  - Rates vs market: within ±0.15pp of the BoI average for the track type is
 *    "in line"; ≥0.15pp above is "watch", ≥0.5pp above is "risk".
 *  - Exposure: share of rate-sensitive debt (prime + variable) and the
 *    worst-case payment rise under the combined stress scenario.
 *  - Affordability: payment-to-income; BoI caps new loans at 50%, ≤30% is
 *    comfortable, ≤40% acceptable.
 *  - Equity: loan-to-value incl. undrawn commitments; ≤60% comfortable.
 */

const { addMonths, monthKey } = require('./dates.js');
const { nominalToEffective } = require('./engine.js');

const VERDICT_ORDER = { good: 0, watch: 1, risk: 2, unknown: -1 };

function worst(verdicts) {
  const known = verdicts.filter((verdict) => verdict !== 'unknown');
  if (known.length === 0) return 'unknown';
  return known.reduce((acc, verdict) => (VERDICT_ORDER[verdict] > VERDICT_ORDER[acc] ? verdict : acc), 'good');
}

function round(value, digits = 0) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * The "steady" monthly payment: first full month after the last drawdown (so
 * off-plan loans are judged on the full loan), or the next payment otherwise.
 */
function steadyMonth(schedule) {
  const lastDraw = (schedule?.tracks || [])
    .flatMap((track) => track.tranches || [])
    .reduce((latest, tranche) => (tranche.drawDate > latest ? tranche.drawDate : latest), schedule?.asOf || '');
  const reference = lastDraw > (schedule?.asOf || '') ? lastDraw : schedule?.asOf;
  return monthKey(addMonths(reference, 2));
}

function paymentInMonth(schedule, month) {
  return schedule?.monthly?.find((point) => point.month === month)?.payment ?? null;
}

function peakPayment(schedule, fromMonth) {
  const payments = (schedule?.monthly || []).filter((point) => point.month >= fromMonth).map((point) => point.payment);
  return payments.length ? Math.max(...payments) : null;
}

function assessRates(summary, inputTracks, market) {
  const byId = new Map((inputTracks || []).map((track) => [String(track.id), track]));
  const tracks = (summary?.tracks || []).filter((track) => track.balance > 0 || track.planned > 0).map((snapshot) => {
    const input = byId.get(String(snapshot.trackId)) || {};
    let benchmark = null;
    let yours = null;
    let comparison = 'rate';
    if (snapshot.type === 'fixed_unlinked' || snapshot.type === 'legacy') benchmark = market?.fixed_unlinked?.value ?? null;
    if (snapshot.type === 'fixed_cpi') benchmark = market?.fixed_cpi?.value ?? null;
    if (snapshot.type === 'variable_cpi' && market?.variable_cpi?.margin !== undefined && input.margin !== null && input.margin !== undefined) {
      benchmark = market.variable_cpi.margin;
      yours = Number(input.margin);
      comparison = 'margin';
    }
    if (yours === null && snapshot.currentRate !== null) {
      // Compare the effective equivalent of your rate: it is the higher of
      // the two conventions, so the comparison never flatters your loan.
      yours = nominalToEffective(snapshot.currentRate);
    }
    let verdict = 'unknown';
    let delta = null;
    if (benchmark !== null && yours !== null) {
      delta = yours - benchmark;
      verdict = delta >= 0.5 ? 'risk' : delta >= 0.15 ? 'watch' : 'good';
    }
    return {
      trackId: snapshot.trackId,
      type: snapshot.type,
      comparison,
      yours: round(yours, 2),
      benchmark: round(benchmark, 2),
      delta: round(delta, 2),
      verdict,
      benchmarkPeriod: comparison === 'margin' ? market?.variable_cpi?.period : (market?.[snapshot.type]?.period ?? null),
    };
  });
  return { verdict: worst(tracks.map((track) => track.verdict)), tracks };
}

function assessExposure(summary, schedules, steady) {
  const balances = { fixed: 0, prime: 0, variable: 0, cpiLinked: 0 };
  let total = 0;
  for (const track of summary?.tracks || []) {
    const amount = (track.balance || 0) + (track.planned || 0);
    total += amount;
    if (track.type === 'prime') balances.prime += amount;
    else if (track.type.startsWith('variable')) balances.variable += amount;
    else balances.fixed += amount;
    if (track.type === 'fixed_cpi' || track.type === 'variable_cpi') balances.cpiLinked += amount;
  }
  const share = (value) => (total > 0 ? (value / total) * 100 : null);
  const base = paymentInMonth(schedules.base, steady);
  const primeUp = paymentInMonth(schedules.prime1, steady);
  const worstPeak = peakPayment(schedules.combined, steady);
  const basePeak = peakPayment(schedules.base, steady);
  const perPrimePoint = base !== null && primeUp !== null ? primeUp - base : null;
  const worstIncreasePct = base ? ((worstPeak - base) / base) * 100 : null;
  const rateSensitiveShare = share(balances.prime + balances.variable);
  const fixedShare = share(balances.fixed);

  let verdict = 'unknown';
  if (rateSensitiveShare !== null && worstIncreasePct !== null) {
    if (rateSensitiveShare > 66 || worstIncreasePct > 40) verdict = 'risk';
    else if (rateSensitiveShare > 50 || worstIncreasePct > 25) verdict = 'watch';
    else verdict = 'good';
  }
  return {
    verdict,
    mix: {
      fixedPct: round(fixedShare, 1),
      primePct: round(share(balances.prime), 1),
      variablePct: round(share(balances.variable), 1),
      cpiLinkedPct: round(share(balances.cpiLinked), 1),
    },
    meetsFixedThird: fixedShare === null ? null : fixedShare >= 33.3,
    steadyMonth: steady,
    steadyPayment: round(base),
    perPrimePoint: round(perPrimePoint),
    basePeakPayment: round(basePeak),
    worstCasePayment: round(worstPeak),
    worstIncreasePct: round(worstIncreasePct, 1),
  };
}

function assessAffordability(income, exposure) {
  const monthlyIncome = income?.monthly ?? null;
  if (!monthlyIncome || !exposure.steadyPayment) {
    return { verdict: 'unknown', income, paymentToIncomePct: null, stressedPaymentToIncomePct: null };
  }
  const pti = (exposure.steadyPayment / monthlyIncome) * 100;
  const stressed = exposure.worstCasePayment ? (exposure.worstCasePayment / monthlyIncome) * 100 : null;
  const verdict = pti > 40 ? 'risk' : (pti > 30 || (stressed !== null && stressed > 45)) ? 'watch' : 'good';
  return {
    verdict,
    income,
    paymentToIncomePct: round(pti, 1),
    stressedPaymentToIncomePct: round(stressed, 1),
    regulatoryCapPct: 50,
    comfortablePct: 30,
  };
}

function assessEquity(summary, schedule, propertyValue, steady) {
  if (!propertyValue) return { verdict: 'unknown' };
  const debt = (summary?.balance || 0) + (summary?.undrawn || 0);
  const ltv = (debt / propertyValue) * 100;
  const point = schedule?.monthly?.find((item) => item.month === steady) || null;
  const principalShare = point && point.payment > 0 ? (point.principal / point.payment) * 100 : null;
  const below = (threshold) => schedule?.monthly?.find((item) => item.month >= steady && item.balance < propertyValue * threshold)?.month ?? null;
  const principalFirst = schedule?.monthly?.find((item) => item.month >= steady && item.principal > item.interest)?.month ?? null;
  const verdict = ltv > 75 ? 'risk' : ltv > 60 ? 'watch' : 'good';
  return {
    verdict,
    loanToValuePct: round(ltv, 1),
    priceDropToZeroEquityPct: round(Math.max(0, 100 - ltv), 1),
    principalShareOfPaymentPct: round(principalShare, 1),
    ltvBelow60: below(0.6),
    ltvBelow50: below(0.5),
    principalExceedsInterestFrom: principalFirst,
  };
}

/**
 * @param input {
 *   summary, inputTracks, market (average rates), income, propertyValue,
 *   schedules: { base, prime1, combined }, prepayment: { trackId, type, amount, interestSaved, feeEstimate } | null
 * }
 */
function buildMortgageHealth(input) {
  const steady = steadyMonth(input.schedules.base);
  const rates = assessRates(input.summary, input.inputTracks, input.market);
  const exposure = assessExposure(input.summary, input.schedules, steady);
  const affordability = assessAffordability(input.income, exposure);
  const equity = assessEquity(input.summary, input.schedules.base, input.propertyValue, steady);
  return {
    overall: worst([rates.verdict, exposure.verdict, affordability.verdict, equity.verdict]),
    rates,
    exposure,
    affordability,
    equity,
    prepayment: input.prepayment || null,
  };
}

module.exports = {
  assessAffordability,
  assessEquity,
  assessExposure,
  assessRates,
  buildMortgageHealth,
  steadyMonth,
  worst,
};
