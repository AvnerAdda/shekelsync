import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, type ApiResponse } from '@/lib/api-client';

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

export function useDashboardInsights(): UseDashboardInsightsResult {
  const [forecastData, setForecastData] = useState<DashboardForecastData | null>(null);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [healthSnapshot, setHealthSnapshot] = useState<DashboardHealthSnapshot | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const requestIdRef = useRef(0);

  const fetchInsights = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setForecastLoading(true);
    setHealthLoading(true);
    setForecastError(null);

    const [forecastResult, healthResult] = await Promise.allSettled([
      apiClient.get<DashboardForecastData>('/api/forecast/daily?days=30'),
      apiClient.get<DashboardHealthSnapshot>('/api/analytics/personal-intelligence?days=60'),
    ]);

    if (requestId !== requestIdRef.current) return;

    if (forecastResult.status === 'fulfilled' && forecastResult.value.ok) {
      setForecastData(forecastResult.value.data);
    } else {
      const message = forecastResult.status === 'fulfilled'
        ? buildForecastErrorMessage(forecastResult.value)
        : forecastResult.reason instanceof Error
          ? forecastResult.reason.message
          : 'Failed to fetch forecast';
      setForecastError(message);
    }

    if (healthResult.status === 'fulfilled' && healthResult.value.ok) {
      setHealthSnapshot(healthResult.value.data);
    } else if (healthResult.status === 'rejected') {
      console.error('Failed to fetch dashboard health snapshot:', healthResult.reason);
    }

    setForecastLoading(false);
    setHealthLoading(false);
  }, []);

  useEffect(() => {
    void fetchInsights();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchInsights]);

  const refresh = useCallback(() => {
    void fetchInsights();
  }, [fetchInsights]);

  return {
    forecastData,
    forecastLoading,
    forecastError,
    healthSnapshot,
    healthLoading,
    refresh,
  };
}
