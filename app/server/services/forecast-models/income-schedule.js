// Preserve merchant names in every script; ASCII-only normalization loses whole income sources.
const normalizeName = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : 0;
};
const keyFor = row => row.category_definition_id == null
  ? `income:${row.category_name_en || row.category_name || 'uncategorized'}` : `category:${row.category_definition_id}`;
const dateOnly = value => String(value || '').slice(0, 10);
const parse = value => new Date(`${dateOnly(value)}T12:00:00`);
const distance = (left, right) => Math.round((parse(left) - parse(right)) / 86400000);

function buildIncomeSchedule(transactions, dates, now, engine, truthSnapshot = {}, options = {}) {
  if (!dates.length) return new Map();
  const { observations = 3, radius = 0, estimator = 'median' } = options;
  const protectedCategories = new Set((truthSnapshot.patterns || [])
    .filter(p => p.source !== 'detected' || p.corrections?.length || p.state !== 'active' || p.confirmed)
    .map(p => p.categoryDefinitionId == null ? null : `category:${p.categoryDefinitionId}`));
  const groups = new Map();
  for (const row of transactions) {
    if (row.category_type !== 'income' || !Number.isFinite(Number(row.price)) || Number(row.price) <= 0
      || !/^\d{4}-\d{2}-\d{2}/.test(String(row.date)) || !Number.isFinite(parse(row.date).getTime())
      || dateOnly(row.date) > engine.formatDate(now)) continue;
    const descriptor = { categoryType: 'income', category: row.category_name, categoryNameEn: row.category_name_en,
      parentCategory: row.parent_category_name, transactionName: row.name, isCountedAsIncome: row.is_counted_as_income };
    if (!engine.isOperatingIncomePattern(descriptor)) continue;
    const categoryKey = keyFor(row);
    if (protectedCategories.has(categoryKey) || (row.category_definition_id == null && protectedCategories.has(null))) continue;
    const name = normalizeName(row.name);
    if (!name) continue;
    const key = `${categoryKey}:${row.vendor || ''}:${name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const result = new Map();
  const first = parse(dates[0]);
  const last = parse(dates.at(-1));
  const dateSet = new Set(dates);
  for (const [sourceKey, rows] of groups) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const byDate = new Map();
    for (const row of rows) byDate.set(dateOnly(row.date), (byDate.get(dateOnly(row.date)) || 0) + Number(row.price));
    const historyDates = [...byDate.keys()];
    if (historyDates.length < 3) continue;
    const cadenceDates = historyDates.slice(-Math.max(4, observations + 1));
    const intervals = cadenceDates.slice(1).map((date, i) => distance(date, cadenceDates[i]));
    const gap = median(intervals);
    const period = [7, 14, 30.4375, 61, 91.3125, 182.625, 365.25].reduce((a, b) => Math.abs(a - gap) < Math.abs(b - gap) ? a : b);
    const relativeDeviation = median(intervals.map(v => Math.abs(v - period) / period));
    const occupancy = cadenceDates.length / (1 + distance(cadenceDates.at(-1), cadenceDates[0]) / period);
    if (relativeDeviation > 0.35 || occupancy < 0.6 || occupancy > 1.5) continue;
    const categoryKey = keyFor(rows[0]);
    if (!result.has(categoryKey)) result.set(categoryKey, { key: categoryKey, categoryDefinitionId: rows[0].category_definition_id ?? null,
      category: rows[0].category_name_en || rows[0].category_name || 'Income', daily: new Map(), events: [] });
    const output = result.get(categoryKey);
    // Two missed cycles make the detected stream inactive; explicit user schedules bypass this path.
    if (distance(engine.formatDate(now), historyDates.at(-1)) > period * 2.5) continue;
    const amounts = [...byDate.values()].slice(-observations);
    const amount = estimator === 'mean' ? amounts.reduce((s, v) => s + v, 0) / amounts.length : median(amounts);
    const center = median(amounts);
    const mad = median(amounts.map(v => Math.abs(v - center)));
    const stdDev = Math.min(amount * 0.5, Math.max(amount * 0.03, mad * 1.4826));
    const recentDates = historyDates.slice(-6);
    const days = recentDates.map(date => Number(date.slice(8, 10)));
    const monthEnd = recentDates.filter(date => {
      const d = parse(date);
      return d.getDate() >= new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - 1;
    }).length >= Math.ceil(recentDates.length * 0.6);
    const anchor = Math.round(median(days));
    // Distinguish twice-monthly pay dates from a true every-14-days schedule.
    let semiMonthlyDays = null;
    if (period === 14 && recentDates.length >= 6) {
      for (let left = 1; left <= 18 && !semiMonthlyDays; left++) for (let right = left + 10; right <= Math.min(31, left + 20); right++) {
        const nearLeft = days.filter(day => Math.abs(day - left) <= 1);
        const nearRight = days.filter(day => Math.abs(day - right) <= 2);
        if (nearLeft.length >= 2 && nearRight.length >= 2 && nearLeft.length + nearRight.length >= days.length * 0.9) {
          semiMonthlyDays = [Math.round(median(nearLeft)), Math.round(median(nearRight))];
          break;
        }
      }
    }
    const occurrences = [];
    if (period >= 28 || semiMonthlyDays) {
      const months = semiMonthlyDays ? 1 : Math.round(period / 30.4375);
      const sourceDate = parse(historyDates.at(-1));
      const sourceMonth = sourceDate.getFullYear() * 12 + sourceDate.getMonth();
      for (let month = first.getFullYear() * 12 + first.getMonth() - 1; month <= last.getFullYear() * 12 + last.getMonth() + 1; month++) {
        if (((month - sourceMonth) % months + months) % months !== 0) continue;
        const year = Math.floor(month / 12), m = month % 12;
        const length = new Date(year, m + 1, 0).getDate();
        for (const day of semiMonthlyDays || [anchor]) {
          const atEnd = semiMonthlyDays ? day >= 28 : monthEnd;
          occurrences.push(new Date(year, m, atEnd ? length : Math.min(day, length), 12));
        }
      }
    } else {
      const cursor = parse(historyDates.at(-1));
      while (cursor < first) cursor.setDate(cursor.getDate() + period);
      cursor.setDate(cursor.getDate() - period);
      while (cursor <= new Date(last.getFullYear(), last.getMonth(), last.getDate() + radius, 12)) {
        occurrences.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + period);
      }
    }
    for (const occurrence of occurrences) {
      const occurrenceDate = engine.formatDate(occurrence);
      const tolerance = Math.min(10, period * 0.35);
      if (historyDates.some(date => Math.abs(distance(date, occurrenceDate)) <= tolerance)) continue;
      const allocations = [];
      const normalizer = (radius + 1) ** 2;
      for (let offset = -radius; offset <= radius; offset++) {
        const d = new Date(occurrence);
        d.setDate(d.getDate() + offset);
        const date = engine.formatDate(d);
        if (!dateSet.has(date)) continue;
        const probability = (radius + 1 - Math.abs(offset)) / normalizer;
        output.daily.set(date, (output.daily.get(date) || 0) + amount * probability);
        allocations.push({ date, probability });
      }
      if (allocations.length) output.events.push({ key: `${sourceKey}:${occurrenceDate}`, amount, stdDev, allocations });
    }
  }
  return result;
}
function applyIncomeSchedule(dailyForecasts, simulationEntriesByDay, schedule, engine) {
  const dayMap = new Map(dailyForecasts.map(day => [day.date, day]));
  const simulationMap = new Map(simulationEntriesByDay.map(day => [day.date, day]));
  const predictionKey = prediction => prediction.categoryDefinitionId == null
    ? `income:${prediction.categoryNameEn || prediction.category || 'uncategorized'}`
    : `category:${prediction.categoryDefinitionId}`;
  const removedKeys = new Set();
  for (const day of dailyForecasts) {
    day.predictions = day.predictions.filter(prediction => {
      if (prediction.categoryType !== 'income' || !schedule.has(predictionKey(prediction))) return true;
      removedKeys.add(prediction.patternKey);
      return false;
    });
  }
  for (const simulation of simulationEntriesByDay) {
    simulation.entries = simulation.entries.filter(entry => entry.categoryType !== 'income' || !removedKeys.has(entry.patternKey));
  }
  for (const model of schedule.values()) for (const event of model.events) {
    for (const { date, probability } of event.allocations) {
      const day = dayMap.get(date);
      const simulation = simulationMap.get(date);
      if (!day || !simulation) continue;
      day.predictions.push({ patternKey: `income_schedule:${event.key}`, category: model.category,
        categoryDefinitionId: model.categoryDefinitionId, categoryType: 'income', incomeType: 'operating',
        probability, expectedAmount: event.amount, probabilityWeightedAmount: event.amount * probability,
        amountRange: { low: Math.max(0, event.amount - event.stdDev), high: event.amount + event.stdDev },
        predictionKind: 'recurring_income', isCalibrated: true });
      simulation.entries.push({ patternKey: `income_schedule:${event.key}`, occurrenceKey: event.key,
        categoryType: 'income', incomeType: 'operating', patternType: 'income_schedule',
        probability, avgAmount: event.amount, stdDev: event.stdDev });
    }
  }
  for (const day of dailyForecasts) {
    day.expectedIncome = day.predictions.filter(p => p.categoryType === 'income').reduce((sum, p) => sum + p.probabilityWeightedAmount, 0);
    day.expectedOperatingIncome = 0;
    day.expectedNonOperatingIncome = 0;
    engine.refreshForecastDayPredictions(day);
  }
}
module.exports = { applyIncomeSchedule, buildIncomeSchedule, keyFor };
