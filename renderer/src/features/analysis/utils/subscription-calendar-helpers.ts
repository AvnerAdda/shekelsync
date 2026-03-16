import {
  parseISO,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  setDate,
  getDate,
  getDaysInMonth,
  isSameDay,
  isSameMonth,
  isToday,
  differenceInMonths,
  differenceInCalendarMonths,
  isBefore,
  isAfter,
} from 'date-fns';
import type { Subscription, SubscriptionFrequency } from '@renderer/types/subscriptions';

export interface CalendarSubscriptionEntry {
  subscription: Subscription;
  amount: number;
}

export interface CalendarDayData {
  date: Date;
  subscriptions: CalendarSubscriptionEntry[];
}

/**
 * Build a calendar grid of dates covering full weeks for a given month.
 * Returns 35 or 42 Date objects (5 or 6 rows of 7 days).
 */
export function buildCalendarGrid(year: number, month: number): Date[] {
  const monthStart = startOfMonth(new Date(year, month));
  const monthEnd = endOfMonth(monthStart);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 }); // Monday start
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  return eachDayOfInterval({ start: gridStart, end: gridEnd });
}

/**
 * Get the effective frequency for a subscription.
 */
function getEffectiveFrequency(sub: Subscription): SubscriptionFrequency {
  return sub.user_frequency || sub.detected_frequency;
}

/**
 * Get the effective amount for a subscription.
 */
function getEffectiveAmount(sub: Subscription): number {
  return sub.user_amount ?? sub.detected_amount;
}

/**
 * Project all charge dates for a subscription within a given date range.
 */
export function projectSubscriptionDates(
  sub: Subscription,
  rangeStart: Date,
  rangeEnd: Date,
): Date[] {
  if (!sub.next_expected_date) return [];

  const freq = getEffectiveFrequency(sub);
  const anchor = parseISO(sub.next_expected_date);
  const results: Date[] = [];

  switch (freq) {
    case 'daily': {
      // Every day in range
      return eachDayOfInterval({ start: rangeStart, end: rangeEnd });
    }

    case 'weekly': {
      // Step forward/backward from anchor in 7-day increments
      let cursor = anchor;
      // Move cursor back to before rangeStart
      while (isAfter(cursor, rangeEnd)) cursor = subWeeks(cursor, 1);
      while (isAfter(cursor, rangeStart)) cursor = subWeeks(cursor, 1);
      // Now step forward through range
      while (isBefore(cursor, rangeStart)) cursor = addWeeks(cursor, 1);
      while (!isAfter(cursor, rangeEnd)) {
        if (!isBefore(cursor, rangeStart)) results.push(cursor);
        cursor = addWeeks(cursor, 1);
      }
      break;
    }

    case 'biweekly': {
      let cursor = anchor;
      while (isAfter(cursor, rangeEnd)) cursor = subWeeks(cursor, 2);
      while (isAfter(cursor, rangeStart)) cursor = subWeeks(cursor, 2);
      while (isBefore(cursor, rangeStart)) cursor = addWeeks(cursor, 2);
      while (!isAfter(cursor, rangeEnd)) {
        if (!isBefore(cursor, rangeStart)) results.push(cursor);
        cursor = addWeeks(cursor, 2);
      }
      break;
    }

    case 'monthly': {
      const dayOfMonth = sub.billing_day || getDate(anchor);
      const targetMonth = rangeStart;
      const daysInMonth = getDaysInMonth(targetMonth);
      const clampedDay = Math.min(dayOfMonth, daysInMonth);
      const date = setDate(targetMonth, clampedDay);
      if (!isBefore(date, rangeStart) && !isAfter(date, rangeEnd)) {
        results.push(date);
      }
      break;
    }

    case 'bimonthly': {
      const dayOfMonth = sub.billing_day || getDate(anchor);
      const monthDiff = differenceInCalendarMonths(rangeStart, anchor);
      // Check if this month aligns with the bimonthly cadence
      const remainder = ((monthDiff % 2) + 2) % 2; // Handle negative modulo
      if (remainder === 0) {
        const daysInMonth = getDaysInMonth(rangeStart);
        const clampedDay = Math.min(dayOfMonth, daysInMonth);
        const date = setDate(rangeStart, clampedDay);
        if (!isBefore(date, rangeStart) && !isAfter(date, rangeEnd)) {
          results.push(date);
        }
      }
      break;
    }

    case 'quarterly': {
      const dayOfMonth = sub.billing_day || getDate(anchor);
      const monthDiff = differenceInCalendarMonths(rangeStart, anchor);
      const remainder = ((monthDiff % 3) + 3) % 3;
      if (remainder === 0) {
        const daysInMonth = getDaysInMonth(rangeStart);
        const clampedDay = Math.min(dayOfMonth, daysInMonth);
        const date = setDate(rangeStart, clampedDay);
        if (!isBefore(date, rangeStart) && !isAfter(date, rangeEnd)) {
          results.push(date);
        }
      }
      break;
    }

    case 'yearly': {
      const dayOfMonth = sub.billing_day || getDate(anchor);
      // Only show if anchor month matches display month
      if (anchor.getMonth() === rangeStart.getMonth()) {
        const daysInMonth = getDaysInMonth(rangeStart);
        const clampedDay = Math.min(dayOfMonth, daysInMonth);
        const date = setDate(rangeStart, clampedDay);
        if (!isBefore(date, rangeStart) && !isAfter(date, rangeEnd)) {
          results.push(date);
        }
      }
      break;
    }

    case 'variable':
    default: {
      // Only show the literal next_expected_date if it falls in range
      if (!isBefore(anchor, rangeStart) && !isAfter(anchor, rangeEnd)) {
        results.push(anchor);
      }
      break;
    }
  }

  return results;
}

/**
 * Build the full calendar data model for a given month.
 * Filters to only active/keep subscriptions.
 */
export function buildCalendarData(
  subscriptions: Subscription[],
  year: number,
  month: number,
): CalendarDayData[] {
  const grid = buildCalendarGrid(year, month);
  const monthStart = startOfMonth(new Date(year, month));
  const monthEnd = endOfMonth(monthStart);

  // Only include active/keep subscriptions
  const activeSubscriptions = subscriptions.filter(
    (s) => s.status === 'active' || s.status === 'keep',
  );

  // Pre-compute all projected dates per subscription
  const projections = activeSubscriptions.map((sub) => ({
    subscription: sub,
    amount: getEffectiveAmount(sub),
    dates: projectSubscriptionDates(sub, monthStart, monthEnd),
  }));

  // Map each grid day to its subscriptions
  return grid.map((date) => ({
    date,
    subscriptions: projections
      .filter((p) => p.dates.some((d) => isSameDay(d, date)))
      .map((p) => ({
        subscription: p.subscription,
        amount: p.amount,
      })),
  }));
}

/**
 * Calculate the total projected charges for the current month's data.
 * Only counts days that are within the target month.
 */
export function getMonthTotal(calendarData: CalendarDayData[], year: number, month: number): number {
  const targetMonth = new Date(year, month);
  return calendarData
    .filter((day) => isSameMonth(day.date, targetMonth))
    .reduce((sum, day) => sum + day.subscriptions.reduce((s, e) => s + e.amount, 0), 0);
}
