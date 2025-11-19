import { useCallback, useState } from 'react';
import { format } from 'date-fns';
import { apiClient } from '@/lib/api-client';
import { TransactionDetail } from '@renderer/types/transactions';

interface UseTransactionsByDateResult {
  transactions: TransactionDetail[];
  loading: boolean;
  fetchByDate: (date: string) => Promise<void>;
  reset: () => void;
}

export function useTransactionsByDate(): UseTransactionsByDateResult {
  const [transactions, setTransactions] = useState<TransactionDetail[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchByDate = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const formattedDate = format(new Date(date), 'yyyy-MM-dd');
      const response = await apiClient.get(`/api/analytics/transactions-by-date?date=${formattedDate}`);
      if (response.ok) {
        const result = response.data as { transactions?: TransactionDetail[] };
        setTransactions(result.transactions || []);
      } else {
        console.error('API error while fetching date transactions:', response.status, response.statusText);
        setTransactions([]);
      }
    } catch (error) {
      console.error('Error fetching transactions by date:', error);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setTransactions([]);
  }, []);

  return {
    transactions,
    loading,
    fetchByDate,
    reset,
  };
}
