import { useCallback, useEffect, useRef } from 'react';
import { format, subDays } from 'date-fns';
import { apiClient } from '@renderer/lib/api-client';
import { useThemeMode } from '@renderer/contexts/ThemeContext';

/** Same rolling window as the Analysis "Scoring" tab's default (last 60 days). */
export const THEME_HEALTH_WINDOW_DAYS = 60;

interface HealthScoreResponse {
  overallHealthScore?: number;
  healthScoreMeta?: {
    confidence?: Record<string, boolean>;
  };
}

/**
 * Colors the whole app by the Financial Health Score from launch, instead of
 * only after the user opens the Scoring tab. Refetches whenever app data
 * changes (sync, edits) via the global `dataRefresh` event.
 *
 * With no usable data at all (fresh install), the score is meaningless, so the
 * default accent is kept rather than painting the app red.
 */
export function HealthScoreThemeSync(): null {
  const { setHealthScore } = useThemeMode();
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const now = new Date();
    const endDate = format(now, 'yyyy-MM-dd');
    const startDate = format(subDays(now, THEME_HEALTH_WINDOW_DAYS - 1), 'yyyy-MM-dd');
    try {
      const response = await apiClient.get<HealthScoreResponse>(
        `/api/analytics/personal-intelligence?startDate=${startDate}&endDate=${endDate}`,
      );
      if (requestId !== requestIdRef.current || !response.ok) return;
      const score = response.data?.overallHealthScore;
      const confidence = response.data?.healthScoreMeta?.confidence;
      const hasAnyData = !confidence || Object.values(confidence).some(Boolean);
      setHealthScore(typeof score === 'number' && hasAnyData ? score : null);
    } catch (error) {
      console.error('Failed to load health score for app theme:', error);
    }
  }, [setHealthScore]);

  useEffect(() => {
    void refresh();
    const onDataRefresh = () => { void refresh(); };
    window.addEventListener('dataRefresh', onDataRefresh);
    return () => {
      requestIdRef.current += 1;
      window.removeEventListener('dataRefresh', onDataRefresh);
    };
  }, [refresh]);

  return null;
}

export default HealthScoreThemeSync;
