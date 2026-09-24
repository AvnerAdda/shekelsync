import { useCallback, useRef, useState } from 'react';
import { format } from 'date-fns';
import { apiClient } from '@/lib/api-client';
import { TransactionDetail } from '@renderer/types/transactions';

interface UseTransactionsByDateResult {
  transactions: TransactionDetail[];
  loading: boolean;
  fetchByDate: (date: string) => Promise<void>;
  fetchByRange: (startDate: string, endDate: string) => Promise<void>;
  reset: () => void;
}

const formatCalendarDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  ? date
  : format(new Date(date), 'yyyy-MM-dd');

export function useTransactionsByDate(): UseTransactionsByDateResult {
  const [transactions, setTransactions] = useState<TransactionDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const fetchTransactions = useCallback(async (dates: Record<string, string>) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setTransactions([]);
    try {
      const query = new URLSearchParams(Object.entries(dates).map(([key, date]) => [key, formatCalendarDate(date)]));
      const response = await apiClient.get(`/api/analytics/transactions-by-date?${query}`);
      if (requestId !== requestIdRef.current) return;
      if (response.ok) {
        const result = response.data as { transactions?: TransactionDetail[] };
        setTransactions(result.transactions || []);
      } else {
        console.error('API error while fetching date transactions:', response.status, response.statusText);
        setTransactions([]);
      }
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      console.error('Error fetching transactions by date:', error);
      setTransactions([]);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const fetchByDate = useCallback((date: string) => fetchTransactions({ date }), [fetchTransactions]);
  const fetchByRange = useCallback((startDate: string, endDate: string) => (
    fetchTransactions({ startDate, endDate })
  ), [fetchTransactions]);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setTransactions([]);
    setLoading(false);
  }, []);

  return {
    transactions,
    loading,
    fetchByDate,
    fetchByRange,
    reset,
  };
}
