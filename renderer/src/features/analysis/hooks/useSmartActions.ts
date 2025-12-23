import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type {
  SmartAction,
  SmartActionsResponse,
  GenerateSmartActionsResponse,
  SmartActionStatus,
  SmartActionSeverity,
  SmartActionType,
} from '@renderer/types/smart-actions';
import { useLocaleSettings } from '@renderer/i18n/I18nProvider';

interface UseSmartActionsOptions {
  status?: SmartActionStatus;
  severity?: SmartActionSeverity;
  actionType?: SmartActionType;
  autoLoad?: boolean;
}

export function useSmartActions(options: UseSmartActionsOptions = {}) {
  const { status = 'active', severity, actionType, autoLoad = true } = options;
  const { locale } = useLocaleSettings();

  const [actions, setActions] = useState<SmartAction[]>([]);
  const [summary, setSummary] = useState<SmartActionsResponse['summary'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (status) params.append('status', status);
      if (severity) params.append('severity', severity);
      if (actionType) params.append('actionType', actionType);
      if (locale) params.append('locale', locale);

      const response = await apiClient.get(`/api/smart-actions?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Failed to fetch smart actions');
      }

      const data = response.data as SmartActionsResponse;
      setActions(data.actions);
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error fetching smart actions:', err);
    } finally {
      setLoading(false);
    }
  }, [status, severity, actionType, locale]);

  const generateActions = useCallback(async (months: number = 1, force: boolean = false) => {
    setGenerating(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.append('months', months.toString());
      if (force) params.append('force', 'true');

      const response = await apiClient.post(`/api/smart-actions/generate?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Failed to generate smart actions');
      }

      const data = response.data as GenerateSmartActionsResponse;

      // Refresh actions after generation
      await fetchActions();

      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error generating smart actions:', err);
      throw err;
    } finally {
      setGenerating(false);
    }
  }, [fetchActions]);

  const updateActionStatus = useCallback(async (
    actionId: number,
    newStatus: SmartActionStatus,
    userNote?: string
  ) => {
    setError(null);

    try {
      const response = await apiClient.put(`/api/smart-actions/${actionId}/status`, {
        status: newStatus,
        userNote,
      });

      if (!response.ok) {
        throw new Error('Failed to update action status');
      }

      // Update local state
      setActions(prev =>
        prev.map(action =>
          action.id === actionId
            ? { ...action, user_status: newStatus, updated_at: new Date().toISOString() }
            : action
        )
      );

      // Refresh to get updated summary
      await fetchActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error updating action status:', err);
      throw err;
    }
  }, [fetchActions]);

  const resolveAction = useCallback(async (actionId: number, userNote?: string) => {
    return updateActionStatus(actionId, 'resolved', userNote);
  }, [updateActionStatus]);

  const dismissAction = useCallback(async (actionId: number, userNote?: string) => {
    return updateActionStatus(actionId, 'dismissed', userNote);
  }, [updateActionStatus]);

  const snoozeAction = useCallback(async (actionId: number, userNote?: string) => {
    return updateActionStatus(actionId, 'snoozed', userNote);
  }, [updateActionStatus]);

  useEffect(() => {
    if (autoLoad) {
      fetchActions();
    }
  }, [autoLoad, fetchActions]);

  return {
    actions,
    summary,
    loading,
    generating,
    error,
    fetchActions,
    generateActions,
    updateActionStatus,
    resolveAction,
    dismissAction,
    snoozeAction,
  };
}
