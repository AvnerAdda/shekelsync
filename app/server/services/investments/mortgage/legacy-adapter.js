'use strict';

/**
 * Converts the legacy single-mortgage columns of real_estate_properties
 * (balance, payment, rate, term) into one engine track, at read time.
 * Nothing is migrated: properties keep working exactly as before until the
 * user converts them to detailed tracks.
 */

const { addMonths, isIsoDate, monthsBetween } = require('./dates.js');
const { remainingTermFromPayment } = require('./engine.js');

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @returns {{ mode: 'none' } | { mode: 'static', balance, payment } |
 *           { mode: 'amortizing', track, termSource }}
 */
function legacyProfileToTrack(profile = {}, { asOf } = {}) {
  const balance = toNumber(profile.mortgage_balance);
  if (!(balance > 0)) return { mode: 'none' };

  const rate = toNumber(profile.mortgage_interest_rate);
  const payment = toNumber(profile.monthly_mortgage_payment);
  const termYears = toNumber(profile.mortgage_term_years);
  const anchorDate = isIsoDate(profile.last_valuation_date)
    ? String(profile.last_valuation_date).slice(0, 10)
    : asOf;

  let remainingMonths = null;
  let termSource = null;
  if (rate !== null && rate >= 0 && payment > 0) {
    const solved = remainingTermFromPayment(balance, rate / 1200, payment);
    if (Number.isFinite(solved) && solved > 0 && solved <= 600) {
      remainingMonths = solved;
      termSource = 'solved_from_payment';
    }
  }
  if (remainingMonths === null && termYears > 0 && isIsoDate(profile.purchase_date)) {
    const elapsed = Math.max(0, monthsBetween(String(profile.purchase_date).slice(0, 10), anchorDate));
    const left = Math.round(termYears * 12) - elapsed;
    if (left > 0) {
      remainingMonths = left;
      termSource = 'term_minus_elapsed';
    }
  }
  if (remainingMonths === null && termYears > 0 && !isIsoDate(profile.purchase_date)) {
    remainingMonths = Math.round(termYears * 12);
    termSource = 'full_term';
  }
  if (remainingMonths === null || !anchorDate) {
    return { mode: 'static', balance, payment };
  }

  return {
    mode: 'amortizing',
    termSource,
    track: {
      id: 'legacy',
      type: 'legacy',
      label: null,
      rate: rate ?? 0,
      rateConvention: 'nominal',
      amortization: 'spitzer',
      termMonths: remainingMonths,
      firstPaymentDate: addMonths(anchorDate, 1),
      tranches: [{ id: 'legacy-balance', drawDate: anchorDate, amount: balance, status: 'drawn' }],
    },
  };
}

module.exports = { legacyProfileToTrack };
