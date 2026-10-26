const normalizeName = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const formatDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseDate = date => new Date(`${date}T12:00:00`);
const monthNumber = date => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const dayNumber = date => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86400000;
const MAX_INSTALLMENTS = 72;

// Charges are bucketed by the stored UTC day elsewhere (Activity, accuracy), which can be the
// day before the local payment date. Project the cadence locally, then use that same bucket.
function bucketShiftDays(value, localDate) {
  return typeof value === 'string' && value.length > 10 ? dayNumber(value.slice(0, 10)) - dayNumber(localDate) : 0;
}

function transactionDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T| )/.test(value)) return null;
  const parsed = value.length === 10 ? parseDate(value) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  // Bank timestamps represent local payment dates; slicing UTC can move them to the previous day/month.
  const result = formatDate(parsed);
  return value.length === 10 && result !== value ? null : result;
}

/**
 * Card scrapers mark installment plans with type "installments" and a memo such as
 * "תשלום 2 מתוך 4"; like the scrapers, read the first two numbers as payment and total.
 */
function parseInstallment(row) {
  if (row?.type !== 'installments') return null;
  const numbers = String(row.memo || '').match(/\d+/g);
  if (!numbers || numbers.length < 2) return null;
  const number = Number(numbers[0]);
  const total = Number(numbers[1]);
  if (!Number.isInteger(number) || !Number.isInteger(total) || number < 1 || total < 2
    || number > total || total > MAX_INSTALLMENTS) return null;
  return { number, total };
}

function hasCategoryExpectation(row, expectationCategories) {
  return row.category_definition_id != null && expectationCategories.has(Number(row.category_definition_id));
}

function expectationCategoryIds(truthSnapshot = {}) {
  return new Set((truthSnapshot.categoryExpectations || []).map(expectation => Number(expectation.categoryDefinitionId)));
}

/**
 * Later installments of a plan are already-committed payments, scheduled from the plan
 * itself. The first payment stays in category history as evidence of new purchases.
 * A saved category expectation remains authoritative for its whole category.
 */
function isScheduledInstallmentPayment(row, expectationCategories = new Set()) {
  if (row.category_type !== 'expense' || !(Number(row.price) < 0)) return false;
  const installment = parseInstallment(row);
  return Boolean(installment && installment.number > 1 && !hasCategoryExpectation(row, expectationCategories));
}

function buildInstallmentSchedule(transactions, dates, now, truthSnapshot = {}) {
  if (!dates.length) return [];
  const expectationCategories = expectationCategoryIds(truthSnapshot);
  const today = formatDate(now);
  const plans = new Map();
  for (const row of transactions) {
    if (row.category_type !== 'expense' || (row.status && row.status !== 'completed')) continue;
    const installment = parseInstallment(row);
    const price = Number(row.price);
    const date = transactionDate(row.date);
    if (!installment || !(price < 0) || !date || date > today || hasCategoryExpectation(row, expectationCategories)) continue;
    // Each payment is dated one month after the previous one, so the implied purchase
    // month separates repeated purchases from the same merchant.
    const purchaseMonth = monthNumber(date) - (installment.number - 1);
    const planKey = JSON.stringify([row.vendor || '', row.account_number || '', normalizeName(row.name),
      installment.total, purchaseMonth]);
    if (!plans.has(planKey)) plans.set(planKey, { total: installment.total, payments: new Map() });
    plans.get(planKey).payments.set(installment.number, { row, date, amount: -price });
  }

  const dateSet = new Set(dates);
  const events = [];
  for (const [planKey, { total, payments }] of plans) {
    const observed = [...payments.keys()].sort((left, right) => left - right);
    const latestNumber = observed.at(-1);
    if (latestNumber >= total) continue;
    const latest = payments.get(latestNumber);
    // The earliest payment day is closest to the purchase date; later ones may be clamped at month end.
    const anchorDay = Number(payments.get(observed[0]).date.slice(8, 10));
    const shift = bucketShiftDays(latest.row.date, latest.date);
    for (let number = latestNumber + 1; number <= total; number++) {
      const month = monthNumber(latest.date) + (number - latestNumber);
      const year = Math.floor(month / 12);
      const monthIndex = month % 12;
      const day = Math.min(anchorDay, new Date(year, monthIndex + 1, 0).getDate());
      const date = formatDate(new Date(year, monthIndex, day + shift, 12));
      if (!dateSet.has(date)) continue;
      events.push({
        planKey, date, amount: Math.round(latest.amount * 100) / 100,
        installmentNumber: number, installmentTotal: total,
        categoryDefinitionId: latest.row.category_definition_id ?? null,
        category: latest.row.category_name_en || latest.row.category_name || 'Uncategorized',
        categoryNameEn: latest.row.category_name_en || null,
        parentCategory: latest.row.parent_category_name || null,
        transactionName: latest.row.name,
        vendor: latest.row.vendor || null,
      });
    }
  }
  return events.sort((left, right) => left.date.localeCompare(right.date) || left.planKey.localeCompare(right.planKey));
}

function applyInstallmentSchedule(dailyForecasts, simulationEntriesByDay, events, engine) {
  const dayMap = new Map(dailyForecasts.map(day => [day.date, day]));
  const simulationMap = new Map(simulationEntriesByDay.map(day => [day.date, day]));
  for (const event of events) {
    const day = dayMap.get(event.date);
    if (!day) continue;
    const patternKey = `installment_schedule:${event.planKey}`;
    const expenseType = engine.isOperatingExpensePattern({
      categoryType: 'expense', category: event.category, categoryNameEn: event.categoryNameEn,
      parentCategory: event.parentCategory, transactionName: event.transactionName,
    }) ? 'operating' : 'non_operating';
    day.predictions.push({
      patternKey, monthlyKey: patternKey, categoryType: 'expense', category: event.category,
      categoryDefinitionId: event.categoryDefinitionId, transactionName: event.transactionName,
      vendor: event.vendor, expenseType,
      probability: 1, expectedAmount: event.amount, probabilityWeightedAmount: event.amount,
      amountRange: { low: event.amount, high: event.amount },
      predictionKind: 'installment_payment', timingBasis: 'scheduled', forecastBasis: 'installment_plan',
      installmentNumber: event.installmentNumber, installmentTotal: event.installmentTotal,
      explanation: `Installment ${event.installmentNumber} of ${event.installmentTotal} from the card's payment plan`,
    });
    day.expectedExpenses = (Number(day.expectedExpenses) || 0) + event.amount;
    simulationMap.get(event.date)?.entries.push({
      patternKey, monthlyKey: patternKey, categoryType: 'expense', expenseType,
      patternType: 'installment_schedule', probability: 1, avgAmount: event.amount, stdDev: 0,
    });
  }
  dailyForecasts.forEach(engine.refreshForecastDayPredictions);
}

module.exports = {
  parseInstallment,
  expectationCategoryIds,
  isScheduledInstallmentPayment,
  buildInstallmentSchedule,
  applyInstallmentSchedule,
};
