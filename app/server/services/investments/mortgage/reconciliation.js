'use strict';

/**
 * Pure month-by-month comparison of the computed mortgage payments with the
 * debits actually taken by the bank.
 *
 * Status per month:
 *  - ok:         |actual − expected| within tolerance
 *  - drift:      both present, but they differ beyond tolerance
 *  - missing:    a payment was expected in a past month and nothing was debited
 *  - unexpected: a debit with no computed payment that month (e.g. a first
 *                partial-month payment before the schedule starts)
 *  - no_data:    expected, but before the bank history starts (not reported)
 * Tolerance: max(₪20, 1% of expected), widened by 1% of the CPI-linked part.
 */

const { monthKey } = require('./dates.js');
const { matchesDebit, transactionDate } = require('./debit-matcher.js');

function round2(value) {
  return Math.round(value * 100) / 100;
}

function expectedByMonth(schedule) {
  const months = new Map();
  for (const point of schedule?.monthly || []) {
    if (point.payment > 0) months.set(point.month, point.payment);
  }
  return months;
}

/** Per-track payments in a month, and tracks whose payments start later. */
function monthComposition(schedule, month) {
  const paying = [];
  const notYetPaying = [];
  for (const track of schedule?.tracks || []) {
    const rows = (track.rows || []).filter((row) => monthKey(row.date) === month && row.payment > 0);
    const first = (track.rows || []).find((row) => row.payment > 0) || null;
    if (rows.length) {
      paying.push({
        trackId: track.trackId,
        type: track.type,
        label: track.label || null,
        payment: round2(rows.reduce((sum, row) => sum + row.payment, 0)),
        date: rows[0].date,
      });
    } else if (first && monthKey(first.date) > month && !(track.closedDate && monthKey(track.closedDate) <= month)) {
      notYetPaying.push({ trackId: track.trackId, type: track.type, label: track.label || null, firstPaymentDate: first.date });
    }
  }
  return { paying, notYetPaying };
}

function linkedShare(schedule) {
  const tracks = schedule?.current?.byTrack || [];
  const total = tracks.reduce((sum, track) => sum + track.balance, 0);
  if (!(total > 0)) return 0;
  return tracks.filter((track) => track.type === 'fixed_cpi' || track.type === 'variable_cpi')
    .reduce((sum, track) => sum + track.balance, 0) / total;
}

/**
 * @param input { schedule, transactions, matcher, today ('YYYY-MM-DD') }
 */
function reconcileMortgage({ schedule, transactions, matcher, today, historyStart = null }) {
  if (!matcher) {
    return { status: 'no_matcher', months: [], matchedCount: 0, summary: null };
  }
  const debits = (transactions || [])
    .filter((row) => matchesDebit(matcher, row))
    .map((row) => ({ date: transactionDate(row.date) || String(row.date).slice(0, 10), amount: Math.abs(Number(row.price)) }))
    .filter((row) => row.date && row.date <= today);
  const actualByMonth = new Map();
  for (const debit of debits) {
    const key = monthKey(debit.date);
    actualByMonth.set(key, (actualByMonth.get(key) || 0) + debit.amount);
  }
  const expected = expectedByMonth(schedule);
  const currentMonth = monthKey(today);
  const share = linkedShare(schedule);

  const keys = new Set([...actualByMonth.keys(), ...[...expected.keys()].filter((key) => key <= currentMonth)]);
  const months = [...keys].sort().map((month) => {
    const exp = expected.get(month) || 0;
    const act = actualByMonth.get(month) || 0;
    const tolerance = Math.max(20, exp * (0.01 + share * 0.01));
    const diff = act - exp;
    let status;
    if (exp > 0 && act > 0) status = Math.abs(diff) <= tolerance ? 'ok' : 'drift';
    // Before the bank history starts, an absent debit says nothing.
    else if (exp > 0 && historyStart && month < monthKey(historyStart)) status = 'no_data';
    else if (exp > 0) status = month < currentMonth ? 'missing' : 'pending';
    else status = 'unexpected';
    return {
      month,
      expected: round2(exp),
      actual: round2(act),
      difference: round2(diff),
      differencePct: exp > 0 ? round2((diff / exp) * 100) : null,
      tolerance: round2(tolerance),
      status,
    };
  });

  const settled = months.filter((item) => item.status !== 'pending' && item.status !== 'no_data');
  const latest = settled[settled.length - 1] || null;
  const recentPaired = settled.filter((item) => item.status === 'ok' || item.status === 'drift').slice(-3);
  const consistentDrift = recentPaired.length >= 2 && recentPaired.every((item) => item.status === 'drift')
    && (recentPaired.every((item) => item.difference > 0) || recentPaired.every((item) => item.difference < 0));
  let suggestion = null;
  const largeGap = latest?.status === 'drift'
    && Math.abs(latest.difference) > Math.max(300, 0.1 * Math.max(latest.expected, latest.actual));
  if (largeGap) suggestion = 'large_gap';
  else if (consistentDrift) suggestion = 'consistent_drift';
  else if (latest?.status === 'drift') suggestion = 'latest_drift';
  else if (latest?.status === 'missing') suggestion = 'missing_payment';
  else if (latest?.status === 'unexpected' && settled.length <= 2) suggestion = 'first_payment';

  return {
    status: latest ? latest.status : 'no_debits',
    matchedCount: debits.length,
    historyStart,
    months: months.filter((item) => item.status !== 'no_data'),
    monthsWithoutHistory: months.filter((item) => item.status === 'no_data').length,
    summary: latest
      ? {
        latestMonth: latest.month,
        latestStatus: latest.status,
        latestDifference: latest.difference,
        composition: monthComposition(schedule, latest.month),
        averageDifference: recentPaired.length
          ? round2(recentPaired.reduce((sum, item) => sum + item.difference, 0) / recentPaired.length)
          : null,
        suggestion,
      }
      : null,
  };
}

/** Distinct mortgage-looking debit sources for the matcher picker. */
function matcherCandidates(transactions, isMortgagePayment, normalizeName) {
  const groups = new Map();
  for (const row of transactions || []) {
    if (!(Number(row.price) < 0) || !isMortgagePayment(row.name)) continue;
    const key = JSON.stringify([row.vendor || null, row.account_number || null, normalizeName(row.name)]);
    const date = transactionDate(row.date) || String(row.date).slice(0, 10);
    const group = groups.get(key) || { vendor: row.vendor || null, accountNumber: row.account_number || null, pattern: normalizeName(row.name), name: row.name, count: 0, lastDate: null, lastAmount: null };
    group.count += 1;
    if (!group.lastDate || date > group.lastDate) {
      group.lastDate = date;
      group.lastAmount = Math.abs(Number(row.price));
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || String(b.lastDate).localeCompare(String(a.lastDate)));
}

module.exports = { matcherCandidates, reconcileMortgage };
