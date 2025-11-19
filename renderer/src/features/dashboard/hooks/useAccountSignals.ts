import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface UseAccountSignalsResult {
  budgetUsage: number | undefined;
  hasBankAccounts: boolean | null;
  refresh: () => void;
}

export function useAccountSignals(): UseAccountSignalsResult {
  const [budgetUsage, setBudgetUsage] = useState<number | undefined>(undefined);
  const [hasBankAccounts, setHasBankAccounts] = useState<boolean | null>(null);
  const requestIdRef = useRef(0);

  const fetchSignals = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    try {
      const [budgetRes, credentialsRes] = await Promise.all([
        apiClient.get('/api/budgets/usage'),
        apiClient.get('/api/credentials'),
      ]);

      if (requestId !== requestIdRef.current) {
        return;
      }

      if (budgetRes.ok && Array.isArray(budgetRes.data) && budgetRes.data.length > 0) {
        const avgUsage =
          budgetRes.data.reduce((sum: number, b: any) => sum + (b?.percentage ?? 0), 0) /
          budgetRes.data.length;
        setBudgetUsage(avgUsage);
      } else {
        setBudgetUsage(undefined);
      }

      if (credentialsRes.ok && Array.isArray(credentialsRes.data)) {
        setHasBankAccounts(credentialsRes.data.length > 0);
      } else {
        setHasBankAccounts(null);
      }
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      console.error('Error fetching account signals:', error);
      setBudgetUsage(undefined);
      setHasBankAccounts(null);
    }
  }, []);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  const refresh = useCallback(() => {
    void fetchSignals();
  }, [fetchSignals]);

  return {
    budgetUsage,
    hasBankAccounts,
    refresh,
  };
}
