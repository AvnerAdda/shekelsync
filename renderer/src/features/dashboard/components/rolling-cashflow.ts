import { addDays, format, parseISO, subDays } from 'date-fns';
import type { DashboardHistoryEntry } from '@renderer/types/dashboard';

export interface RollingCashflowPoint {
  date: string;
  windowStart: string;
  income: number;
  expenses: number;
  investments: number;
}

const amount = (value: number | null | undefined) => Number.isFinite(value) ? Number(value) : 0;

/** Daily averages over the plotted day and preceding 29 calendar days, including zero-activity days. */
export function buildRollingCashflow(
  history: DashboardHistoryEntry[], start: string, end: string,
  options: { includeCardRepayments?: boolean; includeCapitalReturns?: boolean } = {},
): RollingCashflowPoint[] {
  const daily = new Map(history.map((entry) => [entry.date.slice(0, 10), entry]));
  const totals = { income: 0, expenses: 0, investments: 0 };
  const apply = (date: string, sign: number) => {
    const entry = daily.get(date);
    if (!entry) return;
    totals.income += sign * (amount(entry.income) + (options.includeCapitalReturns ? amount(entry.capitalReturns) : 0));
    // Exclude card repayments to avoid counting purchases twice. Keep refunds
    // and net investment withdrawals signed, including on otherwise empty days.
    const expenses = options.includeCardRepayments
      ? amount(entry.expenses) - amount(entry.pairedCardExpenses) + amount(entry.pairedCardRepayments)
      : amount(entry.expenses) - amount(entry.cardRepayments);
    totals.expenses += sign * expenses;
    totals.investments += sign * amount(entry.investments);
  };
  const points: RollingCashflowPoint[] = [];
  for (let day = subDays(parseISO(start), 29); format(day, 'yyyy-MM-dd') <= end; day = addDays(day, 1)) {
    const date = format(day, 'yyyy-MM-dd');
    apply(date, 1);
    if (date > start) apply(format(subDays(day, 30), 'yyyy-MM-dd'), -1);
    if (date >= start) points.push({
      date,
      windowStart: format(subDays(day, 29), 'yyyy-MM-dd'),
      income: totals.income / 30,
      expenses: totals.expenses / 30,
      investments: totals.investments / 30,
    });
  }
  return points;
}
