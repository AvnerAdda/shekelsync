'use strict';

/**
 * Which bank debits are payments of a given mortgage.
 *
 * A matcher is { vendor, accountNumber, pattern } (all optional except
 * pattern). It is either saved on the loan or derived from the debits linked
 * to the property account whose name looks like a mortgage payment.
 */

const {
  isMortgagePayment,
  normalizeName,
  transactionDate,
} = require('../../forecast-models/investment-schedule.js');

function cleanMatcher(matcher) {
  if (!matcher) return null;
  const pattern = normalizeName(matcher.pattern || '');
  if (!pattern) return null;
  return {
    vendor: matcher.vendor || null,
    accountNumber: matcher.accountNumber || null,
    pattern,
    source: matcher.source || 'saved',
  };
}

function matcherFromLoan(loan) {
  return cleanMatcher(loan?.paymentMatch ? { ...loan.paymentMatch, source: 'saved' } : null);
}

/** Most frequent (vendor, account, name) among mortgage-looking outflows. */
function deriveMatcher(transactions) {
  const counts = new Map();
  for (const row of transactions || []) {
    if (!(Number(row.price) < 0) || !isMortgagePayment(row.name)) continue;
    const key = JSON.stringify([row.vendor || null, row.account_number || null, normalizeName(row.name)]);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size === 0) return null;
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const [vendor, accountNumber, pattern] = JSON.parse(best);
  return cleanMatcher({ vendor, accountNumber, pattern, source: 'linked_transactions' });
}

function matchesDebit(matcher, row) {
  if (!matcher || !row) return false;
  if (!(Number(row.price) < 0)) return false;
  if (matcher.vendor && row.vendor && matcher.vendor !== row.vendor) return false;
  if (matcher.accountNumber && row.account_number && matcher.accountNumber !== row.account_number) return false;
  return normalizeName(row.name).includes(matcher.pattern);
}

/** Forecast event / prediction produced by the generic investment schedule. */
function matchesForecastSource(matcher, item) {
  if (!matcher || !item) return false;
  if (matcher.vendor && item.vendor && matcher.vendor !== item.vendor) return false;
  if (matcher.accountNumber && item.accountNumber && matcher.accountNumber !== item.accountNumber) return false;
  const name = normalizeName(item.transactionName || item.displayName || item.name || '');
  return Boolean(name) && name.includes(matcher.pattern);
}

module.exports = {
  cleanMatcher,
  deriveMatcher,
  isMortgagePayment,
  matcherFromLoan,
  matchesDebit,
  matchesForecastSource,
  normalizeName,
  transactionDate,
};
