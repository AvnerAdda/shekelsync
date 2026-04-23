import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { DashboardHistoryEntry } from '@renderer/types/dashboard';

export interface IncomeExpenseCalendarDay {
  date: Date;
  isoDate: string;
  income: number;
  expenses: number;
  net: number;
  isCurrentMonth: boolean;
  isFuture: boolean;
  hasActivity: boolean;
}

function normalizeLocale(language?: string): 'he' | 'fr' | 'en' {
  const normalized = language?.toLowerCase().split('-')[0];
  if (normalized === 'he') return 'he';
  if (normalized === 'fr') return 'fr';
  return 'en';
}

function resolveCalendarLocale(language?: string): string {
  const normalized = normalizeLocale(language);
  if (normalized === 'he') return 'he-IL';
  if (normalized === 'fr') return 'fr-FR';
  return 'en-US';
}

function toUtcCalendarDate(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function getDisplayIncome(item: DashboardHistoryEntry, includeCapitalReturns: boolean): number {
  const baseIncome = item.income ?? 0;
  if (!includeCapitalReturns) return baseIncome;
  return baseIncome + (item.capitalReturns ?? 0);
}

function getDisplayExpenses(item: DashboardHistoryEntry, includeCardRepayments: boolean): number {
  const baseExpenses = item.expenses ?? 0;
  if (!includeCardRepayments) {
    return Math.max(0, baseExpenses - (item.cardRepayments ?? 0));
  }
  return Math.max(
    0,
    baseExpenses - (item.pairedCardExpenses ?? 0) + (item.pairedCardRepayments ?? 0),
  );
}

export function buildIncomeExpenseCalendarGrid(monthDate: Date): Date[] {
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthStart);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  return eachDayOfInterval({ start: gridStart, end: gridEnd });
}

interface BuildIncomeExpenseCalendarDaysOptions {
  history: DashboardHistoryEntry[];
  monthDate: Date;
  includeCardRepayments: boolean;
  includeCapitalReturns: boolean;
  today?: Date;
}

export function buildIncomeExpenseCalendarDays({
  history,
  monthDate,
  includeCardRepayments,
  includeCapitalReturns,
  today = new Date(),
}: BuildIncomeExpenseCalendarDaysOptions): IncomeExpenseCalendarDay[] {
  const currentMonth = startOfMonth(monthDate);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const historyByDate = new Map(history.map((entry) => [entry.date, entry]));

  return buildIncomeExpenseCalendarGrid(currentMonth).map((date) => {
    const isoDate = format(date, 'yyyy-MM-dd');
    const item = historyByDate.get(isoDate);
    const income = item ? getDisplayIncome(item, includeCapitalReturns) : 0;
    const expenses = item ? getDisplayExpenses(item, includeCardRepayments) : 0;
    const net = income - expenses;

    return {
      date,
      isoDate,
      income,
      expenses,
      net,
      isCurrentMonth: isSameMonth(date, currentMonth),
      isFuture: date.getTime() > todayStart.getTime(),
      hasActivity: income > 0 || expenses > 0,
    };
  });
}

export function getIncomeExpenseMonthTotals(
  days: IncomeExpenseCalendarDay[],
  monthDate: Date,
): { income: number; expenses: number; net: number } {
  const targetMonth = startOfMonth(monthDate);
  return days
    .filter((day) => day.isCurrentMonth && isSameMonth(day.date, targetMonth))
    .reduce(
      (totals, day) => ({
        income: totals.income + day.income,
        expenses: totals.expenses + day.expenses,
        net: totals.net + day.net,
      }),
      { income: 0, expenses: 0, net: 0 },
    );
}

export function getIncomeExpenseCalendarWeekdayLabels(language?: string): string[] {
  const formatter = new Intl.DateTimeFormat(resolveCalendarLocale(language), {
    weekday: 'short',
    timeZone: 'UTC',
  });

  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(Date.UTC(2024, 0, 1 + index))),
  );
}

export function formatIncomeExpenseCalendarMonthLabel(date: Date, language?: string): string {
  return new Intl.DateTimeFormat(resolveCalendarLocale(language), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(toUtcCalendarDate(date));
}
