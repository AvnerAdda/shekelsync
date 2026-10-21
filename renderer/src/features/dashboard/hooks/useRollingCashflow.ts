import { useCallback, useEffect, useRef, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { apiClient } from '@renderer/lib/api-client';
import { FINANCIAL_TRUTH_CHANGED_EVENT } from '@renderer/features/financial-truth/types';
import type { DashboardData, DashboardHistoryEntry } from '@renderer/types/dashboard';

const CACHE_TTL_MS = 60_000;
const EMPTY_HISTORY: DashboardHistoryEntry[] = [];

/** Reuse recent daily actuals across tab switches and focus; mutations invalidate them. */
export function useRollingCashflow(start: string, rangeEnd: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ key: string; history: DashboardHistoryEntry[] } | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const requestId = useRef(0);
  const cacheVersion = useRef(0);
  const bypassServerCacheUntil = useRef(0);
  const cache = useRef(new Map<string, { history: DashboardHistoryEntry[]; loadedAt: number }>());
  const inFlight = useRef(new Map<string, Promise<DashboardHistoryEntry[]>>());
  const end = [rangeEnd, format(new Date(), 'yyyy-MM-dd')].sort()[0];
  const key = `${start}:${end}`;

  const refresh = useCallback(async (force = false) => {
    const request = ++requestId.current;
    if (force) {
      ++cacheVersion.current;
      bypassServerCacheUntil.current = Date.now() + CACHE_TTL_MS;
      cache.current.clear();
      inFlight.current.clear();
    }
    if (!enabled || start > end) {
      setLoading(false);
      setError(false);
      return;
    }
    const cached = cache.current.get(key);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      setSnapshot(previous => previous?.key === key && previous.history === cached.history
        ? previous : { key, history: cached.history });
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      let pending = inFlight.current.get(key);
      if (!pending) {
        const version = cacheVersion.current;
        const params = new URLSearchParams({
          startDate: format(subDays(parseISO(start), 29), 'yyyy-MM-dd'),
          endDate: end,
          aggregation: 'daily',
          includeBreakdowns: '0',
          includeSummary: '0',
          includeChartBreakdowns: '0',
          ...(Date.now() < bypassServerCacheUntil.current ? { noCache: '1' } : {}),
        });
        pending = (async () => {
          const response = await apiClient.get<DashboardData>(`/api/analytics/dashboard?${params}`, { cacheMode: 'no-store' });
          if (!response.ok || !Array.isArray(response.data?.history)) throw new Error('Unavailable');
          if (version === cacheVersion.current) {
            cache.current.set(key, { history: response.data.history, loadedAt: Date.now() });
            if (cache.current.size > 5) cache.current.delete(cache.current.keys().next().value!);
          }
          return response.data.history;
        })();
        inFlight.current.set(key, pending);
      }
      let history: DashboardHistoryEntry[];
      try {
        history = await pending;
      } finally {
        if (inFlight.current.get(key) === pending) inFlight.current.delete(key);
      }
      if (request === requestId.current) setSnapshot({ key, history });
    } catch {
      if (request === requestId.current) setError(true);
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [enabled, start, end, key]);

  useEffect(() => {
    const requests = requestId;
    const version = cacheVersion;
    const cachedRanges = cache;
    const pendingRequests = inFlight;
    const bypassUntil = bypassServerCacheUntil;
    void refresh();
    // A correction can emit both events; coalesce them into one fresh request.
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const onRefresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void refresh(true);
      }, 100);
    };
    const onFocus = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    window.addEventListener('dataRefresh', onRefresh);
    window.addEventListener(FINANCIAL_TRUTH_CHANGED_EVENT, onRefresh);
    window.addEventListener('focus', onFocus);
    return () => {
      ++requests.current;
      // Invalidate immediately if a queued mutation refresh is interrupted by
      // a tab/date change, so the next activation cannot reuse pre-edit data.
      if (refreshTimer !== undefined) {
        clearTimeout(refreshTimer);
        ++version.current;
        bypassUntil.current = Date.now() + CACHE_TTL_MS;
        cachedRanges.current.clear();
        pendingRequests.current.clear();
      }
      window.removeEventListener('dataRefresh', onRefresh);
      window.removeEventListener(FINANCIAL_TRUTH_CHANGED_EVENT, onRefresh);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return { history: snapshot?.key === key ? snapshot.history : EMPTY_HISTORY, loading, error, refresh, end };
}
