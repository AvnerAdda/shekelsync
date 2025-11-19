import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type {
  SpendingCategory,
  SpendingCategoryMapping,
  SpendingCategoryBreakdownResponse,
  SpendingCategoryMappingsResponse,
  InitializeSpendingCategoriesResponse,
} from '@renderer/types/spending-categories';

interface UseSpendingCategoriesOptions {
  spendingCategory?: SpendingCategory;
  categoryDefinitionId?: number;
  autoLoad?: boolean;
}

export function useSpendingCategories(options: UseSpendingCategoriesOptions = {}) {
  const { spendingCategory, categoryDefinitionId, autoLoad = true } = options;

  const [mappings, setMappings] = useState<SpendingCategoryMapping[]>([]);
  const [breakdown, setBreakdown] = useState<SpendingCategoryBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMappings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (spendingCategory) params.append('spendingCategory', spendingCategory);
      if (categoryDefinitionId) params.append('categoryDefinitionId', categoryDefinitionId.toString());

      const response = await apiClient.get(`/api/spending-categories/mappings?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Failed to fetch spending category mappings');
      }

      const data = response.data as SpendingCategoryMappingsResponse;
      setMappings(data.mappings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error fetching spending category mappings:', err);
    } finally {
      setLoading(false);
    }
  }, [spendingCategory, categoryDefinitionId]);

  const initialize = useCallback(async () => {
    setInitializing(true);
    setError(null);

    try {
      const response = await apiClient.post('/api/spending-categories/initialize');

      if (!response.ok) {
        throw new Error('Failed to initialize spending categories');
      }

      const data = response.data as InitializeSpendingCategoriesResponse;

      // Refresh mappings after initialization
      await fetchMappings();

      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error initializing spending categories:', err);
      throw err;
    } finally {
      setInitializing(false);
    }
  }, [fetchMappings]);

  const fetchBreakdown = useCallback(async (months: number = 3, autoInitialize: boolean = true) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.append('months', months.toString());

      const response = await apiClient.get(`/api/spending-categories/breakdown?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Failed to fetch spending category breakdown');
      }

      const data = response.data as SpendingCategoryBreakdownResponse;

      // If no breakdown data and auto-initialize is enabled, initialize and retry
      if (data.breakdown.length === 0 && autoInitialize) {
        console.log('No spending category data found, auto-initializing...');
        await initialize();

        // Retry breakdown fetch after initialization
        const retryResponse = await apiClient.get(`/api/spending-categories/breakdown?${params.toString()}`);
        if (retryResponse.ok) {
          const retryData = retryResponse.data as SpendingCategoryBreakdownResponse;
          setBreakdown(retryData);
        } else {
          setBreakdown(data);
        }
      } else {
        setBreakdown(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error fetching spending category breakdown:', err);
    } finally {
      setLoading(false);
    }
  }, [initialize]);

  const updateMapping = useCallback(async (
    categoryDefId: number,
    updates: {
      spendingCategory?: SpendingCategory;
      variabilityType?: 'fixed' | 'variable' | 'seasonal';
      targetPercentage?: number;
      notes?: string;
    }
  ) => {
    setError(null);

    try {
      const response = await apiClient.put(`/api/spending-categories/mapping/${categoryDefId}`, updates);

      if (!response.ok) {
        throw new Error('Failed to update spending category mapping');
      }

      // Update local state
      setMappings(prev =>
        prev.map(mapping =>
          mapping.category_definition_id === categoryDefId
            ? { ...mapping, ...updates, updated_at: new Date().toISOString() }
            : mapping
        )
      );

      // Refresh to get updated data
      await fetchMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error updating spending category mapping:', err);
      throw err;
    }
  }, [fetchMappings]);

  const updateTargets = useCallback(async (targets: Record<SpendingCategory, number>) => {
    setError(null);

    try {
      const response = await apiClient.put('/api/spending-categories/targets', targets);

      if (!response.ok) {
        throw new Error('Failed to update spending category targets');
      }

      // Refresh breakdown to reflect new targets
      if (breakdown) {
        await fetchBreakdown();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error updating spending category targets:', err);
      throw err;
    }
  }, [breakdown, fetchBreakdown]);

  useEffect(() => {
    if (autoLoad) {
      fetchMappings();
    }
  }, [autoLoad, fetchMappings]);

  return {
    mappings,
    breakdown,
    loading,
    initializing,
    error,
    fetchMappings,
    fetchBreakdown,
    initialize,
    updateMapping,
    updateTargets,
  };
}
