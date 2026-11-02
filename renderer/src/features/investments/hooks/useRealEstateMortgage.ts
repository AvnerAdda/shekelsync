import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import type {
  MarketSnapshot,
  PropertyAnalysisResponse,
  PropertyCost,
  PropertySettings,
  MortgageDraft,
  MortgagePreviewResponse,
  MortgageScenario,
  MortgageView,
} from '@renderer/types/investments';
import { isDraftComputable, toMortgagePayload } from '../components/real-estate/mortgage-utils';

function errorMessage(data: unknown, fallback: string): string {
  const payload = data as { error?: string } | undefined;
  return payload?.error || fallback;
}

function scenarioQuery(scenario: MortgageScenario | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(scenario || {})) {
    if (value !== undefined && value !== null && Number.isFinite(value)) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function useRealEstateMortgage(accountId: number | null, scenario?: MortgageScenario) {
  const [data, setData] = useState<MortgageView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const query = scenarioQuery(scenario);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<MortgageView>(
        `/api/investments/real-estate/properties/${accountId}/mortgage${query}`,
        { cacheMode: 'no-store' },
      );
      if (!response.ok) throw new Error(errorMessage(response.data, response.statusText || 'Failed to load mortgage'));
      if (requestId === requestIdRef.current) setData(response.data as MortgageView);
    } catch (loadError) {
      if (requestId === requestIdRef.current) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load mortgage');
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [accountId, query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (draft: MortgageDraft) => {
    if (!accountId) throw new Error('No property selected');
    const response = await apiClient.put<MortgageView>(
      `/api/investments/real-estate/properties/${accountId}/mortgage`,
      toMortgagePayload(draft),
    );
    if (!response.ok) throw new Error(errorMessage(response.data, response.statusText || 'Failed to save mortgage'));
    setData(response.data as MortgageView);
    return response.data as MortgageView;
  }, [accountId]);

  const remove = useCallback(async () => {
    if (!accountId) return;
    const response = await apiClient.delete(`/api/investments/real-estate/properties/${accountId}/mortgage`);
    if (!response.ok) throw new Error(errorMessage(response.data, response.statusText || 'Failed to delete mortgage'));
    await refresh();
  }, [accountId, refresh]);

  return { data, loading, error, refresh, save, remove };
}

/** Debounced live schedule for an unsaved draft. */
export function useMortgagePreview(draft: MortgageDraft | null, delayMs = 350) {
  const [data, setData] = useState<MortgagePreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const serialized = draft && isDraftComputable(draft) ? JSON.stringify(toMortgagePayload(draft)) : null;

  useEffect(() => {
    if (!serialized) {
      setData(null);
      setError(null);
      return undefined;
    }
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await apiClient.post<MortgagePreviewResponse>(
          '/api/investments/real-estate/mortgage/preview',
          { mortgage: JSON.parse(serialized) },
        );
        if (requestId !== requestIdRef.current) return;
        if (!response.ok) throw new Error(errorMessage(response.data, response.statusText || 'Preview failed'));
        setData(response.data as MortgagePreviewResponse);
        setError(null);
      } catch (previewError) {
        if (requestId !== requestIdRef.current) return;
        setError(previewError instanceof Error ? previewError.message : 'Preview failed');
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, delayMs);
    return () => clearTimeout(timer);
  }, [serialized, delayMs]);

  return { data, error, loading, computable: Boolean(serialized) };
}

export function useMarketSnapshot() {
  const [data, setData] = useState<MarketSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<MarketSnapshot>('/api/investments/market-data/snapshot', { cacheMode: 'no-store' });
      if (!response.ok) throw new Error(errorMessage(response.data, response.statusText || 'Failed to load market data'));
      setData(response.data as MarketSnapshot);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load market data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const response = await apiClient.post<{ failed: Array<{ key: string; message: string }> }>(
        '/api/investments/market-data/sync',
        { force: true },
      );
      if (!response.ok) throw new Error(errorMessage(response.data, response.statusText || 'Sync failed'));
      const failed = (response.data as { failed?: Array<{ key: string; message: string }> })?.failed || [];
      if (failed.length > 0) setError(failed.map((item) => `${item.key}: ${item.message}`).join('; '));
      await refresh();
      return true;
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Sync failed');
      return false;
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  return { data, loading, syncing, error, refresh, sync };
}

/** Sale / break-even analysis and mortgage health for one property. */
export function usePropertyAnalysis(accountId: number | null, refreshKey = 0) {
  const [data, setData] = useState<PropertyAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<PropertyAnalysisResponse>(
        `/api/investments/real-estate/properties/${accountId}/analysis`,
        { cacheMode: 'no-store' },
      );
      if (!response.ok) throw new Error(errorMessage(response.data, response.statusText || 'Failed to analyse property'));
      if (requestId === requestIdRef.current) setData(response.data as PropertyAnalysisResponse);
    } catch (loadError) {
      if (requestId === requestIdRef.current) setError(loadError instanceof Error ? loadError.message : 'Failed to analyse property');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const saveAssumptions = useCallback(async (settings: PropertySettings, costs: PropertyCost[]) => {
    if (!accountId) return;
    const settingsResponse = await apiClient.put(`/api/investments/real-estate/properties/${accountId}/settings`, settings);
    if (!settingsResponse.ok) throw new Error(errorMessage(settingsResponse.data, 'Failed to save assumptions'));
    const costsResponse = await apiClient.put(
      `/api/investments/real-estate/properties/${accountId}/costs`,
      costs.filter((cost) => !cost.derived).map(({ derived: _derived, id: _id, ...cost }) => cost),
    );
    if (!costsResponse.ok) throw new Error(errorMessage(costsResponse.data, 'Failed to save costs'));
    await refresh();
  }, [accountId, refresh]);

  return { data, loading, error, refresh, saveAssumptions };
}
