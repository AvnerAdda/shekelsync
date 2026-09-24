import type { CashScenario, CashScenarioInput, SavingsGoal, SavingsGoalInput, ScenarioChange } from '../types';

const MAX_AMOUNT = 1e9;

export interface GoalDraft {
  name: string;
  target_amount: string;
  saved_amount: string;
  monthly_contribution: string;
  target_date: string;
  reserve_location: SavingsGoalInput['reserve_location'];
}

export interface ChangeDraft extends Omit<ScenarioChange, 'amount'> {
  amount: string;
}

export interface ScenarioDraft {
  name: string;
  changes: ChangeDraft[];
}

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function tomorrowKey(today = localDateKey()): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function validPlanningDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2200-12-31') return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function nextMonthlyOccurrence(anchor: string, today = localDateKey()): string {
  const [year, month, day] = anchor.split('-').map(Number);
  const [todayYear, todayMonth] = today.split('-').map(Number);
  let offset = Math.max(0, (todayYear - year) * 12 + todayMonth - month);
  for (;;) {
    const first = new Date(Date.UTC(year, month - 1 + offset, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(day, last));
    const date = first.toISOString().slice(0, 10);
    if (date > today) return date;
    offset += 1;
  }
}

function amountValue(value: string, signed = false): number | null {
  const amount = Number(value);
  if (!value.trim() || !Number.isFinite(amount) || Math.abs(amount) > MAX_AMOUNT || (!signed && amount < 0)) return null;
  return Math.round(amount * 100) / 100;
}

export function goalDraft(goal: SavingsGoal | null): GoalDraft {
  return {
    name: goal?.name ?? '',
    target_amount: goal?.target_amount.toString() ?? '',
    saved_amount: goal?.saved_amount.toString() ?? '0',
    monthly_contribution: goal?.monthly_contribution.toString() ?? '0',
    target_date: goal?.target_date ?? '',
    reserve_location: goal?.reserve_location ?? 'included_cash',
  };
}

export function goalInput(draft: GoalDraft): SavingsGoalInput | null {
  const target = amountValue(draft.target_amount);
  const saved = amountValue(draft.saved_amount);
  const contribution = amountValue(draft.monthly_contribution);
  if (!draft.name.trim() || draft.name.trim().length > 120 || target === null || target <= 0
    || saved === null || contribution === null || (draft.target_date && !validPlanningDate(draft.target_date))
    || !['included_cash', 'external'].includes(draft.reserve_location)) return null;
  return {
    name: draft.name.trim(), target_amount: target, saved_amount: saved,
    monthly_contribution: contribution, target_date: draft.target_date || null,
    reserve_location: draft.reserve_location,
  };
}

export function newChangeDraft(): ChangeDraft {
  return { id: crypto.randomUUID(), label: '', amount: '', date: tomorrowKey(), frequency: 'one_time', end_date: '' };
}

export function scenarioDraft(scenario: CashScenario | null): ScenarioDraft {
  return {
    name: scenario?.name ?? '',
    changes: scenario?.changes.map((change) => ({ ...change, amount: change.amount.toString() })) ?? [newChangeDraft()],
  };
}

export function scenarioInput(draft: ScenarioDraft, today = localDateKey()): CashScenarioInput | null {
  if (!draft.name.trim() || draft.name.trim().length > 120 || draft.changes.length < 1 || draft.changes.length > 24) return null;
  const changes: ScenarioChange[] = [];
  for (const change of draft.changes) {
    const amount = amountValue(change.amount, true);
    if (!change.label.trim() || change.label.trim().length > 120 || amount === null || amount === 0
      || !validPlanningDate(change.date) || !['one_time', 'monthly'].includes(change.frequency)) return null;
    if (change.frequency === 'one_time' && change.date <= today) return null;
    const end = change.frequency === 'monthly' ? change.end_date || null : null;
    if (end && (!validPlanningDate(end) || end < change.date || end < nextMonthlyOccurrence(change.date, today))) return null;
    changes.push({ id: change.id, label: change.label.trim(), amount, date: change.date, frequency: change.frequency, end_date: end });
  }
  return { name: draft.name.trim(), changes };
}
