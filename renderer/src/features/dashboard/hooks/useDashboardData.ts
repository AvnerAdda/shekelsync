import { useCallback, useEffect, useRef, useState } from 'react';
import { endOfMonth, format } from 'date-fns';
import { apiClient } from '@/lib/api-client';
import {
  AggregationPeriod,
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
        operatingIncome: 0,
        nonOperatingIncome: 0,
        expenses: null,
        investments: null,
        operatingExpenses: 0,
        nonOperatingExpenses: 0,
        capitalReturns: 0,
        cardRepayments: 0,
        pairedCardExpenses: 0,
        pairedCardRepayments: 0,
      });
    } else {
      filled.push({
        date: dateStr,
        income: 0,
        operatingIncome: 0,
        nonOperatingIncome: 0,
        expenses: 0,
        investments: 0,
        operatingExpenses: 0,
        nonOperatingExpenses: 0,
        capitalReturns: 0,
        cardRepayments: 0,
        pairedCardExpenses: 0,
        pairedCardRepayments: 0,
      });
    }

    current.setDate(current.getDate() + 1);
  }

  return filled;
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
  const requestIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!enabled) {
      setLoading(false);
      setError(null);
      setData(null);
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
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      console.error('Error fetching dashboard data:', err);
      setError(err as Error);
      setData(null);
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
    refresh,
  };
}
