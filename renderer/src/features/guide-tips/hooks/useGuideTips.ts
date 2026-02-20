import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';

export interface GuideTip {
  id: string;
  completed: boolean;
  data: Record<string, unknown>;
}

export interface GuideTipsData {
  tips: GuideTip[];
  manuallyDone: string[];
}

export interface UseGuideTipsResult {
  tips: GuideTip[];
  pendingCount: number;
  completedCount: number;
  allDone: boolean;
  loading: boolean;
  error: string | null;
  dismissTip: (tipId: string) => Promise<void>;
  refetch: () => Promise<void>;
}

const REFRESH_INTERVAL = 60_000; // 60 seconds

export function useGuideTips(): UseGuideTipsResult {
  const [tips, setTips] = useState<GuideTip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get('/api/guide-tips/status');
      const data = response.data as { success?: boolean; data?: GuideTipsData };

      if (response.ok && data?.success && data.data) {
        setTips(data.data.tips);
      }
    } catch (err) {
      console.error('[GuideTips] Error fetching status:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const dismissTip = useCallback(async (tipId: string) => {
    try {
      const response = await apiClient.post('/api/guide-tips/dismiss', { tipId });

      if (response.ok) {
        // Optimistically update
        setTips(prev =>
          prev.map(t => (t.id === tipId ? { ...t, completed: true } : t)),
        );
        // Refetch to get accurate state
        await fetchStatus();
      }
    } catch (err) {
      console.error('[GuideTips] Error dismissing tip:', err);
    }
  }, [fetchStatus]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const pendingCount = tips.filter(t => !t.completed).length;
  const completedCount = tips.filter(t => t.completed).length;
  const allDone = tips.length > 0 && pendingCount === 0;

  return {
    tips,
    pendingCount,
    completedCount,
    allDone,
    loading,
    error,
    dismissTip,
    refetch: fetchStatus,
  };
}
