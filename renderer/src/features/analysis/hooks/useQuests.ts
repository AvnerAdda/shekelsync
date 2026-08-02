import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type {
  SmartAction,
  QuestsResponse,
  GenerateQuestsResponse,
  UserQuestStats,
  AcceptQuestResponse,
  VerifyQuestResponse,
} from '@renderer/types/quests';
import { useLocaleSettings } from '@renderer/i18n/I18nProvider';

interface UseQuestsOptions {
  autoLoad?: boolean;
}

export function useQuests(options: UseQuestsOptions = {}) {
  const { autoLoad = true } = options;
  const { locale } = useLocaleSettings();

  const [quests, setQuests] = useState<SmartAction[]>([]);
  const [stats, setStats] = useState<UserQuestStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchQuests = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get(`/api/analytics/quests/active?locale=${locale || 'he'}`);

      if (!response.ok) {
        throw new Error('Failed to fetch quests');
      }

      const data = response.data as QuestsResponse;
      setQuests(data.quests);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error fetching quests:', err);
    } finally {
      setLoading(false);
    }
  }, [locale]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/analytics/quests/stats');

      if (!response.ok) {
        throw new Error('Failed to fetch quest stats');
      }

      const data = response.data as UserQuestStats;
      setStats(data);
    } catch (err) {
      console.error('Error fetching quest stats:', err);
    }
  }, []);

  const generateQuests = useCallback(async (force: boolean = false) => {
    setGenerating(true);
    setError(null);

    try {
      const response = await apiClient.post('/api/analytics/quests/generate', { force });

      if (!response.ok) {
        throw new Error('Failed to generate quests');
      }

      const data = response.data as GenerateQuestsResponse;

      // Refresh quests after generation
      await fetchQuests();

      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error generating quests:', err);
      throw err;
    } finally {
      setGenerating(false);
    }
  }, [fetchQuests]);

  const acceptQuest = useCallback(async (questId: number) => {
    setError(null);

    try {
      const response = await apiClient.post(`/api/analytics/quests/${questId}/accept`);

      if (!response.ok) {
        throw new Error('Failed to accept quest');
      }

      const data = response.data as AcceptQuestResponse;

      // Update local state
      setQuests(prev =>
        prev.map(quest =>
          quest.id === questId
            ? {
                ...quest,
                user_status: 'accepted' as const,
                accepted_at: new Date().toISOString(),
                deadline: data.deadline,
              }
            : quest
        )
      );

      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error accepting quest:', err);
      throw err;
    }
  }, []);

  const declineQuest = useCallback(async (questId: number) => {
    setError(null);

    try {
      const response = await apiClient.post(`/api/analytics/quests/${questId}/decline`);

      if (!response.ok) {
        throw new Error('Failed to decline quest');
      }

      // Remove from local state
      setQuests(prev => prev.filter(quest => quest.id !== questId));

      // Refresh stats (declined count updated)
      await fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error declining quest:', err);
      throw err;
    }
  }, [fetchStats]);

  const verifyQuest = useCallback(async (questId: number, manualResult?: { success?: boolean; amount?: number }) => {
    setError(null);

    try {
      const response = await apiClient.post(`/api/analytics/quests/${questId}/verify`, {
        result: manualResult,
      });

      if (!response.ok) {
        throw new Error('Failed to verify quest');
      }

      const data = response.data as VerifyQuestResponse;

      // Remove from active quests
      setQuests(prev => prev.filter(quest => quest.id !== questId));

      // Refresh stats (points, streak updated)
      await fetchStats();

      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error verifying quest:', err);
      throw err;
    }
  }, [fetchStats]);

  const checkDeadlines = useCallback(async () => {
    try {
      const response = await apiClient.post('/api/analytics/quests/check-deadlines');

      if (!response.ok) {
        throw new Error('Failed to check deadlines');
      }

      // Refresh both quests and stats
      await Promise.all([fetchQuests(), fetchStats()]);

      return response.data;
    } catch (err) {
      console.error('Error checking deadlines:', err);
      throw err;
    }
  }, [fetchQuests, fetchStats]);

  // Auto-load on mount
  useEffect(() => {
    if (autoLoad) {
      fetchQuests();
      fetchStats();
    }
  }, [autoLoad, fetchQuests, fetchStats]);

  // Categorize quests
  const proposedQuests = quests.filter(q => q.user_status === 'active');
  const acceptedQuests = quests.filter(q => q.user_status === 'accepted');

  return {
    quests,
    proposedQuests,
    acceptedQuests,
    stats,
    loading,
    generating,
    error,
    fetchQuests,
    fetchStats,
    generateQuests,
    acceptQuest,
    declineQuest,
    verifyQuest,
    checkDeadlines,
  };
}
