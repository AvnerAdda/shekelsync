const DAY_MS = 86400000;
const MAX_AMOUNT = 1e9;

function invalid(message) {
  return Object.assign(new Error(message), { status: 400, code: 'INVALID_PLANNING_INPUT' });
}

function dateKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
    && value >= '2000-01-01' && value <= '2200-12-31';
}

function shiftDays(value, count) {
  return new Date(Date.parse(`${value}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
}

function monthlyOccurrence(anchor, offset) {
  const [year, month, day] = anchor.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
}

function money(value, label, { signed = false, positive = false } = {}) {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === ''
    || (typeof value === 'string' && !value.trim())) throw invalid(`${label} is required`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > MAX_AMOUNT || (!signed && parsed < 0)
    || (positive && parsed <= 0)) throw invalid(`${label} must be a valid ${positive ? 'positive' : signed ? '' : 'non-negative'} amount`);
  return Math.round(parsed * 100) / 100;
}

function title(value, label = 'Name') {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) {
    throw invalid(`${label} must contain between 1 and 120 characters`);
  }
  return value.trim();
}

function validateGoal(payload = {}) {
  const goal = {
    name: title(payload.name),
    target_amount: money(payload.target_amount, 'Target', { positive: true }),
    saved_amount: money(payload.saved_amount ?? 0, 'Saved amount'),
    monthly_contribution: money(payload.monthly_contribution ?? 0, 'Monthly contribution'),
    target_date: payload.target_date || null,
    reserve_location: payload.reserve_location || 'included_cash',
  };
  if (goal.target_date !== null && !validDate(goal.target_date)) throw invalid('Enter a valid target date');
  if (!['included_cash', 'external'].includes(goal.reserve_location)) throw invalid('Choose where the savings are held');
  return goal;
}

function describeGoal(goal, today = dateKey()) {
  const remaining = Math.max(0, Math.round((Number(goal.target_amount) - Number(goal.saved_amount)) * 100) / 100);
  let months = null;
  if (goal.target_date) {
    // Contributions are reserved on the first of each upcoming month.
    const [year, month] = today.split('-').map(Number);
    const first = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    months = 0;
    while (monthlyOccurrence(first, months) <= goal.target_date && months < 2400) months += 1;
  }
  const required = months === null ? null : months > 0 ? Math.ceil(remaining / months * 100) / 100 : remaining === 0 ? 0 : null;
  return {
    ...goal,
    id: Number(goal.id),
    target_amount: Number(goal.target_amount),
    saved_amount: Number(goal.saved_amount),
    monthly_contribution: Number(goal.monthly_contribution),
    remaining_amount: remaining,
    months_until_target: months,
    required_monthly_contribution: required,
    on_track: remaining === 0 ? true : months === null ? null : months > 0 && Number(goal.monthly_contribution) >= required,
  };
}

function validateChanges(changes) {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 24) throw invalid('Add between 1 and 24 cash changes');
  const ids = new Set();
  return changes.map((change, index) => {
    if (!change || typeof change !== 'object') throw invalid('Invalid cash change');
    const id = change.id == null ? `change-${index + 1}` : title(change.id, 'Change ID');
    if (ids.has(id)) throw invalid('Cash change IDs must be unique');
    ids.add(id);
    const amount = money(change.amount, 'Cash change', { signed: true });
    if (amount === 0) throw invalid('Cash change must not be zero');
    if (!validDate(change.date)) throw invalid('Enter a valid cash change date');
    if (!['one_time', 'monthly'].includes(change.frequency)) throw invalid('Choose one-time or monthly frequency');
    const end = change.end_date || null;
    if (end !== null && (!validDate(end) || end < change.date)) throw invalid('End date must be on or after the start date');
    return { id, label: title(change.label, 'Description'), amount, date: change.date, frequency: change.frequency, end_date: end };
  });
}

function validateHorizon(value = 180) {
  const horizon = Number(value);
  if (!Number.isInteger(horizon) || horizon < 7 || horizon > 365) throw invalid('Projection horizon must be between 7 and 365 days');
  return horizon;
}

function expandChanges(changes, today, horizon) {
  const end = shiftDays(today, horizon);
  const byDate = new Map();
  const add = (date, amount) => {
    if (date <= today || date > end) return;
    const entry = byDate.get(date) || { net: 0, outflow: 0 };
    entry.net += Math.round(amount * 100);
    entry.outflow += Math.max(0, -Math.round(amount * 100));
    byDate.set(date, entry);
  };
  changes.forEach((change) => {
    if (change.frequency === 'one_time') { add(change.date, change.amount); return; }
    const [startYear, startMonth] = change.date.split('-').map(Number);
    const [year, month] = today.split('-').map(Number);
    const firstOffset = Math.max(0, (year - startYear) * 12 + month - startMonth);
    for (let offset = firstOffset; offset < firstOffset + 14; offset += 1) {
      const date = monthlyOccurrence(change.date, offset);
      if (date > end || (change.end_date && date > change.end_date)) break;
      add(date, change.amount);
    }
  });
  return byDate;
}

/** All ledger arithmetic uses cents; future income never increases spendability. */
function calculateProjection({ today, horizon, cashBalance, settings, spendingUntil = settings.next_income_date, goals, forecastDays, cardCommitments, changes = [] }) {
  const cents = (value) => Math.round(value * 100);
  const units = (value) => value / 100;
  const reserved = goals.filter((goal) => goal.reserve_location === 'included_cash')
    .reduce((sum, goal) => sum + cents(goal.saved_amount), 0);
  const opening = cents(cashBalance) - cents(settings.cash_buffer) - reserved - cents(cardCommitments);
  let balance = opening;
  let lowest = opening;
  let expensesUntilIncome = 0;
  let commitmentsUntilIncome = 0;
  let contributionsUntilIncome = 0;
  let contributionsTotal = 0;
  const contributions = goals.map((goal) => ({ remaining: Math.max(0, cents(goal.target_amount) - cents(goal.saved_amount)), amount: cents(goal.monthly_contribution), target: goal.target_date }));
  const byDate = new Map(forecastDays.map((day) => [day.date, day]));
  const changesByDate = expandChanges(changes, today, horizon);
  const daily = [];
  const monthly = new Map();
  for (let dayIndex = 1; dayIndex <= horizon; dayIndex += 1) {
    const date = shiftDays(today, dayIndex);
    const predicted = byDate.get(date);
    const income = cents(predicted.expectedOperatingIncome);
    const expenses = cents(predicted.expectedOperatingExpenses);
    const change = changesByDate.get(date) || { net: 0, outflow: 0 };
    let contribution = 0;
    if (date.endsWith('-01')) {
      contributions.forEach((goal) => {
        if (goal.target && date > goal.target) return;
        const amount = Math.min(goal.remaining, goal.amount);
        contribution += amount;
        goal.remaining -= amount;
      });
    }
    contributionsTotal += contribution;
    // The next income date itself is included: bill debits may precede salary credit.
    if (spendingUntil && date <= spendingUntil) {
      expensesUntilIncome += expenses;
      contributionsUntilIncome += contribution;
      commitmentsUntilIncome += contribution + change.outflow;
    }
    balance += income - expenses - contribution + change.net;
    lowest = Math.min(lowest, balance);
    const row = { date, income: units(income), expenses: units(expenses), contributions: units(contribution), scenario_change: units(change.net), balance: units(balance) };
    daily.push(row);
    const month = date.slice(0, 7);
    const aggregate = monthly.get(month) || { month, income: 0, expenses: 0, contributions: 0, scenario_change: 0, ending_balance: 0 };
    for (const key of ['income', 'expenses', 'contributions', 'scenario_change']) aggregate[key] = cents(aggregate[key]) + cents(row[key]);
    for (const key of ['income', 'expenses', 'contributions', 'scenario_change']) aggregate[key] = units(aggregate[key]);
    aggregate.ending_balance = row.balance;
    monthly.set(month, aggregate);
  }
  const headroom = opening - expensesUntilIncome - commitmentsUntilIncome;
  return {
    reserved_cash: units(reserved),
    planned_contributions: units(contributionsUntilIncome),
    total_planned_contributions: units(contributionsTotal),
    forecast_expenses_until_income: units(expensesUntilIncome),
    available_spend: units(Math.max(0, headroom)),
    shortfall: units(Math.max(0, -headroom)),
    lowest_balance: units(lowest),
    ending_balance: units(balance),
    daily,
    monthly: [...monthly.values()],
  };
}

module.exports = { invalid, dateKey, validDate, shiftDays, monthlyOccurrence, money, title, validateGoal, describeGoal, validateChanges, validateHorizon, expandChanges, calculateProjection };
