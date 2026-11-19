import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@renderer/lib/api-client';
import type { BeforeAfterCategory, BeforeAfterResponse } from '../types';

const ENDPOINT = '/api/analytics/before-after';

/** Overrides are only the categories the user moved away from their default. */
export function overridesFor(categories: BeforeAfterCategory[], changedKey: string, needed: boolean): Record<string, boolean> {
  const overrides: Record<string, boolean> = {};
  categories.forEach((category) => {
    const value = category.key === changedKey ? needed : category.needed;
    if (value !== category.defaultNeeded) overrides[category.key] = value;
  });
  return overrides;
}

export function useBeforeAfter(enabled: boolean) {
  const [data, setData] = useState<BeforeAfterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<BeforeAfterResponse>(ENDPOINT, force ? { cacheMode: 'reload' } : undefined);
      if (!response.ok || !response.data) throw new Error('fetch_failed');
      setData(response.data);
    } catch (err) {
      console.error('Failed to load before/after comparison:', err);
      setError(err instanceof Error ? err.message : 'fetch_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    void load(true);
    const onRefresh = () => { void load(true); };
    window.addEventListener('dataRefresh', onRefresh);
    return () => window.removeEventListener('dataRefresh', onRefresh);
  }, [enabled, load]);

  const setNeeded = useCallback(async (key: string, needed: boolean) => {
    if (!data) return;
    setSaving(true);
    try {
      const overrides = overridesFor(data.categories, key, needed);
      const response = await apiClient.put(`${ENDPOINT}/category-overrides`, { overrides });
      if (!response.ok) throw new Error('save_failed');
      await load(true);
    } catch (err) {
      console.error('Failed to save needed categories:', err);
      setError(err instanceof Error ? err.message : 'save_failed');
    } finally {
      setSaving(false);
    }
  }, [data, load]);

  const resetNeeded = useCallback(async () => {
    setSaving(true);
    try {
      const response = await apiClient.put(`${ENDPOINT}/category-overrides`, { overrides: {} });
      if (!response.ok) throw new Error('save_failed');
      await load(true);
    } catch (err) {
      console.error('Failed to reset needed categories:', err);
      setError(err instanceof Error ? err.message : 'save_failed');
    } finally {
      setSaving(false);
    }
  }, [load]);

  return { data, loading, saving, error, reload: () => load(true), setNeeded, resetNeeded };
}
