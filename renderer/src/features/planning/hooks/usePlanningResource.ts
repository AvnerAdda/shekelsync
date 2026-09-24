import { useCallback, useEffect, useRef, useState } from 'react';
import { FINANCIAL_TRUTH_CHANGED_EVENT } from '@renderer/features/financial-truth/types';
import { PLANNING_CHANGED_EVENT } from '../types';

interface RefreshLifecycle {
  active: boolean;
  inFlight: Promise<void> | null;
  pending: boolean;
  focusTimer?: ReturnType<typeof setTimeout>;
}

/** Refresh a planning resource without losing invalidations received during a read. */
export function usePlanningResource<T>(load: () => Promise<T>, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const lifecycle = useRef<RefreshLifecycle | null>(null);

  const refresh = useCallback((invalidate = true): Promise<void> => {
    const current = lifecycle.current;
    if (!current?.active) return Promise.resolve();
    clearTimeout(current.focusTimer);
    if (current.inFlight) {
      // A changed plan needs a read that starts after the change. Focus events can
      // reuse the current read, but mutations must not reuse a stale response.
      if (invalidate) current.pending = true;
      return current.inFlight;
    }
    setLoading(true);
    setError(false);
    current.inFlight = (async () => {
      try {
        do {
          current.pending = false;
          try {
            const result = await load();
            if (current.active && !current.pending) setData(result);
          } catch {
            if (current.active && !current.pending) setError(true);
          }
        } while (current.active && current.pending);
      } finally {
        current.inFlight = null;
        if (current.active) setLoading(false);
      }
    })();
    return current.inFlight;
  }, [load]);

  useEffect(() => {
    if (!enabled) return undefined;
    const current: RefreshLifecycle = { active: true, inFlight: null, pending: false };
    lifecycle.current = current;
    // React StrictMode replays effects before this microtask; only the live mount
    // should start a request.
    void Promise.resolve().then(() => { if (current.active) void refresh(false); });

    const onChange = () => { void refresh(); };
    const onFocus = () => {
      if (document.visibilityState === 'hidden' || current.inFlight) return;
      clearTimeout(current.focusTimer);
      // Returning to the app often emits both visibilitychange and focus.
      current.focusTimer = setTimeout(() => { void refresh(false); }, 50);
    };
    let midnightTimer: ReturnType<typeof setTimeout>;
    const scheduleNextDay = () => {
      const now = new Date();
      const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      midnightTimer = setTimeout(() => {
        if (document.visibilityState !== 'hidden') void refresh();
        scheduleNextDay();
      }, nextDay.getTime() - now.getTime() + 1000);
    };
    scheduleNextDay();
    const changeEvents = [PLANNING_CHANGED_EVENT, FINANCIAL_TRUTH_CHANGED_EVENT, 'dataRefresh'];
    changeEvents.forEach((event) => window.addEventListener(event, onChange));
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      current.active = false;
      clearTimeout(current.focusTimer);
      clearTimeout(midnightTimer);
      changeEvents.forEach((event) => window.removeEventListener(event, onChange));
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      if (lifecycle.current === current) lifecycle.current = null;
    };
  }, [enabled, refresh]);

  return { data, loading, error, refresh };
}
