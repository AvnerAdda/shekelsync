import { addDays, endOfMonth, format, isValid, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import type { AggregationPeriod } from '@renderer/types/dashboard';

export interface TransactionPeriod {
  startDate: string;
  endDate: string;
}

/** Match the backend's Monday-based weeks and clip to the chart's query range. */
export function getTransactionPeriod(
  date: string,
  aggregation: AggregationPeriod,
  rangeStart: Date,
  rangeEnd: Date,
): TransactionPeriod | null {
  const parsed = parseISO(date.slice(0, 10));
  if (!isValid(parsed)) return null;
  const start = aggregation === 'weekly' ? startOfWeek(parsed, { weekStartsOn: 1 })
    : aggregation === 'monthly' ? startOfMonth(parsed) : parsed;
  const end = aggregation === 'weekly' ? addDays(start, 6)
    : aggregation === 'monthly' ? endOfMonth(start) : start;
  const startDate = [format(start, 'yyyy-MM-dd'), format(rangeStart, 'yyyy-MM-dd')].sort()[1];
  const endDate = [format(end, 'yyyy-MM-dd'), format(rangeEnd, 'yyyy-MM-dd')].sort()[0];
  return startDate <= endDate ? { startDate, endDate } : null;
}
