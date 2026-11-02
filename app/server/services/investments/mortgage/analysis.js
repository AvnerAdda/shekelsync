'use strict';

/**
 * Pure sale / break-even analysis for a property with a mortgage.
 *
 * All amounts are for the owner's share (ownership %) unless named gross.
 * Rules modelled (Israel), all simplified and labelled as estimates:
 *  - Early repayment (עמלת פירעון מוקדם): capitalization difference on fixed
 *    tracks (and CPI-linked variable tracks between resets) discounted at the
 *    BoI average rate for the track type; CPI-average fee on linked tracks;
 *    a small operational fee. No age / notice discounts are applied, so the
 *    fee is an upper-bound estimate.
 *  - Capital gains tax (מס שבח): 0 with the single-apartment exemption,
 *    otherwise a flat rate on the real (CPI-adjusted) gain.
 *  - Selling costs: broker + lawyer as % of price, plus VAT.
 */

const { addMonths, monthKey, monthsBetween } = require('./dates.js');

const DEFAULT_SETTINGS = Object.freeze({
  usageType: 'owner_occupied',
  marketRent: null,
  rentGrowthPct: 2.5,
  vacancyPct: 5,
  rentalTaxPct: 10,
  alternativeReturnPct: 5,
  alternativeTaxPct: 25,
  brokerPct: 2,
  lawyerPct: 0.5,
  vatPct: 18,
  otherSaleCosts: 0,
  singleApartmentExemption: true,
  capitalGainsTaxPct: 25,
  monthlyIncomeOverride: null,
  deliveryDate: null,
});

const OPERATIONAL_FEE = 60;
const DEDUCTIBLE_COST_TYPES = new Set(['purchase_tax', 'lawyer', 'broker', 'appraisal', 'renovation', 'other']);

function round(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function num(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveSettings(raw = {}) {
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === '') continue;
    settings[key] = typeof DEFAULT_SETTINGS[key] === 'boolean' ? Boolean(raw[key]) : raw[key];
  }
  for (const key of ['marketRent', 'rentGrowthPct', 'vacancyPct', 'rentalTaxPct', 'alternativeReturnPct', 'alternativeTaxPct',
    'brokerPct', 'lawyerPct', 'vatPct', 'otherSaleCosts', 'capitalGainsTaxPct', 'monthlyIncomeOverride']) {
    settings[key] = num(settings[key], DEFAULT_SETTINGS[key]);
  }
  return settings;
}

// ---------------------------------------------------------------------------
// Early repayment fee estimate
// ---------------------------------------------------------------------------

/** Annual market rate used to discount a track's remaining payments, or null. */
function benchmarkRate(type, market) {
  if (type === 'fixed_unlinked' || type === 'legacy') return num(market?.fixed_unlinked?.value);
  if (type === 'fixed_cpi') return num(market?.fixed_cpi?.value);
  if (type === 'variable_cpi') return num(market?.variable_cpi?.value);
  return null;
}

function annuityFactor(monthlyRate, periods) {
  if (periods <= 0) return 0;
  if (Math.abs(monthlyRate) < 1e-12) return periods;
  return (1 - Math.pow(1 + monthlyRate, -periods)) / monthlyRate;
}

/**
 * Capitalization fee for repaying `balance` today: PV of the contractual
 * payments (at the track's own rate) discounted at the market rate, minus the
 * balance. For variable tracks only the payments up to the next reset count,
 * plus the balance outstanding at the reset. Zero when the market rate is at
 * or above your rate.
 */
function capitalizationFee(balance, ownMonthly, marketMonthly, periods, periodsToReset = null) {
  if (!(balance > 0) || periods <= 0) return 0;
  const payment = balance / annuityFactor(ownMonthly, periods);
  let pv;
  if (periodsToReset !== null && periodsToReset < periods) {
    const h = Math.max(1, periodsToReset);
    const growth = Math.pow(1 + ownMonthly, h);
    const balanceAtReset = Math.abs(ownMonthly) < 1e-12
      ? balance - payment * h
      : balance * growth - payment * ((growth - 1) / ownMonthly);
    pv = payment * annuityFactor(marketMonthly, h) + balanceAtReset / Math.pow(1 + marketMonthly, h);
  } else {
    pv = payment * annuityFactor(marketMonthly, periods);
  }
  return Math.max(0, pv - balance);
}

/**
 * @param scheduleTrack  engine output track ({ trackId, type, rows, maturityDate })
 * @param inputTrack     engine input track (for drawDate / resetPeriodMonths)
 * @param context        { asOf, market, cpiKnownIndexAt }
 */
function estimateTrackPrepaymentFee(scheduleTrack, inputTrack, { asOf, market, cpiKnownIndexAt }) {
  const rows = scheduleTrack.rows || [];
  const lastPast = [...rows].reverse().find((row) => row.date <= asOf) || null;
  const nextRow = rows.find((row) => row.date > asOf) || null;
  // Only what is drawn today can be repaid today (planned drawdowns excluded).
  const drawnToday = (inputTrack?.tranches || [])
    .filter((tranche) => tranche.drawDate <= asOf)
    .reduce((sum, tranche) => sum + Number(tranche.amount || 0), 0);
  const balance = lastPast ? lastPast.closingBalance : drawnToday;
  const result = { trackId: scheduleTrack.trackId, type: scheduleTrack.type, balance: round(balance), capitalization: 0, cpiAverage: 0, basis: null };
  if (!(balance > 0) || !nextRow) return result;

  const linked = scheduleTrack.type === 'fixed_cpi' || scheduleTrack.type === 'variable_cpi';
  const isFixed = ['fixed_unlinked', 'fixed_cpi', 'legacy'].includes(scheduleTrack.type);
  const benchmark = benchmarkRate(scheduleTrack.type, market);

  if (isFixed || scheduleTrack.type === 'variable_cpi') {
    if (benchmark === null || nextRow.annualRate === null) {
      result.basis = 'no_benchmark';
    } else {
      const periods = scheduleTrack.maturityDate ? Math.max(1, monthsBetween(asOf, scheduleTrack.maturityDate)) : rows.filter((row) => row.date > asOf).length;
      let periodsToReset = null;
      if (scheduleTrack.type === 'variable_cpi' && inputTrack?.resetPeriodMonths) {
        const firstDraw = inputTrack.tranches?.[0]?.drawDate || asOf;
        const elapsed = monthsBetween(firstDraw, asOf);
        const nextResetMonths = Math.ceil((elapsed + 1) / inputTrack.resetPeriodMonths) * inputTrack.resetPeriodMonths;
        periodsToReset = Math.max(1, nextResetMonths - elapsed);
      }
      // The BoI benchmark is treated as an effective annual rate (lower monthly
      // discount rate → higher fee), so the estimate errs on the high side.
      const marketMonthly = Math.pow(1 + benchmark / 100, 1 / 12) - 1;
      result.capitalization = round(capitalizationFee(balance, nextRow.annualRate / 1200, marketMonthly, periods, periodsToReset));
      result.basis = 'market_average';
      result.benchmarkRate = benchmark;
      result.yourRate = nextRow.annualRate;
    }
  } else {
    result.basis = scheduleTrack.type === 'prime' ? 'not_applicable' : 'no_benchmark';
  }

  if (linked && typeof cpiKnownIndexAt === 'function') {
    // CPI-average fee: the latest known index above the 12-month average.
    const known = cpiKnownIndexAt(asOf);
    const history = [];
    for (let back = 0; back < 12; back += 1) history.push(cpiKnownIndexAt(addMonths(asOf, -back)));
    const average = history.reduce((sum, value) => sum + value, 0) / history.length;
    if (known > 0 && average > 0 && known > average) {
      result.cpiAverage = round(balance * ((known - average) / average));
    }
  }
  return result;
}

function estimatePrepaymentFees(schedule, inputTracks, context) {
  const byId = new Map((inputTracks || []).map((track) => [String(track.id), track]));
  const tracks = (schedule?.tracks || []).map((track) => estimateTrackPrepaymentFee(track, byId.get(String(track.trackId)), context));
  const total = tracks.reduce((sum, track) => sum + (track.capitalization || 0) + (track.cpiAverage || 0), 0)
    + (tracks.length ? OPERATIONAL_FEE : 0);
  return { tracks, operational: tracks.length ? OPERATIONAL_FEE : 0, total: round(total) };
}

// ---------------------------------------------------------------------------
// Sale math
// ---------------------------------------------------------------------------

function balanceAt(schedule, date) {
  if (!schedule?.monthly?.length) return 0;
  const key = monthKey(date);
  let found = null;
  for (const point of schedule.monthly) {
    if (point.month <= key) found = point;
    else break;
  }
  return found ? found.balance : 0;
}

function saleCosts(price, settings) {
  const pct = ((settings.brokerPct || 0) + (settings.lawyerPct || 0)) / 100;
  return price * pct * (1 + (settings.vatPct || 0) / 100) + (settings.otherSaleCosts || 0);
}

function capitalGainsTax(price, context) {
  const { settings, purchasePrice, deductibleCosts, purchaseDate, saleDate, cpiKnownIndexAt } = context;
  if (settings.singleApartmentExemption || !(purchasePrice > 0)) return 0;
  let inflation = 1;
  if (typeof cpiKnownIndexAt === 'function' && purchaseDate) {
    const from = cpiKnownIndexAt(purchaseDate);
    const to = cpiKnownIndexAt(saleDate);
    if (from > 0 && to > 0) inflation = to / from;
  }
  const realGain = price - saleCosts(price, settings) - (purchasePrice + deductibleCosts) * inflation;
  return Math.max(0, realGain) * (settings.capitalGainsTaxPct / 100);
}

/** Bisection for the smallest gross price where f(price) >= target (f increasing). */
function solvePrice(f, target, high) {
  let lo = 0;
  let hi = Math.max(high, 1);
  let guard = 0;
  while (f(hi) < target && guard < 20) {
    hi *= 2;
    guard += 1;
  }
  if (f(hi) < target) return null;
  if (f(lo) >= target) return 0;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Cash the owner has put in so far (or by `date`): own-funds costs dated on or
 * before the date, plus mortgage payments made.
 */
function cashInvestedBy(date, { costs, schedule, ownership }) {
  const upfront = costs
    .filter((cost) => (cost.date || '0000-00-00') <= date)
    .reduce((sum, cost) => sum + cost.amount, 0);
  let payments = 0;
  for (const point of schedule?.monthly || []) {
    if (point.month > monthKey(date)) break;
    payments += point.payment + point.prepayment + point.fees;
  }
  return { upfront, payments: payments * ownership, total: upfront + payments * ownership };
}

/**
 * @param input {
 *   asOf, property: { value, ownershipPct, purchasePrice, purchaseDate, annualGrowthPct, annualOwnerCosts },
 *   schedule, inputTracks, costs: [{ type, amount, date, status, deductible }], settings,
 *   market (average mortgage rates), cpiKnownIndexAt, approvedAmount
 * }
 */
function buildSaleAnalysis(input) {
  const { asOf, schedule, inputTracks, market, cpiKnownIndexAt } = input;
  const settings = resolveSettings(input.settings);
  const property = input.property || {};
  const ownership = (num(property.ownershipPct, 100) || 100) / 100;
  const value = num(property.value);
  const purchasePrice = num(property.purchasePrice);
  const purchaseDate = property.purchaseDate || null;
  const growth = num(property.annualGrowthPct, 3) / 100;
  const annualOwnerCosts = num(property.annualOwnerCosts, 0);
  const assumptions = [];

  // Own-funds costs: explicit entries, or a derived down payment.
  const costs = (input.costs || []).map((cost) => ({
    type: cost.type,
    amount: num(cost.amount, 0),
    date: cost.date || purchaseDate || asOf,
    status: cost.status || 'paid',
    deductible: cost.deductible !== false && DEDUCTIBLE_COST_TYPES.has(cost.type),
  }));
  if (!costs.some((cost) => cost.type === 'down_payment') && purchasePrice > 0) {
    const financed = num(input.approvedAmount) ?? (schedule?.totals?.drawn || 0);
    const derived = Math.max(0, purchasePrice - financed) * ownership;
    if (derived > 0) {
      costs.push({ type: 'down_payment', amount: derived, date: purchaseDate || asOf, status: 'paid', deductible: false, derived: true });
      assumptions.push('down_payment_derived');
    }
  }
  if (!costs.some((cost) => cost.type === 'purchase_tax')) assumptions.push('purchase_tax_missing');
  const deductibleCosts = costs.filter((cost) => cost.deductible).reduce((sum, cost) => sum + cost.amount, 0) / ownership;

  if (input.alternativeOnly) {
    // Only the own-vs-alternative path (used by the appreciation search).
    const taxContextOnly = (saleDate) => ({ settings, purchasePrice, deductibleCosts, purchaseDate, saleDate, cpiKnownIndexAt });
    const proceedsAt = (price, date, payoff) => ownership
      * (price - saleCosts(price, settings) - capitalGainsTax(price, taxContextOnly(date)) - payoff);
    return {
      alternative: buildAlternativeComparison({
        asOf, schedule, settings, costs, ownership, value, growth, annualOwnerCosts, netProceeds: proceedsAt, purchaseDate,
      }),
    };
  }

  const fees = estimatePrepaymentFees(schedule, inputTracks, { asOf, market, cpiKnownIndexAt });
  // Debt to clear today: drawn balance (+ undrawn commitments are paid by the
  // buyer's price only after they are drawn, so they are excluded here) + fees.
  const balanceToday = schedule?.current?.balance || 0;
  const accruedInterest = (() => {
    const next = schedule?.current?.byTrack || [];
    return next.reduce((sum, track) => {
      if (!(track.balance > 0) || track.currentRate === null || !track.nextPaymentDate) return sum;
      const daysToNext = Math.max(0, (Date.parse(`${track.nextPaymentDate}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000);
      const accruedDays = Math.max(0, 30 - daysToNext);
      return sum + track.balance * (track.currentRate / 100) * (accruedDays / 365);
    }, 0);
  })();
  const undrawn = schedule?.current?.byTrack?.reduce((sum, track) => sum + (track.planned || 0), 0) || 0;
  const payoffToday = balanceToday + accruedInterest + fees.total;

  const taxContext = (saleDate) => ({ settings, purchasePrice, deductibleCosts, purchaseDate, saleDate, cpiKnownIndexAt });
  // For off-plan purchases still owed to the developer, a sale today also has
  // to settle the undrawn part of the price.
  const netProceeds = (price, date = asOf, payoff = payoffToday + undrawn) => ownership
    * (price - saleCosts(price, settings) - capitalGainsTax(price, taxContext(date)) - payoff);

  const invested = cashInvestedBy(asOf, { costs: costs.filter((cost) => cost.status === 'paid'), schedule, ownership });
  const plannedUpfront = costs.filter((cost) => cost.status === 'planned').reduce((sum, cost) => sum + cost.amount, 0);

  const searchHigh = Math.max(value || 0, purchasePrice || 0, payoffToday + undrawn) * 1.5;
  const clearDebtPrice = solvePrice((price) => netProceeds(price), 0, searchHigh);
  const recoverCashPrice = solvePrice((price) => netProceeds(price), invested.total, searchHigh);
  const proceedsToday = value ? netProceeds(value) : null;

  const breakdown = value ? {
    price: round(value * ownership),
    saleCosts: round(saleCosts(value, settings) * ownership),
    capitalGainsTax: round(capitalGainsTax(value, taxContext(asOf)) * ownership),
    mortgagePayoff: round((balanceToday + accruedInterest) * ownership),
    undrawnCommitment: round(undrawn * ownership),
    prepaymentFees: round(fees.total * ownership),
    netProceeds: round(proceedsToday),
  } : null;

  // Price sensitivity: proceeds and profit across ±30% of today's value.
  const sensitivity = value
    ? Array.from({ length: 13 }, (_, index) => {
      const factor = 0.7 + index * 0.05;
      const price = value * factor;
      const proceeds = netProceeds(price);
      return { changePct: round((factor - 1) * 100), price: round(price), netProceeds: round(proceeds), profit: round(proceeds - invested.total) };
    })
    : [];

  // Own vs. alternative (rent + invest), yearly from today.
  const alternative = buildAlternativeComparison({
    asOf, schedule, settings, costs, ownership, value, growth, annualOwnerCosts, netProceeds, purchaseDate,
  });

  return {
    asOf,
    settings,
    assumptions,
    property: {
      value: round(value),
      ownershipPct: ownership * 100,
      purchasePrice: round(purchasePrice),
      purchaseDate,
    },
    debt: {
      balance: round(balanceToday),
      accruedInterest: round(accruedInterest),
      undrawn: round(undrawn),
      prepaymentFees: fees,
      payoffToday: round(payoffToday + undrawn),
    },
    cashInvested: { upfront: round(invested.upfront), payments: round(invested.payments), total: round(invested.total), plannedUpfront: round(plannedUpfront) },
    costs: costs.map((cost) => ({ ...cost, amount: round(cost.amount) })),
    breakEven: {
      clearDebtPrice: round(clearDebtPrice),
      recoverCashPrice: round(recoverCashPrice),
      clearDebtVsValuePct: clearDebtPrice !== null && value ? ((clearDebtPrice / value) - 1) * 100 : null,
      recoverCashVsValuePct: recoverCashPrice !== null && value ? ((recoverCashPrice / value) - 1) * 100 : null,
    },
    today: breakdown ? { ...breakdown, profit: round(proceedsToday - invested.total) } : null,
    sensitivity,
    alternative,
  };
}

/**
 * Wealth if you keep the property vs. if you had rented and invested the same
 * cash instead. Each month the owner pays mortgage + owner costs and enjoys
 * the rent (saved rent if living there, net rent if let); the renter invests
 * that difference. Owner wealth at T = net sale proceeds at T.
 */
function buildAlternativeComparison({ asOf, schedule, settings, costs, ownership, value, growth, annualOwnerCosts, netProceeds, purchaseDate }) {
  if (!value || !schedule?.monthly?.length) return null;
  // Start at the first cash outlay (down payment, costs) or purchase, so no
  // upfront payment is left out of the alternative portfolio.
  const start = [purchaseDate, ...costs.map((cost) => cost.date), asOf]
    .filter((date) => typeof date === 'string' && date.length >= 10)
    .sort()[0];
  const rentStart = settings.deliveryDate || start;
  const monthlyReturn = Math.pow(1 + settings.alternativeReturnPct / 100, 1 / 12) - 1;
  const rentGrowth = Math.pow(1 + settings.rentGrowthPct / 100, 1 / 12) - 1;
  const baseRent = num(settings.marketRent, 0) * ownership;
  const lastMonth = schedule.monthly[schedule.monthly.length - 1].month;
  const horizonEnd = addMonths(`${lastMonth}-01`, 0);

  const paymentsByMonth = new Map(schedule.monthly.map((point) => [point.month, (point.payment + point.prepayment + point.fees) * ownership]));
  let portfolio = 0;
  let contributions = 0;
  const points = [];
  let crossover = null;
  let previousAdvantage = null;
  const totalMonths = monthsBetween(start, horizonEnd);
  for (let k = 0; k <= totalMonths; k += 1) {
    const date = addMonths(start, k);
    const month = monthKey(date);
    portfolio *= 1 + monthlyReturn;
    // Upfront own funds (down payment, purchase costs) land in the portfolio when spent.
    for (const cost of costs) {
      if (monthKey(cost.date) === month) {
        portfolio += cost.amount;
        contributions += cost.amount;
      }
    }
    const rentMonths = monthsBetween(rentStart, date);
    let rentBenefit = 0;
    if (date >= rentStart && baseRent > 0) {
      const rent = baseRent * Math.pow(1 + rentGrowth, Math.max(0, rentMonths));
      rentBenefit = settings.usageType === 'rented'
        ? rent * (1 - settings.vacancyPct / 100) * (1 - settings.rentalTaxPct / 100)
        : settings.usageType === 'owner_occupied' ? rent : 0;
    }
    const ownerOutflow = (paymentsByMonth.get(month) || 0) + (annualOwnerCosts * ownership) / 12 - rentBenefit;
    portfolio += ownerOutflow;
    contributions += ownerOutflow;

    if (date >= asOf && (month.endsWith('-12') || k === totalMonths || points.length === 0)) {
      const years = monthsBetween(asOf, date) / 12;
      const projectedValue = value * Math.pow(1 + growth, years);
      // Planned drawdowns not yet made are still owed (off-plan purchase price).
      const stillToDraw = (schedule.tracks || [])
        .flatMap((track) => track.tranches || [])
        .filter((tranche) => tranche.drawDate > date)
        .reduce((sum, tranche) => sum + tranche.amount, 0);
      const payoff = balanceAt(schedule, date) + stillToDraw;
      const ownerWealth = netProceeds(projectedValue, date, payoff);
      const gains = Math.max(0, portfolio - contributions);
      const alternativeWealth = portfolio - gains * (settings.alternativeTaxPct / 100);
      const advantage = ownerWealth - alternativeWealth;
      points.push({
        year: Number(month.slice(0, 4)),
        date,
        propertyValue: round(projectedValue * ownership),
        ownerWealth: round(ownerWealth),
        alternativeWealth: round(alternativeWealth),
        advantage: round(advantage),
      });
      if (crossover === null && previousAdvantage !== null && previousAdvantage < 0 && advantage >= 0) crossover = Number(month.slice(0, 4));
      previousAdvantage = advantage;
    }
  }
  const first = points[0];
  return {
    points,
    advantageToday: first ? first.advantage : null,
    crossoverYear: first && first.advantage >= 0 ? first.year : crossover,
    alwaysBehind: points.length > 0 && points.every((point) => point.advantage < 0),
    rentConfigured: baseRent > 0,
  };
}

/** Annual appreciation needed for owning to match the alternative after `years`. */
function breakEvenAppreciation(input, years = 10) {
  const target = addMonths(input.asOf, years * 12).slice(0, 4);
  const advantageAt = (growthPct) => {
    const analysis = buildSaleAnalysis({ ...input, alternativeOnly: true, property: { ...input.property, annualGrowthPct: growthPct } });
    const point = analysis.alternative?.points.find((item) => String(item.year) === target);
    return point ? point.advantage : null;
  };
  let lo = -10;
  let hi = 20;
  const loValue = advantageAt(lo);
  const hiValue = advantageAt(hi);
  if (loValue === null || hiValue === null) return null;
  if (loValue >= 0) return lo;
  if (hiValue < 0) return null;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (advantageAt(mid) >= 0) hi = mid;
    else lo = mid;
  }
  return Math.round(hi * 100) / 100;
}

module.exports = {
  DEFAULT_SETTINGS,
  OPERATIONAL_FEE,
  breakEvenAppreciation,
  buildSaleAnalysis,
  capitalizationFee,
  capitalGainsTax,
  estimatePrepaymentFees,
  estimateTrackPrepaymentFee,
  resolveSettings,
  saleCosts,
  solvePrice,
};
