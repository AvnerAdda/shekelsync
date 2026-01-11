import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import type { InvestmentBalanceSheetResponse } from '@renderer/types/investments';

interface UseInvestmentBalanceSheetOptions {
  enabled?: boolean;
}

interface UseInvestmentBalanceSheetResult {
  data: InvestmentBalanceSheetResponse | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useInvestmentBalanceSheet(
  options: UseInvestmentBalanceSheetOptions = {},
): UseInvestmentBalanceSheetResult {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<InvestmentBalanceSheetResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);

  const fetchBalanceSheet = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<InvestmentBalanceSheetResponse>('/api/investments/balance-sheet');
      if (!response.ok) {
        throw new Error(response.statusText || 'Failed to fetch balance sheet');
      }

      if (requestId !== requestIdRef.current) return;
      setData((response.data as InvestmentBalanceSheetResponse) || null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setData(null);
      setError(err as Error);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void fetchBalanceSheet();
  }, [enabled, fetchBalanceSheet]);

  const refresh = useCallback(() => {
    return fetchBalanceSheet();
  }, [fetchBalanceSheet]);

  return {
    data,
    loading,
    error,
    refresh,
  };
}
