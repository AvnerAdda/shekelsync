const DAY_MS = 86400000;
const MIN_TRAINING_DAYS = 90;
const MIN_VALIDATION_ORIGINS = 6;
const MAX_VALIDATION_ORIGINS = 12;
const HORIZONS = [7, 30];
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : 0;
};

function dayNumber(value) {
  const date = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  return new Date(timestamp).toISOString().slice(0, 10) === date ? timestamp / DAY_MS : null;
}
const dateKey = day => new Date(day * DAY_MS).toISOString().slice(0, 10);
const monthLength = day => {
  const date = new Date(day * DAY_MS);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
};

function capSpikes(values) {
  const center = median(values);
  const deviation = median(values.map(value => Math.abs(value - center)));
  // With mostly zero weeks, keep the few observed purchases as evidence.
  if (center <= 0) return values;
  const cap = center + Math.max(center * 0.75, deviation * 3);
  return values.map(value => Math.min(value, cap));
}

// Shared with the live forecast: zero/refund months stay in the median, but
// positive months determine the cap so missing activity does not lower it.
function capMonthlyTotals(monthlyTotals) {
  const positiveTotals = monthlyTotals.filter(total => total > 0);
  if (positiveTotals.length < 2) return monthlyTotals;
  const center = median(positiveTotals);
  const deviation = median(positiveTotals.map(total => Math.abs(total - center)));
  const cap = center + Math.max(center * 0.75, deviation * 3);
  return monthlyTotals.map(total => Math.min(total, cap));
}

function capIsolatedWeeks(weeks) {
  const capped = capSpikes(weeks);
  return capped.map((value, index) => {
    if (weeks[index] <= value) return value;
    // Repeated similar high weeks are a change in activity, not one outlier.
    const corroborated = [index - 1, index + 1].some(neighbor => neighbor >= 0 && neighbor < weeks.length
      && weeks[neighbor] > capped[neighbor]
      && Math.max(weeks[neighbor], weeks[index]) <= Math.min(weeks[neighbor], weeks[index]) * 1.5);
    return corroborated ? weeks[index] : value;
  });
}

function buildHistory(transactions, end) {
  const rows = transactions.map(row => ({ day: dayNumber(row.date), amount: -Number(row.price) }))
    .filter(row => row.day != null && row.day <= end && Number.isFinite(row.amount));
  if (!rows.length) return null;
  const firstDay = rows.reduce((earliest, row) => Math.min(earliest, row.day), end);
  const start = Math.max(firstDay, end - 364);
  const monthlyTotals = new Map();
  rows.forEach(row => {
    const month = dateKey(row.day).slice(0, 7);
    monthlyTotals.set(month, (monthlyTotals.get(month) || 0) + row.amount);
  });
  const daily = Array(end - start + 1).fill(0);
  rows.filter(row => row.day >= start).forEach(row => { daily[row.day - start] += row.amount; });
  const prefix = [0];
  daily.forEach(value => prefix.push(prefix.at(-1) + value));
  const sum = (from, through) => {
    const left = Math.max(from, start);
    const right = Math.min(through, end);
    return left > right ? 0 : prefix[right - start + 1] - prefix[left - start];
  };
  return { start, end, sum, firstMonth: dateKey(firstDay).slice(0, 7), monthlyTotals };
}

function fitCandidates(history, origin, options) {
  const average = Math.max(0, history.sum(origin - 89, origin) / 90);
  const weeks = Array.from({ length: 12 }, (_, index) => {
    const through = origin - (11 - index) * 7;
    return Math.max(0, history.sum(through - 6, through));
  });
  const cappedWeeks = capIsolatedWeeks(weeks);
  // A four-week half-life adapts gradually; one unusually large week is capped.
  const weights = cappedWeeks.map((_, index) => 2 ** (-(11 - index) / 4));
  const adaptive = cappedWeeks.reduce((sum, value, index) => sum + value * weights[index], 0)
    / weights.reduce((sum, weight) => sum + weight, 0) / 7;

  // An estimate issued after the training origin can use the month that just
  // ended. At month end, using origin's month would drop that entire month.
  const issuanceMonth = dateKey(origin + 1).slice(0, 7);
  const months = options.completedMonths.filter(month => month < issuanceMonth)
    .slice(-options.baselineMonths).filter(month => month >= options.firstMonth);
  // Monthly references at older origins may reach before the rolling daily
  // window. Keep complete historical month totals, selecting only months that
  // ended before that origin; no later transaction can enter this reference.
  const totals = months.map(month => history.monthlyTotals.get(month) || 0);
  const activeMonths = totals.filter(total => total > 0).length;
  const robust = activeMonths >= options.minimumActiveMonths ? median(capMonthlyTotals(totals)) : 0;
  return { calendar_average: average, adaptive, robust_monthly: Math.max(0, robust), eligible: robust > 0 };
}

function expectedTotal(model, fitted, origin, horizon) {
  if (model !== 'robust_monthly') return fitted[model] * horizon;
  let total = 0;
  for (let day = origin + 1; day <= origin + horizon; day++) total += fitted[model] / monthLength(day);
  return total;
}

function selectExpenseEstimator(transactions, now, options = {}) {
  // Today's bank/card feeds may be incomplete. No candidate uses today's
  // transactions, future transactions, or outcomes after its training origin.
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS;
  const history = buildHistory(transactions, today - 1);
  const fallback = { estimator: 'robust_monthly', dailyRate: null, validation: null };
  if (!history || history.end - history.start + 1 < MIN_TRAINING_DAYS) return fallback;
  const baselineMonths = options.baselineMonths || 6;
  // Standalone callers have a complete calendar; the live forecast passes its
  // actual ledger months, including months where this category had no spending.
  const [firstYear, firstMonth] = history.firstMonth.split('-').map(Number);
  const todayDate = new Date(today * DAY_MS);
  const monthCount = (todayDate.getUTCFullYear() - firstYear) * 12 + todayDate.getUTCMonth() - firstMonth + 1;
  const completedMonths = options.completedMonths || Array.from({ length: monthCount }, (_, index) =>
    new Date(Date.UTC(firstYear, firstMonth - 1 + index, 1)).toISOString().slice(0, 7));
  const fitOptions = { baselineMonths, completedMonths: [...new Set(completedMonths)].sort(),
    firstMonth: history.firstMonth, minimumActiveMonths: options.minimumActiveMonths || 2 };
  const models = ['calendar_average', 'robust_monthly', 'adaptive'];
  const losses = Object.fromEntries(models.map(model => [model, []]));
  const horizonLosses = Object.fromEntries(models.map(model => [model, { days_7: [], days_30: [], daily: [] }]));
  const origins = [];
  for (let origin = history.end - 30; origin - history.start + 1 >= MIN_TRAINING_DAYS
    && origins.length < MAX_VALIDATION_ORIGINS; origin -= 7) {
    const fitted = fitCandidates(history, origin, fitOptions);
    if (!fitted.eligible) continue;
    origins.push(origin);
    for (const model of models) {
      let totalLoss = 0;
      for (const horizon of HORIZONS) {
        const loss = Math.abs(expectedTotal(model, fitted, origin, horizon)
          - Math.max(0, history.sum(origin + 1, origin + horizon))) / horizon;
        horizonLosses[model][`days_${horizon}`].push(loss);
        totalLoss += loss;
      }
      losses[model].push(totalLoss / HORIZONS.length);
      let dailyLoss = 0;
      for (let day = origin + 1; day <= origin + 30; day++) {
        const expected = model === 'robust_monthly' ? fitted[model] / monthLength(day) : fitted[model];
        dailyLoss += Math.abs(expected - Math.max(0, history.sum(day, day)));
      }
      horizonLosses[model].daily.push(dailyLoss / 30);
    }
  }
  if (origins.length < MIN_VALIDATION_ORIGINS) return fallback;
  const scores = Object.fromEntries(models.map(model => [model,
    losses[model].reduce((sum, loss) => sum + loss, 0) / origins.length,
  ]));
  const byHorizon = Object.fromEntries(models.map(model => [model,
    Object.fromEntries(Object.entries(horizonLosses[model]).map(([key, values]) => [key,
      values.reduce((sum, loss) => sum + loss, 0) / values.length,
    ])),
  ]));
  const winsAgainst = (model, reference) => losses[model]
    .filter((loss, index) => loss < losses[reference][index]).length / origins.length;
  // Keep the incumbent unless a challenger improves repeated comparisons.
  // The adaptive estimate needs a larger improvement than the simple average.
  const holdsUpAcrossHorizons = (model, reference) => ['days_7', 'days_30', 'daily']
    .every(key => byHorizon[model][key] <= byHorizon[reference][key] * 1.01);
  let selected = 'robust_monthly';
  if (scores.calendar_average < scores.robust_monthly * 0.95
    && winsAgainst('calendar_average', 'robust_monthly') >= 0.6
    && ['days_7', 'days_30'].every(key => byHorizon.calendar_average[key] < byHorizon.robust_monthly[key] * 0.95)
    && holdsUpAcrossHorizons('calendar_average', 'robust_monthly')) selected = 'calendar_average';
  if (scores.adaptive < scores[selected] * 0.9
    && winsAgainst('adaptive', selected) >= 0.6
    && holdsUpAcrossHorizons('adaptive', selected)) selected = 'adaptive';
  const fitted = fitCandidates(history, history.end, fitOptions);
  // A newly observed isolated spike has no matured forecast outcome yet.
  // Keep it from resetting an otherwise stable spending rate while scoring
  // the unmodified 90-day average as the explicit comparison candidate.
  const weeks = Array.from({ length: 12 }, (_, index) => Math.max(0,
    history.sum(history.end - index * 7 - 6, history.end - index * 7)));
  const cappedWeeks = capIsolatedWeeks(weeks);
  const ordinaryRate = cappedWeeks.reduce((sum, value) => sum + value, 0) / 84;
  const isolatedSpike = weeks.some((value, index) => value > cappedWeeks[index]);
  const guarded = selected === 'calendar_average' && isolatedSpike && ordinaryRate > 0
    && fitted.calendar_average > ordinaryRate * 1.25;
  if (guarded) selected = 'robust_monthly';
  return {
    estimator: selected,
    dailyRate: selected === 'robust_monthly' ? null : fitted[selected],
    selectionReason: guarded ? 'isolated_spike' : 'validated',
    validation: {
      origins: origins.length,
      horizons: HORIZONS,
      firstOrigin: dateKey(origins.at(-1)),
      lastOrigin: dateKey(origins[0]),
      observedThrough: dateKey(history.end),
      scores,
      byHorizon,
    },
  };
}

module.exports = { selectExpenseEstimator, capMonthlyTotals };
