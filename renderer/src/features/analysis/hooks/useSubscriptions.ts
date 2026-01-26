import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { useLocaleSettings } from '@renderer/i18n/I18nProvider';
import type {
  Subscription,
  SubscriptionSummary,
  SubscriptionCreep,
  SubscriptionAlert,
  SubscriptionRenewal,
  GetSubscriptionsResponse,
  GetSubscriptionSummaryResponse,
  GetSubscriptionCreepResponse,
  GetSubscriptionAlertsResponse,
  GetUpcomingRenewalsResponse,
  UpdateSubscriptionRequest,
  AddSubscriptionRequest,
  MutationResponse,
  SubscriptionStatus,
  SubscriptionFrequency,
} from '@renderer/types/subscriptions';

interface UseSubscriptionsOptions {
  autoLoad?: boolean;
  status?: SubscriptionStatus;
  frequency?: SubscriptionFrequency;
}

export function useSubscriptions(options: UseSubscriptionsOptions = {}) {
  const { autoLoad = true, status, frequency } = options;
  const { locale } = useLocaleSettings();

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [creep, setCreep] = useState<SubscriptionCreep | null>(null);
  const [alerts, setAlerts] = useState<SubscriptionAlert[]>([]);
  const [renewals, setRenewals] = useState<SubscriptionRenewal[]>([]);
  const [alertCounts, setAlertCounts] = useState({ total: 0, critical: 0, warning: 0 });

  const [loading, setLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [creepLoading, setCreepLoading] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [renewalsLoading, setRenewalsLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Fetch subscriptions list
  const fetchSubscriptions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (status) params.append('status', status);
      if (frequency) params.append('frequency', frequency);

      const queryString = params.toString();
      const url = `/api/analytics/subscriptions${queryString ? `?${queryString}` : ''}`;

      const response = await apiClient.get(url);

      if (!response.ok) {
        throw new Error('Failed to fetch subscriptions');
      }

      const data = response.data as GetSubscriptionsResponse;
      setSubscriptions(data.subscriptions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error fetching subscriptions:', err);
    } finally {
      setLoading(false);
    }
  }, [status, frequency]);

  // Fetch cost summary
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);

    try {
      const response = await apiClient.get('/api/analytics/subscriptions/summary');

      if (!response.ok) {
        throw new Error('Failed to fetch subscription summary');
      }

      const data = response.data as GetSubscriptionSummaryResponse;
      setSummary(data);
    } catch (err) {
      console.error('Error fetching subscription summary:', err);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // Fetch subscription creep (historical cost growth)
  const fetchCreep = useCallback(async (months: number = 12) => {
    setCreepLoading(true);

    try {
      const response = await apiClient.get(`/api/analytics/subscriptions/creep?months=${months}`);

      if (!response.ok) {
        throw new Error('Failed to fetch subscription creep');
      }

      const data = response.data as GetSubscriptionCreepResponse;
      setCreep(data);
    } catch (err) {
      console.error('Error fetching subscription creep:', err);
    } finally {
      setCreepLoading(false);
    }
  }, []);

  // Fetch alerts
  const fetchAlerts = useCallback(async (includeDismissed: boolean = false) => {
    setAlertsLoading(true);

    try {
      const response = await apiClient.get(
        `/api/analytics/subscriptions/alerts?include_dismissed=${includeDismissed}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch subscription alerts');
      }

      const data = response.data as GetSubscriptionAlertsResponse;
      setAlerts(data.alerts);
      setAlertCounts({
        total: data.total_count,
        critical: data.critical_count,
        warning: data.warning_count,
      });
    } catch (err) {
      console.error('Error fetching subscription alerts:', err);
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  // Fetch upcoming renewals
  const fetchRenewals = useCallback(async (days: number = 30) => {
    setRenewalsLoading(true);

    try {
      const response = await apiClient.get(`/api/analytics/subscriptions/renewals?days=${days}`);

      if (!response.ok) {
        throw new Error('Failed to fetch upcoming renewals');
      }

      const data = response.data as GetUpcomingRenewalsResponse;
      setRenewals(data.renewals);
    } catch (err) {
      console.error('Error fetching upcoming renewals:', err);
    } finally {
      setRenewalsLoading(false);
    }
  }, []);

  // Update a subscription
  const updateSubscription = useCallback(
    async (id: number, updates: UpdateSubscriptionRequest) => {
      setError(null);

      try {
        const response = await apiClient.put(`/api/analytics/subscriptions/${id}`, updates);

        if (!response.ok) {
          throw new Error('Failed to update subscription');
        }

        // Update local state
        setSubscriptions((prev) =>
          prev.map((sub) =>
            sub.id === id
              ? {
                  ...sub,
                  ...updates,
                  user_frequency: updates.user_frequency ?? sub.user_frequency,
                  user_amount: updates.user_amount ?? sub.user_amount,
                }
              : sub
          )
        );

        return response.data as MutationResponse;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
        console.error('Error updating subscription:', err);
        throw err;
      }
    },
    []
  );

  // Add a manual subscription
  const addSubscription = useCallback(async (subscription: AddSubscriptionRequest) => {
    setError(null);

    try {
      const response = await apiClient.post('/api/analytics/subscriptions', subscription);

      if (!response.ok) {
        throw new Error('Failed to add subscription');
      }

      // Refresh subscriptions list
      await fetchSubscriptions();

      return response.data as MutationResponse;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error adding subscription:', err);
      throw err;
    }
  }, [fetchSubscriptions]);

  // Delete a subscription
  const deleteSubscription = useCallback(async (id: number) => {
    setError(null);

    try {
      const response = await apiClient.delete(`/api/analytics/subscriptions/${id}`);

      if (!response.ok) {
        throw new Error('Failed to delete subscription');
      }

      // Remove from local state
      setSubscriptions((prev) => prev.filter((sub) => sub.id !== id));

      return response.data as MutationResponse;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error deleting subscription:', err);
      throw err;
    }
  }, []);

  // Dismiss an alert
  const dismissAlert = useCallback(async (alertId: number) => {
    setError(null);

    try {
      const response = await apiClient.post(
        `/api/analytics/subscriptions/alerts/${alertId}/dismiss`
      );

      if (!response.ok) {
        throw new Error('Failed to dismiss alert');
      }

      // Remove from local state
      setAlerts((prev) => prev.filter((alert) => alert.id !== alertId));
      setAlertCounts((prev) => ({
        ...prev,
        total: Math.max(0, prev.total - 1),
      }));

      return response.data as MutationResponse;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error dismissing alert:', err);
      throw err;
    }
  }, []);

  // Refresh subscription detection
  const refreshDetection = useCallback(async () => {
    setDetecting(true);
    setError(null);

    try {
      const response = await apiClient.post('/api/analytics/subscriptions/detect');

      if (!response.ok) {
        throw new Error('Failed to refresh detection');
      }

      // Refresh all data
      await Promise.all([fetchSubscriptions(), fetchSummary(), fetchAlerts()]);

      return response.data as MutationResponse;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error refreshing detection:', err);
      throw err;
    } finally {
      setDetecting(false);
    }
  }, [fetchSubscriptions, fetchSummary, fetchAlerts]);

  // Fetch all data
  const fetchAll = useCallback(async () => {
    await Promise.all([
      fetchSubscriptions(),
      fetchSummary(),
      fetchCreep(),
      fetchAlerts(),
      fetchRenewals(),
    ]);
  }, [fetchSubscriptions, fetchSummary, fetchCreep, fetchAlerts, fetchRenewals]);

  // Auto-load on mount
  useEffect(() => {
    if (autoLoad) {
      fetchAll();
    }
  }, [autoLoad, fetchAll]);

  // Categorize subscriptions by status
  const activeSubscriptions = subscriptions.filter((s) => s.status === 'active');
  const pausedSubscriptions = subscriptions.filter((s) => s.status === 'paused');
  const cancelledSubscriptions = subscriptions.filter((s) => s.status === 'cancelled');

  return {
    // Data
    subscriptions,
    activeSubscriptions,
    pausedSubscriptions,
    cancelledSubscriptions,
    summary,
    creep,
    alerts,
    renewals,
    alertCounts,

    // Loading states
    loading,
    summaryLoading,
    creepLoading,
    alertsLoading,
    renewalsLoading,
    detecting,
    error,

    // Fetch functions
    fetchSubscriptions,
    fetchSummary,
    fetchCreep,
    fetchAlerts,
    fetchRenewals,
    fetchAll,

    // Mutation functions
    updateSubscription,
    addSubscription,
    deleteSubscription,
    dismissAlert,
    refreshDetection,
  };
}
