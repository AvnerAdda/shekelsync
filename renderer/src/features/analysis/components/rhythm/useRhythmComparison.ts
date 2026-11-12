import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@renderer/lib/api-client';
import type { RhythmComparison, RhythmGranularity, RhythmMetric, RhythmScope } from './types';

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: RhythmComparison }>();

export function clearRhythmComparisonCache() {
  cache.clear();
}

export function useRhythmComparison(
  granularity: RhythmGranularity,
  metric: RhythmMetric,
  scope: RhythmScope,
  enabled: boolean,
) {
  const key = `${granularity}|${metric}|${scope}`;
  const [data, setData] = useState<RhythmComparison | null>(() => cache.get(key)?.data ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    const cached = cache.get(key);
    if (!force && cached && Date.now() - cached.at < CACHE_MS) {
      setData(cached.data);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ granularity, metric, scope });
      const response = await apiClient.get<RhythmComparison>(`/api/analytics/rhythm-comparison?${params}`);
      if (!response.ok || !response.data) throw new Error('fetch_failed');
      cache.set(key, { at: Date.now(), data: response.data });
      setData(response.data);
    } catch (err) {
      console.error('Failed to load rhythm comparison:', err);
      setError(err instanceof Error ? err.message : 'fetch_failed');
    } finally {
      setLoading(false);
    }
  }, [granularity, key, metric, scope]);

  useEffect(() => {
    if (!enabled) return;
    setData(cache.get(key)?.data ?? null);
    void load();
  }, [enabled, key, load]);

  return { data, loading, error, reload: () => load(true) };
}
