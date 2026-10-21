const DAY_MS = 86400000;
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : 0;
};
const normalizeName = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const categoryKey = row => row.category_definition_id == null
  ? `${row.category_type}:${row.category_name || 'Uncategorized'}` : `category:${row.category_definition_id}`;
const parse = value => new Date(`${value}T12:00:00`);
const dayNumber = value => {
  const date = parse(value);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
};
const monthNumber = value => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
const distance = (left, right) => dayNumber(left) - dayNumber(right);

function paymentDate(value, engine) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T| )/.test(value)) return null;
  const date = value.length === 10 ? parse(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const result = engine.formatDate(date);
  return value.length === 10 && result !== value ? null : result;
}

function inferBill(payments, rows, today) {
  const dates = [...payments.keys()].sort();
  if (dates.length < 3) return null;
  // Category aggregation is safe only with one merchant and bank. Multiple
  // accounts paid on the same date are combined into their actual daily total.
  const identities = new Set(rows.map(row => JSON.stringify([normalizeName(row.name), row.vendor || ''])));
  if (identities.size !== 1 || !normalizeName(rows[0].name)) return null;
  const recent = dates.slice(-6);
  const intervals = recent.slice(1).map((date, index) => distance(date, recent[index]));
  const gap = median(intervals);
  const months = [1, 2, 3, 6, 12].reduce((best, candidate) =>
    Math.abs(candidate * 30.4375 - gap) < Math.abs(best * 30.4375 - gap) ? candidate : best);
  const period = months * 30.4375;
  const tolerance = Math.max(7, period * 0.12);
  // Require every recent interval to support the calendar cadence. Occasional
  // purchases must not become a bill merely because their average gap is two months.
  if (intervals.some(interval => Math.abs(interval - period) > tolerance)) return null;
  const recentDates = dates.slice(-3);
  const amounts = recentDates.map(date => payments.get(date));
  const amount = median(amounts);
  const deviation = median(amounts.map(value => Math.abs(value - amount)));
  if (amount <= 0 || deviation / amount > 0.5) return null;
  const days = recentDates.map(date => Number(date.slice(-2)));
  const atMonthEnd = recentDates.filter(date => {
    const parsed = parse(date);
    return parsed.getDate() >= new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0).getDate() - 1;
  }).length >= 2;
  const anchor = Math.round(median(days));
  if (!atMonthEnd && median(days.map(day => Math.abs(day - anchor))) > 5) return null;
  return {
    months, period, phase: monthNumber(dates.at(-1)), anchor, atMonthEnd, dates,
    amount, stdDev: Math.max(amount * 0.03, deviation * 1.4826),
    inactive: distance(today, dates.at(-1)) > period * 2.5,
  };
}

function buildInfrequentExpenseEstimates(transactions, patterns, dates, now, engine, truthSnapshot = {}) {
  const result = new Map();
  if (!dates.length) return result;
  const protectedCategories = new Set((truthSnapshot.patterns || [])
    .filter(pattern => pattern.source !== 'detected' || pattern.confirmed || pattern.corrections?.length
      || (pattern.state && pattern.state !== 'active'))
    .map(pattern => pattern.categoryDefinitionId == null ? null : `category:${pattern.categoryDefinitionId}`));
  (truthSnapshot.categoryExpectations || []).forEach(expectation => {
    protectedCategories.add(`category:${expectation.categoryDefinitionId}`);
  });
  const today = engine.formatDate(now);
  const byCategory = new Map();
  let historyStart = dayNumber(today);
  transactions.forEach(row => {
    const date = paymentDate(row.date, engine);
    if (date && date <= today && (!row.status || row.status === 'completed')) historyStart = Math.min(historyStart, dayNumber(date));
  });
  for (const row of transactions) {
    const date = paymentDate(row.date, engine);
    const price = Number(row.price);
    if (row.category_type !== 'expense' || !date || date > today || !Number.isFinite(price)
      || (row.status && row.status !== 'completed')) continue;
    const key = categoryKey(row);
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push({ ...row, paymentDate: date, price });
  }
  for (const [key, pattern] of Object.entries(patterns)) {
    if (pattern.categoryType !== 'expense' || !['monthly', 'bi-monthly', 'sporadic', 'insufficient_data'].includes(pattern.patternType)
      || Number(pattern.avgOccurrencesPerMonth) > 1.5 || protectedCategories.has(key)
      || (pattern.categoryDefinitionId == null && protectedCategories.has(null))) continue;
    const rows = (byCategory.get(key) || []).sort((left, right) => left.paymentDate.localeCompare(right.paymentDate));
    const debits = rows.filter(row => row.price < 0);
    if (!debits.length) continue;
    const payments = new Map();
    debits.forEach(row => payments.set(row.paymentDate, (payments.get(row.paymentDate) || 0) - row.price));
    const bill = inferBill(payments, debits, today);
    const daily = new Map();
    if (bill) {
      for (const date of dates) {
        if (bill.inactive) continue;
        if (((monthNumber(date) - bill.phase) % bill.months + bill.months) % bill.months !== 0) continue;
        const parsed = parse(date);
        const length = new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0).getDate();
        const day = bill.atMonthEnd ? length : Math.min(bill.anchor, length);
        if (parsed.getDate() !== day) continue;
        if (bill.dates.some(paid => Math.abs(distance(paid, date)) <= Math.min(10, bill.period * 0.35))) continue;
        daily.set(date, { probability: 1, amount: bill.amount, stdDev: bill.stdDev, timingBasis: 'estimated' });
      }
    } else {
      // Irregular infrequent spending has no dependable payment date. Include
      // zero-spend days and refunds; do not repeat a full purchase every likely weekday.
      const end = dayNumber(today) - 1;
      const start = Math.max(historyStart, end - 179);
      if (end - start + 1 < 90) continue;
      const days = Math.max(1, end - start + 1);
      const net = rows.filter(row => dayNumber(row.paymentDate) >= start && dayNumber(row.paymentDate) <= end)
        .reduce((sum, row) => sum - row.price, 0);
      const rate = Math.max(0, net / days);
      const activeDays = [...payments.keys()].filter(date => dayNumber(date) >= start && dayNumber(date) <= end).length;
      const probability = Math.min(1, activeDays / days);
      if (probability > 0 && rate > 0) dates.forEach(date => daily.set(date, {
        probability, amount: rate / probability, stdDev: pattern.stdDev || 0, timingBasis: 'daily_average',
      }));
    }
    result.set(key, { pattern, daily, basis: bill ? 'recurring_bill' : 'irregular_allowance' });
  }
  return result;
}

function applyInfrequentExpenseEstimates(dailyForecasts, simulationEntriesByDay, estimates, engine) {
  const simulationByDate = new Map(simulationEntriesByDay.map(day => [day.date, day]));
  for (const day of dailyForecasts) {
    day.predictions = day.predictions.filter(prediction => prediction.categoryType !== 'expense'
      || !estimates.has(prediction.patternKey));
    const simulation = simulationByDate.get(day.date);
    if (simulation) simulation.entries = simulation.entries.filter(entry => entry.categoryType !== 'expense'
      || !estimates.has(entry.patternKey));
    for (const [key, { pattern, daily, basis }] of estimates) {
      const estimate = daily.get(day.date);
      if (!estimate) continue;
      const { probability, amount, stdDev, timingBasis } = estimate;
      const expenseType = engine.isOperatingExpensePattern(pattern) ? 'operating' : 'non_operating';
      const prediction = {
        patternKey: key, monthlyKey: key, categoryType: 'expense', category: pattern.category,
        categoryDefinitionId: pattern.categoryDefinitionId ?? null, expenseType,
        transactionName: pattern.sourceTransactionName || null, vendor: pattern.vendor || null,
        probability, expectedAmount: amount, probabilityWeightedAmount: probability * amount,
        amountRange: { low: Math.max(0, amount - stdDev), high: amount + stdDev }, timingBasis,
        forecastBasis: basis,
        isBaselineForecast: timingBasis === 'daily_average',
        ...(timingBasis === 'estimated' ? { predictionKind: 'recurring_expense' } : {}),
      };
      day.predictions.push(prediction);
      simulation?.entries.push({
        patternKey: key, monthlyKey: key, categoryType: 'expense', expenseType,
        patternType: 'infrequent_expense', probability, avgAmount: amount, stdDev,
      });
    }
    day.expectedExpenses = day.predictions.filter(prediction => prediction.categoryType === 'expense')
      .reduce((sum, prediction) => sum + (Number(prediction.probabilityWeightedAmount) || 0), 0);
    engine.refreshForecastDayPredictions(day);
  }
}

module.exports = { buildInfrequentExpenseEstimates, applyInfrequentExpenseEstimates };
