const { isProtectedInvestmentPattern } = require('./projection-policy.js');

const normalizeName = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : 0;
};
const formatDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseDate = date => new Date(`${date}T12:00:00`);
const dayNumber = date => {
  const parsed = parseDate(date);
  return Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) / 86400000;
};
const distance = (left, right) => dayNumber(left) - dayNumber(right);
const monthNumber = date => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const categoryKey = row => row.category_definition_id == null
  ? `name:${normalizeName(row.category_name_en || row.category_name)}`
  : `category:${row.category_definition_id}`;

function transactionDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T| )/.test(value)) return null;
  const parsed = value.length === 10 ? parseDate(value) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  // Bank timestamps represent local payment dates; slicing UTC can move them to the previous day/month.
  const result = formatDate(parsed);
  return value.length === 10 && result !== value ? null : result;
}

function isMortgagePayment(name) {
  return /(?:mortgage|משכנת[אה])/iu.test(name)
    && !/(?:\b(?:fee|fees|insurance|setup|opening|payoff|closing)\b|early repayment|עמל[הת]|עמלות|ביטוח|פירעון|פרעון)/iu.test(name);
}

function inferCadence(dates, mortgage) {
  if (dates.length < 3) {
    if (!mortgage || (dates.length === 2 && Math.abs(distance(dates[1], dates[0]) - 30.4375) > 10)) return null;
    return { period: 30.4375, months: 1 };
  }
  const recent = dates.slice(-6);
  const intervals = recent.slice(1).map((date, index) => distance(date, recent[index]));
  const typical = median(intervals);
  const candidates = [
    { period: 7, months: 0 }, { period: 14, months: 0 },
    { period: 30.4375, months: 1 }, { period: 60.875, months: 2 },
    { period: 91.3125, months: 3 }, { period: 182.625, months: 6 },
    { period: 365.25, months: 12 },
  ];
  const cadence = candidates.reduce((best, candidate) =>
    Math.abs(candidate.period - typical) < Math.abs(best.period - typical) ? candidate : best);
  if (Math.abs(typical - cadence.period) / cadence.period > 0.18) return null;
  if (cadence.period === 7 && dates.length < 4) return null;
  const tolerance = cadence.months ? Math.max(5, cadence.period * 0.08) : 2;
  const regularIntervals = intervals.filter(gap => Math.abs(gap - cadence.period) <= tolerance).length;
  if (regularIntervals < Math.max(2, intervals.length - 1)) return null;
  return cadence;
}

function buildInvestmentSchedule(transactions, dates, now, truthSnapshot = {}) {
  if (!dates.length) return [];
  const protectedCategories = new Set((truthSnapshot.patterns || [])
    .filter(isProtectedInvestmentPattern)
    .map(pattern => pattern.categoryDefinitionId == null ? null : `category:${pattern.categoryDefinitionId}`));
  const today = formatDate(now);
  const groups = new Map();
  for (const row of transactions) {
    if (row.category_type !== 'investment' || Number(row.is_pikadon_related) === 1
      || (row.status && row.status !== 'completed')) continue;
    const price = Number(row.price);
    const date = transactionDate(row.date);
    const name = normalizeName(row.name);
    if (!Number.isFinite(price) || price === 0 || !date || date > today || !name) continue;
    const key = categoryKey(row);
    if (protectedCategories.has(key) || (row.category_definition_id == null && protectedCategories.has(null))) continue;
    const direction = price < 0 ? 1 : -1;
    const sourceKey = JSON.stringify([key, row.vendor || '', row.account_number || '', name, direction]);
    if (!groups.has(sourceKey)) groups.set(sourceKey, { row, direction, payments: new Map() });
    const group = groups.get(sourceKey);
    group.payments.set(date, (group.payments.get(date) || 0) + Math.abs(price));
  }

  const dateSet = new Set(dates);
  const first = [...dates].sort()[0];
  const last = [...dates].sort().at(-1);
  const events = [];
  for (const [sourceKey, { row, direction, payments }] of groups) {
    const historyDates = [...payments.keys()].sort();
    const mortgage = direction > 0 && isMortgagePayment(row.name);
    const cadence = inferCadence(historyDates, mortgage);
    if (!cadence || distance(today, historyDates.at(-1)) > cadence.period * 2.5) continue;

    const recentDates = historyDates.slice(-3);
    const amounts = recentDates.map(date => payments.get(date));
    const amount = median(amounts);
    const deviation = median(amounts.map(value => Math.abs(value - amount)));
    // A single large transfer should not reset a standing order; unstable transfers have no dependable amount.
    if (amount <= 0 || deviation / amount > 0.35) continue;
    const stdDev = Math.min(amount * 0.35, deviation * 1.4826);
    const occurrences = [];
    if (cadence.months) {
      const days = recentDates.map(date => Number(date.slice(8, 10)));
      const monthEnd = recentDates.filter(date => {
        const parsed = parseDate(date);
        return parsed.getDate() >= new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0).getDate() - 1;
      }).length > recentDates.length / 2;
      const anchor = Math.round(median(days));
      if (!monthEnd && median(days.map(day => Math.abs(day - anchor))) > 3) continue;
      const phase = monthNumber(historyDates.at(-1));
      for (let month = monthNumber(first); month <= monthNumber(last); month++) {
        if (((month - phase) % cadence.months + cadence.months) % cadence.months !== 0) continue;
        const year = Math.floor(month / 12);
        const m = month % 12;
        const monthLength = new Date(year, m + 1, 0).getDate();
        occurrences.push(formatDate(new Date(year, m, monthEnd ? monthLength : Math.min(anchor, monthLength), 12)));
      }
    } else {
      const cursor = parseDate(historyDates.at(-1));
      while (formatDate(cursor) < first) cursor.setDate(cursor.getDate() + cadence.period);
      while (formatDate(cursor) <= last) {
        occurrences.push(formatDate(cursor));
        cursor.setDate(cursor.getDate() + cadence.period);
      }
    }
    for (const date of occurrences) {
      if (!dateSet.has(date)) continue;
      // Match a payment made early/late across a month boundary, rather than projecting it a second time.
      const tolerance = Math.min(10, cadence.period * 0.35);
      if (historyDates.some(paid => Math.abs(distance(paid, date)) <= tolerance)) continue;
      events.push({
        sourceKey, date, amount: direction * Math.round(amount * 100) / 100, stdDev,
        categoryDefinitionId: row.category_definition_id ?? null,
        category: row.category_name_en || row.category_name || 'Investments',
        transactionName: row.name,
        vendor: row.vendor || null,
        evidenceCount: historyDates.length,
        inference: mortgage && historyDates.length < 3 ? 'mortgage_payment' : 'recurring_transfers',
      });
    }
  }
  return events.sort((left, right) => left.date.localeCompare(right.date) || left.sourceKey.localeCompare(right.sourceKey));
}

function applyInvestmentSchedule(dailyForecasts, simulationEntriesByDay, events, engine) {
  const dayMap = new Map(dailyForecasts.map(day => [day.date, day]));
  const simulationMap = new Map(simulationEntriesByDay.map(day => [day.date, day]));
  const preservedKeys = new Set();
  for (const day of dailyForecasts) {
    day.predictions = (day.predictions || []).filter(prediction => {
      if (prediction.categoryType !== 'investment') return true;
      if (!prediction.isUserResolvedPattern) return false;
      preservedKeys.add(prediction.patternKey);
      return true;
    });
  }
  for (const day of simulationEntriesByDay) {
    day.entries = day.entries.filter(entry => entry.categoryType !== 'investment' || preservedKeys.has(entry.patternKey));
  }
  for (const event of events) {
    const day = dayMap.get(event.date);
    if (!day) continue;
    const direction = Math.sign(event.amount);
    const amount = Math.abs(event.amount);
    const patternKey = `investment_schedule:${event.sourceKey}`;
    const range = [direction * Math.max(0, amount - event.stdDev), direction * (amount + event.stdDev)].sort((a, b) => a - b);
    day.predictions.push({
      patternKey, categoryType: 'investment', category: event.category,
      categoryDefinitionId: event.categoryDefinitionId, transactionName: event.transactionName,
      vendor: event.vendor || null,
      probability: 1, expectedAmount: event.amount, probabilityWeightedAmount: event.amount,
      amountRange: { low: range[0], high: range[1] }, predictionKind: 'recurring_investment',
      investmentDirection: direction, evidenceCount: event.evidenceCount, inference: event.inference,
      explanation: event.inference === 'mortgage_payment'
        ? 'Estimated monthly mortgage payment from the latest debit and its local payment day'
        : 'Based on this transfer source’s recent payment amounts and recurring dates',
    });
    simulationMap.get(event.date)?.entries.push({
      patternKey, categoryType: 'investment', patternType: 'investment_schedule',
      investmentDirection: direction, probability: 1, avgAmount: amount, stdDev: event.stdDev,
    });
  }
  dailyForecasts.forEach(engine.refreshForecastDayPredictions);
}

module.exports = { buildInvestmentSchedule, applyInvestmentSchedule };
