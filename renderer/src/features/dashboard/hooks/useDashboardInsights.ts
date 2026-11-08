import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { apiClient, type ApiResponse } from '@/lib/api-client';
import { MAX_PROJECTION_DAYS } from '../components/net-position-projection-helpers';

export interface DashboardBudgetOutlookItem {
  actualSpent: number;
  forecasted: number;
  status: string;
}

export interface DashboardForecastData extends Record<string, any> {
  budgetOutlook?: DashboardBudgetOutlookItem[];
  dailyForecasts?: Array<Record<string, any>>;
}

export interface DashboardHealthSnapshot {
  overallHealthScore: number;
  healthBreakdown: {
    savingsScore?: number;
    diversityScore?: number;
    impulseScore?: number;
    runwayScore?: number;
  };
}

/** The window the health score is computed for (the period shown on Home). */
export interface DashboardHealthRange {
  startDate: Date;
  endDate: Date;
}

interface UseDashboardInsightsResult {
  forecastData: DashboardForecastData | null;
  forecastLoading: boolean;
  forecastError: string | null;
  healthSnapshot: DashboardHealthSnapshot | null;
  healthLoading: boolean;
  refresh: () => void;
}

function buildForecastErrorMessage(response: ApiResponse<unknown>): string {
  const payload = (response.data ?? null) as { message?: string; retryAfter?: number } | null;
  if (response.status === 429) {
    const retryAfter = Number(payload?.retryAfter);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return `Rate limit exceeded. Try again in ${Math.ceil(retryAfter)} seconds.`;
    }
    return payload?.message || 'Rate limit exceeded. Try again shortly.';
  }
  if (payload?.message?.trim()) return payload.message;
  if (response.statusText) return `Failed to fetch forecast: ${response.statusText}`;
  return `Failed to fetch forecast: HTTP ${response.status}`;
}

// Same calendar-day format the Analysis "Scoring" tab sends, so both pages
// score an identical window for the same period.
function toApiDay(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function useDashboardInsights(healthRange: DashboardHealthRange): UseDashboardInsightsResult {
  const [forecastData, setForecastData] = useState<DashboardForecastData | null>(null);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [healthSnapshot, setHealthSnapshot] = useState<DashboardHealthSnapshot | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const forecastRequestIdRef = useRef(0);
  const healthRequestIdRef = useRef(0);
  const healthStartDay = toApiDay(healthRange.startDate);
  const healthEndDay = toApiDay(healthRange.endDate);

  const fetchForecast = useCallback(async (noCache = false) => {
    const requestId = ++forecastRequestIdRef.current;
    setForecastLoading(true);
    setForecastError(null);

    try {
      const response = await apiClient.get<DashboardForecastData>(
        `/api/forecast/daily?days=${MAX_PROJECTION_DAYS}${noCache ? '&noCache=1' : ''}`,
      );
      if (requestId !== forecastRequestIdRef.current) return;
      if (response.ok) {
        setForecastData(response.data);
      } else {
        setForecastError(buildForecastErrorMessage(response));
      }
    } catch (error) {
      if (requestId !== forecastRequestIdRef.current) return;
      setForecastError(error instanceof Error ? error.message : 'Failed to fetch forecast');
    }
    setForecastLoading(false);
  }, []);

  const fetchHealth = useCallback(async () => {
    const requestId = ++healthRequestIdRef.current;
    setHealthLoading(true);

    try {
      const response = await apiClient.get<DashboardHealthSnapshot>(
        `/api/analytics/personal-intelligence?startDate=${healthStartDay}&endDate=${healthEndDay}`,
      );
      if (requestId !== healthRequestIdRef.current) return;
      // Never keep a previous period's score on screen for a new period.
      setHealthSnapshot(response.ok ? response.data : null);
    } catch (error) {
      if (requestId !== healthRequestIdRef.current) return;
      console.error('Failed to fetch dashboard health snapshot:', error);
      setHealthSnapshot(null);
    }
    setHealthLoading(false);
  }, [healthEndDay, healthStartDay]);

  useEffect(() => {
    void fetchForecast();
    return () => {
      forecastRequestIdRef.current += 1;
    };
  }, [fetchForecast]);

  useEffect(() => {
    void fetchHealth();
    return () => {
      healthRequestIdRef.current += 1;
    };
  }, [fetchHealth]);

  const refresh = useCallback(() => {
    void fetchForecast(true);
    void fetchHealth();
  }, [fetchForecast, fetchHealth]);

  return {
    forecastData,
    forecastLoading,
    forecastError,
    healthSnapshot,
    healthLoading,
    refresh,
  };
}
