// Some card importers pass the bank's currency symbol through instead of ISO ILS.
function normalizePlanningCurrency(value, fallback = 'ILS') {
  const currency = String(value ?? '').normalize('NFKC')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().toUpperCase();
  if (!currency) return fallback;
  if (['ILS', 'NIS', '₪', 'שח', 'ש"ח', 'ש״ח'].includes(currency)) return 'ILS';
  return currency;
}

module.exports = { normalizePlanningCurrency };
