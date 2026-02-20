import { useCallback, useEffect, useRef, useState } from 'react';
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { apiClient } from '@/lib/api-client';
import {
  AggregationPeriod,
  CumulativePoint,
  DashboardData,
  DashboardHistoryEntry,
} from '@renderer/types/dashboard';

interface UseDashboardDataOptions {
  startDate: Date;
  endDate: Date;
  aggregation: AggregationPeriod;
  enabled?: boolean;
}

interface UseDashboardDataResult {
  data: DashboardData | null;
  loading: boolean;
  error: Error | null;
  cumulativeData: CumulativePoint[];
  refresh: () => void;
}

function isCurrentMonthRange(startDate: Date, endDate: Date): boolean {
  const now = new Date();
  const currentMonth = format(now, 'yyyy-MM');
  return format(startDate, 'yyyy-MM') === currentMonth && format(endDate, 'yyyy-MM') === currentMonth;
}

function fillMissingDates(
  history: DashboardHistoryEntry[] | undefined,
  startDate: Date,
  endDate: Date,
): DashboardHistoryEntry[] {
  if (!history || history.length === 0) {
    return [];
  }

  const dateMap = new Map(history.map((h) => [h.date, h]));
  const filled: DashboardHistoryEntry[] = [];
  const lastDataDate = new Date(Math.max(...history.map((h) => new Date(h.date).getTime())));
  const current = new Date(startDate.getTime());
  const actualEndDate = isCurrentMonthRange(startDate, endDate)
    ? endOfMonth(new Date())
    : new Date(endDate);

  while (current <= actualEndDate) {
    const dateStr = format(current, 'yyyy-MM-dd');
    const isFutureDate = current > lastDataDate;

    if (dateMap.has(dateStr)) {
      filled.push(dateMap.get(dateStr)!);
    } else if (isFutureDate) {
      filled.push({
        date: dateStr,
        income: null,
        expenses: null,
        capitalReturns: 0,
        cardRepayments: 0,
      });
    } else {
      filled.push({
        date: dateStr,
        income: 0,
        expenses: 0,
        capitalReturns: 0,
        cardRepayments: 0,
      });
    }

    current.setDate(current.getDate() + 1);
  }

  return filled;
}

function calculateCumulativeData(
  history: DashboardHistoryEntry[],
  lastMonthHistory: DashboardHistoryEntry[],
  startDate: Date,
  isCurrentMonth: boolean,
): CumulativePoint[] {
  if (!history || history.length === 0) {
    return [];
  }

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const endOfMonthDate = endOfMonth(startDate);
  const actualHistory = isCurrentMonth ? history.filter((day) => day.date <= todayStr) : history;

  let runningTotal = 0;
  const cumulative: CumulativePoint[] = [];

  actualHistory.forEach((day) => {
    const netFlow = (day.income || 0) - (day.expenses || 0);
    runningTotal += netFlow;
    cumulative.push({
      date: day.date,
      cumulative: runningTotal,
      netFlow,
      income: day.income ?? undefined,
      expenses: day.expenses ?? undefined,
      isActual: true,
      isPrediction: false,
    });
  });

  if (isCurrentMonth && cumulative.length > 0 && lastMonthHistory.length > 0) {
    const lastActualDate = new Date(cumulative[cumulative.length - 1].date);
    let predictionDate = new Date(lastActualDate);
    predictionDate.setDate(predictionDate.getDate() + 1);

    const lastMonthMap = new Map<number, number>();
    lastMonthHistory.forEach((day) => {
      const date = new Date(day.date);
      const dayOfMonth = date.getDate();
      lastMonthMap.set(dayOfMonth, (day.income || 0) - (day.expenses || 0));
    });

    while (predictionDate <= endOfMonthDate) {
      const dayOfMonth = predictionDate.getDate();
      const netFlow = lastMonthMap.get(dayOfMonth) || 0;
      runningTotal += netFlow;

      cumulative.push({
        date: format(predictionDate, 'yyyy-MM-dd'),
        cumulative: runningTotal,
        netFlow,
        isActual: false,
        isPrediction: true,
      });

      predictionDate.setDate(predictionDate.getDate() + 1);
    }
  }

  return cumulative;
}

async function fetchLastMonthHistory(startDate: Date): Promise<DashboardHistoryEntry[]> {
  const lastMonth = subMonths(startDate, 1);
  const lastMonthStart = startOfMonth(lastMonth);
  const lastMonthEnd = endOfMonth(lastMonth);

  try {
    const response = await apiClient.get(
      `/api/analytics/dashboard?startDate=${lastMonthStart.toISOString()}&endDate=${lastMonthEnd.toISOString()}&aggregation=daily&includeBreakdowns=0&includeSummary=0`,
    );

    if (!response.ok) {
      return [];
    }

    const result = response.data as DashboardData;
    return result.history || [];
  } catch (error) {
    console.error('Error fetching last month history:', error);
    return [];
  }
}

export function useDashboardData({
  startDate,
  endDate,
  aggregation,
  enabled = true,
}: UseDashboardDataOptions): UseDashboardDataResult {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(enabled));
  const [cumulativeData, setCumulativeData] = useState<CumulativePoint[]>([]);
  const requestIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!enabled) {
      setLoading(false);
      setError(null);
      setData(null);
      setCumulativeData([]);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get(
        `/api/analytics/dashboard?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}&aggregation=${aggregation}&includeBreakdowns=0`,
      );

      if (!response.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      let result = response.data as DashboardData;
      if (aggregation === 'daily') {
        result = {
          ...result,
          history: fillMissingDates(result.history, startDate, endDate),
        };
      }

      if (requestId !== requestIdRef.current) {
        return;
      }

      setData(result);
      const viewingCurrentMonth = isCurrentMonthRange(startDate, endDate);
      const baseHistory = result.history ?? [];
      setCumulativeData(
        baseHistory.length
          ? calculateCumulativeData(baseHistory, [], startDate, viewingCurrentMonth)
          : [],
      );

      if (viewingCurrentMonth && aggregation === 'daily' && baseHistory.length) {
        void fetchLastMonthHistory(startDate).then((lastMonthHistory) => {
          if (requestId !== requestIdRef.current) {
            return;
          }
          if (!lastMonthHistory.length) {
            return;
          }
          setCumulativeData(
            calculateCumulativeData(baseHistory, lastMonthHistory, startDate, true),
          );
        });
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      console.error('Error fetching dashboard data:', err);
      setError(err as Error);
      setData(null);
      setCumulativeData([]);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [aggregation, enabled, endDate, startDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refresh = useCallback(() => {
    void fetchData();
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    cumulativeData,
    refresh,
  };
}
