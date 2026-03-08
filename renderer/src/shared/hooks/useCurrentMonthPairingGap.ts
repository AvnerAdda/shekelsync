import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import type { CurrentMonthPairingGapResponse } from '@renderer/types/accounts';

interface UseCurrentMonthPairingGapOptions {
  days?: number;
  enabled?: boolean;
}

interface UseCurrentMonthPairingGapResult {
  data: CurrentMonthPairingGapResponse | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

const DEFAULT_DAYS = 30;

export function useCurrentMonthPairingGap({
  days = DEFAULT_DAYS,
  enabled = true,
}: UseCurrentMonthPairingGapOptions = {}): UseCurrentMonthPairingGapResult {
  const [data, setData] = useState<CurrentMonthPairingGapResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(enabled));
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (!enabled) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<CurrentMonthPairingGapResponse | { error?: string }>(
        `/api/accounts/pairing/current-month-gap?days=${days}`,
      );

      if (!response.ok) {
        const apiError = typeof response.data === 'object' && response.data && 'error' in response.data
          ? String(response.data.error || 'Failed to fetch pairing gap')
          : 'Failed to fetch pairing gap';
        throw new Error(apiError);
      }

      if (requestId !== requestIdRef.current) {
        return;
      }

      setData(response.data as CurrentMonthPairingGapResponse);
    } catch (fetchError) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setError(fetchError instanceof Error ? fetchError : new Error('Failed to fetch pairing gap'));
      setData(null);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [days, enabled]);

  useEffect(() => {
    void fetchData();
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
