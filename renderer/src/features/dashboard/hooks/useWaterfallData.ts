import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { WaterfallFlowData } from '@renderer/types/analytics';

interface UseWaterfallDataOptions {
  startDate: Date;
  endDate: Date;
}

interface UseWaterfallDataResult {
  data: WaterfallFlowData | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useWaterfallData({ startDate, endDate }: UseWaterfallDataOptions): UseWaterfallDataResult {
  const [data, setData] = useState<WaterfallFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);

  const fetchWaterfall = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get(
        `/api/analytics/waterfall-flow?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`,
      );

      if (!response.ok) {
        throw new Error('Failed to fetch waterfall data');
      }

      if (requestId !== requestIdRef.current) {
        return;
      }

      setData(response.data as WaterfallFlowData);
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setData(null);
      setError(err as Error);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [endDate, startDate]);

  useEffect(() => {
    fetchWaterfall();
  }, [fetchWaterfall]);

  const refresh = useCallback(() => {
    void fetchWaterfall();
  }, [fetchWaterfall]);

  return { data, loading, error, refresh };
}
