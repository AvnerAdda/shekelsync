const math = require('./planning-math.js');
const { normalizePlanningCurrency } = require('./planning-currency.js');

/** Use the forecast's selected recurring occurrences, not small probability tails. */
function detectNextIncome(forecast, today, end) {
  const patterns = new Map((forecast?.categoryPatterns || []).map((pattern) => [pattern.patternKey, pattern]));
  for (const day of [...(forecast?.dailyForecasts || [])].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!math.validDate(day.date) || day.date <= today || day.date > end) continue;
    const incomes = (day.predictions || []).filter((prediction) => {
      if (prediction.categoryType !== 'income' || prediction.incomeType !== 'operating'
        || !(prediction.probabilityWeightedAmount > 0)) return false;
      if (prediction.isUserResolvedPattern) return true;
      if (prediction.predictionKind === 'recurring_income' && prediction.isCalibrated && prediction.probability >= 0.5) return true;
      const pattern = patterns.get(prediction.patternKey);
      return pattern && !pattern.insufficientData && pattern.monthsOfHistory >= 2
        && pattern.confidence >= 0.5 && ['monthly', 'weekly', 'bi-monthly', 'daily'].includes(pattern.patternType)
        && math.validDate(String(pattern.lastOccurrence || '').slice(0, 10))
        && String(pattern.lastOccurrence).slice(0, 10) >= math.shiftDays(today, -75)
        && (prediction.isChosenOccurrence || prediction.probability >= 0.5);
    });
    if (incomes.length) return day.date;
  }
  return null;
}

const dateOf = (value) => String(value || '').slice(0, 10);
const accountKey = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '');

/** Imported processing dates describe the billing cycle, not the purchase date. */
function detectCardCommitments({ today, banks, cards, transactions, pairings }) {
  if (!cards.length) return { amount: 0, source: 'imported' };
  if (cards.some((card) => !card.last_scrape_success && !transactions.some((row) => row.vendor === card.vendor))) {
    return { amount: null, source: 'unavailable' };
  }
  if (cards.some((card) => math.validDate(dateOf(card.last_scrape_success))
    && dateOf(card.last_scrape_success) < math.shiftDays(today, -7))) {
    return { amount: null, source: 'unavailable', reason: 'STALE_CARD_DATA' };
  }
  const balanceDates = banks.map((bank) => dateOf(bank.last_update_date)).filter(math.validDate).sort();
  const defaultCutoff = balanceDates[0] || today;
  let estimated = false;
  const cycles = new Map();
  for (const transaction of transactions) {
    if (!['completed', 'pending'].includes(transaction.status)) continue;
    const price = Number(transaction.price);
    if (transaction.price == null || !Number.isFinite(price)) return { amount: null, source: 'unavailable', reason: 'INVALID_CARD_AMOUNT' };
    const matchingPairs = pairings.filter((pairing) => pairing.credit_card_vendor === transaction.vendor
      && (!pairing.credit_card_account_number || accountKey(pairing.credit_card_account_number) === accountKey(transaction.account_number)));
    const matchedBanks = banks.filter((bank) => {
      const vendor = bank.institution?.vendor_code || bank.institution_vendor_code;
      return matchingPairs.some((pairing) => accountKey(pairing.bank_account_number)
        && accountKey(pairing.bank_account_number) === accountKey(bank.account_number)
        && (!vendor || vendor === pairing.bank_vendor));
    });
    const pairedDates = matchedBanks.map((bank) => dateOf(bank.last_update_date)).filter(math.validDate).sort();
    const cutoff = pairedDates[0] || defaultCutoff;
    const processed = dateOf(transaction.processed_date);
    const purchased = dateOf(transaction.date);
    if (math.validDate(processed)) {
      if (processed <= cutoff && transaction.status !== 'pending') continue;
    } else {
      // Without a billing date, reserve recent purchases conservatively rather than
      // presenting a guess as a settled charge. This estimate updates on every sync.
      if (transaction.status !== 'pending' && purchased < math.shiftDays(cutoff, -45)) continue;
      estimated = true;
    }
    if (normalizePlanningCurrency(transaction.charged_currency) !== 'ILS') {
      return { amount: null, source: 'unavailable', reason: 'UNSUPPORTED_CARD_CURRENCY' };
    }
    const key = JSON.stringify([transaction.vendor, transaction.account_number || '', math.validDate(processed) ? processed : 'undated']);
    // A credit in another card or billing cycle cannot fund an unpaid bill.
    cycles.set(key, (cycles.get(key) || 0) - Math.round(price * 100));
  }
  return { amount: [...cycles.values()].reduce((sum, amount) => sum + Math.max(0, amount), 0) / 100,
    source: estimated ? 'estimated' : 'imported' };
}

module.exports = { detectNextIncome, detectCardCommitments };
