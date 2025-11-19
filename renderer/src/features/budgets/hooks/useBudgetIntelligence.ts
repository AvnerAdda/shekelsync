import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type {
  BudgetSuggestion,
  BudgetSuggestionsResponse,
  GenerateBudgetSuggestionsResponse,
  BudgetTrajectoryResponse,
  BudgetHealthResponse,
} from '@renderer/types/budget-intelligence';

interface UseBudgetIntelligenceOptions {
  minConfidence?: number;
  autoLoad?: boolean;
}

export function useBudgetIntelligence(options: UseBudgetIntelligenceOptions = {}) {
  const { minConfidence = 0.5, autoLoad = true } = options;

  const [suggestions, setSuggestions] = useState<BudgetSuggestion[]>([]);
  const [health, setHealth] = useState<BudgetHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestions = useCallback(async (includeActive: boolean = true) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.append('minConfidence', minConfidence.toString());
      params.append('includeActive', includeActive.toString());

      const response = await apiClient.get(`/api/budget-intelligence/suggestions?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Failed to fetch budget suggestions');
      }

      const data = response.data as BudgetSuggestionsResponse;
      setSuggestions(data.suggestions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error fetching budget suggestions:', err);
    } finally {
      setLoading(false);
    }
  }, [minConfidence]);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get('/api/budget-intelligence/health');

      if (!response.ok) {
        throw new Error('Failed to fetch budget health');
      }

      const data = response.data as BudgetHealthResponse;
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error fetching budget health:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const generateSuggestions = useCallback(async (months: number = 6) => {
    setGenerating(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.append('months', months.toString());

      const response = await apiClient.post(`/api/budget-intelligence/generate?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Failed to generate budget suggestions');
      }

      const data = response.data as GenerateBudgetSuggestionsResponse;

      // Refresh suggestions after generation
      await fetchSuggestions();

      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error generating budget suggestions:', err);
      throw err;
    } finally {
      setGenerating(false);
    }
  }, [fetchSuggestions]);

  const activateSuggestion = useCallback(async (suggestionId: number) => {
    setError(null);

    try {
      const response = await apiClient.post(`/api/budget-intelligence/suggestions/${suggestionId}/activate`);

      if (!response.ok) {
        throw new Error('Failed to activate budget suggestion');
      }

      // Update local state
      setSuggestions(prev =>
        prev.map(suggestion =>
          suggestion.id === suggestionId
            ? { ...suggestion, is_active: true, activated_at: new Date().toISOString() }
            : suggestion
        )
      );

      // Refresh suggestions and health
      await Promise.all([fetchSuggestions(), fetchHealth()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error activating budget suggestion:', err);
      throw err;
    }
  }, [fetchSuggestions, fetchHealth]);

  const getTrajectory = useCallback(async (budgetId?: number, categoryDefinitionId?: number) => {
    if (!budgetId && !categoryDefinitionId) {
      throw new Error('Either budgetId or categoryDefinitionId is required');
    }

    setError(null);

    try {
      const params = new URLSearchParams();
      if (budgetId) params.append('budgetId', budgetId.toString());
      if (categoryDefinitionId) params.append('categoryDefinitionId', categoryDefinitionId.toString());

      const response = await apiClient.get(`/api/budget-intelligence/trajectory?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Failed to fetch budget trajectory');
      }

      const data = response.data as BudgetTrajectoryResponse;
      return data.trajectory;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error fetching budget trajectory:', err);
      throw err;
    }
  }, []);

  useEffect(() => {
    if (autoLoad) {
      Promise.all([fetchSuggestions(), fetchHealth()]);
    }
  }, [autoLoad, fetchSuggestions, fetchHealth]);

  return {
    suggestions,
    health,
    loading,
    generating,
    error,
    fetchSuggestions,
    fetchHealth,
    generateSuggestions,
    activateSuggestion,
    getTrajectory,
  };
}
