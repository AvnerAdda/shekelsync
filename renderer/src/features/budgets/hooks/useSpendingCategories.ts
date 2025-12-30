import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type {
  SpendingCategory,
  SpendingCategoryMapping,
  SpendingCategoryBreakdownResponse,
  SpendingCategoryMappingsResponse,
  InitializeSpendingCategoriesResponse,
  CategoryWithSpending,
  SpendingAllocation,
} from '@renderer/types/spending-categories';

interface UseSpendingCategoriesOptions {
  spendingCategory?: SpendingCategory;
  categoryDefinitionId?: number;
  autoLoad?: boolean;
  currentMonthOnly?: boolean;
  months?: number;
  startDate?: string;
  endDate?: string;
}

interface BulkAssignResponse {
  success: boolean;
  updated: number;
}

type FetchBreakdownOptions = {
  autoInitialize?: boolean;
  currentMonthOnly?: boolean;
  months?: number;
  startDate?: string;
  endDate?: string;
} | boolean;

export function useSpendingCategories(options: UseSpendingCategoriesOptions = {}) {
  const {
    spendingCategory,
    categoryDefinitionId,
    autoLoad = true,
    currentMonthOnly = true,
    months: defaultMonths = 3,
    startDate: defaultStartDate,
    endDate: defaultEndDate,
  } = options;

  const [mappings, setMappings] = useState<SpendingCategoryMapping[]>([]);
  const [breakdown, setBreakdown] = useState<SpendingCategoryBreakdownResponse | null>(null);
  const [selectedAllocation, setSelectedAllocation] = useState<SpendingAllocation | null>(null);
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

  const fetchBreakdown = useCallback(async (options: FetchBreakdownOptions = { autoInitialize: true }) => {
    setLoading(true);
    setError(null);

    try {
      const normalizedOptions = typeof options === 'boolean'
        ? { autoInitialize: options }
        : options;

      const {
        autoInitialize = true,
        currentMonthOnly: overrideCurrentMonthOnly,
        months: monthsOverride,
        startDate: startDateOverride,
        endDate: endDateOverride,
      } = normalizedOptions;

      const resolvedCurrentMonthOnly = overrideCurrentMonthOnly ?? currentMonthOnly;
      const months = monthsOverride ?? defaultMonths;
      const startDate = startDateOverride ?? defaultStartDate;
      const endDate = endDateOverride ?? defaultEndDate;

      const params = new URLSearchParams();
      params.append('currentMonthOnly', resolvedCurrentMonthOnly.toString());
      if (!resolvedCurrentMonthOnly) {
        if (months !== undefined) {
          params.append('months', months.toString());
        }
        if (startDate) {
          params.append('startDate', startDate);
        }
        if (endDate) {
          params.append('endDate', endDate);
        }
      }

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
  }, [initialize, currentMonthOnly, defaultMonths, defaultStartDate, defaultEndDate]);

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

  const bulkAssign = useCallback(async (
    categoryDefinitionIds: number[],
    targetCategory: SpendingCategory | null
  ) => {
    setError(null);

    try {
      const response = await apiClient.post('/api/spending-categories/bulk-assign', {
        categoryDefinitionIds,
        spendingCategory: targetCategory,
      });

      if (!response.ok) {
        throw new Error('Failed to bulk assign categories');
      }

      const data = response.data as BulkAssignResponse;

      // Refresh data after assignment
      await fetchMappings();
      await fetchBreakdown();

      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error bulk assigning categories:', err);
      throw err;
    }
  }, [fetchMappings, fetchBreakdown]);

  // Get categories for selected allocation type
  const getCategoriesForAllocation = useCallback((allocationType: SpendingAllocation): CategoryWithSpending[] => {
    if (!breakdown?.categories_by_allocation) {
      return [];
    }
    return breakdown.categories_by_allocation[allocationType] || [];
  }, [breakdown]);

  useEffect(() => {
    if (autoLoad) {
      fetchMappings();
    }
  }, [autoLoad, fetchMappings]);

  return {
    mappings,
    breakdown,
    selectedAllocation,
    setSelectedAllocation,
    loading,
    initializing,
    error,
    fetchMappings,
    fetchBreakdown,
    initialize,
    updateMapping,
    updateTargets,
    bulkAssign,
    getCategoriesForAllocation,
  };
}
