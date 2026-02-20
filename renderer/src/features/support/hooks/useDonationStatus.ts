import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { DONATION_STATUS_CHANGED_EVENT } from '../constants';
import {
  createDefaultDonationStatus,
  type AddDonationEventPayload,
  type CreateSupportIntentPayload,
  type DonationStatus,
  type DonationTier,
  type MarkReminderShownPayload,
  type SupportVerificationStatus,
  getCurrentMonthKey,
  getDonationTier,
  isDonationTier,
} from '../types';

interface ApiPayload<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

interface UseDonationStatusReturn {
  status: DonationStatus | null;
  loading: boolean;
  error: string | null;
  hasDonated: boolean;
  tier: DonationTier;
  supportStatus: SupportVerificationStatus;
  refresh: () => Promise<DonationStatus>;
  createSupportIntent: (payload?: CreateSupportIntentPayload) => Promise<DonationStatus>;
  addDonationEvent: (payload: AddDonationEventPayload) => Promise<DonationStatus>;
  markReminderShown: (payload?: MarkReminderShownPayload) => Promise<DonationStatus>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeSupportStatus(value: unknown): SupportVerificationStatus {
  if (typeof value !== 'string') {
    return 'none';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'verified' || normalized === 'pending' || normalized === 'rejected' || normalized === 'none') {
    return normalized;
  }
  if (normalized === 'active') {
    return 'verified';
  }
  if (normalized === 'clicked') {
    return 'pending';
  }

  return 'none';
}

function normalizeAiAccessLevel(value: unknown, hasDonated: boolean): DonationStatus['aiAgentAccessLevel'] {
  if (value === 'standard' || value === 'extended' || value === 'unlimited') {
    return 'standard';
  }
  if (value === 'none') {
    return 'none';
  }
  return hasDonated ? 'standard' : 'none';
}

function normalizeDonationStatus(raw: unknown): DonationStatus {
  const defaults = createDefaultDonationStatus();

  if (!isRecord(raw)) {
    return defaults;
  }

  if ('data' in raw && isRecord(raw.data)) {
    return normalizeDonationStatus(raw.data);
  }

  const supportStatus = normalizeSupportStatus(raw.supportStatus);

  const totalAmountRaw = Number(raw.totalAmountUsd ?? 0);
  const totalAmountUsd = Number.isFinite(totalAmountRaw)
    ? Math.round(totalAmountRaw * 100) / 100
    : 0;

  const tierCandidate = typeof raw.tier === 'string' ? raw.tier : '';
  const tier = isDonationTier(tierCandidate)
    ? tierCandidate
    : getDonationTier(totalAmountUsd);

  const hasDonated = typeof raw.hasDonated === 'boolean'
    ? raw.hasDonated
    : supportStatus === 'verified' || totalAmountUsd > 0;

  const currentMonthKey = typeof raw.currentMonthKey === 'string' && raw.currentMonthKey.trim()
    ? raw.currentMonthKey
    : getCurrentMonthKey();

  const reminderShownThisMonth = typeof raw.reminderShownThisMonth === 'boolean'
    ? raw.reminderShownThisMonth
    : false;

  const hasPendingVerification = typeof raw.hasPendingVerification === 'boolean'
    ? raw.hasPendingVerification
    : supportStatus === 'pending';

  return {
    hasDonated,
    tier,
    supportStatus,
    totalAmountUsd,
    currentPlanKey: hasDonated ? 'one_time' : null,
    pendingPlanKey: hasPendingVerification ? 'one_time' : null,
    hasPendingVerification,
    lastVerifiedAt: typeof raw.lastVerifiedAt === 'string' && raw.lastVerifiedAt.trim()
      ? raw.lastVerifiedAt.trim()
      : null,
    billingCycle: raw.billingCycle === 'monthly' || raw.billingCycle === 'lifetime' || raw.billingCycle === 'one_time'
      ? raw.billingCycle
      : null,
    canAccessAiAgent: typeof raw.canAccessAiAgent === 'boolean'
      ? raw.canAccessAiAgent
      : hasDonated,
    aiAgentAccessLevel: normalizeAiAccessLevel(raw.aiAgentAccessLevel, hasDonated),
    plans: [],
    currentMonthKey,
    reminderShownThisMonth,
    shouldShowMonthlyReminder: typeof raw.shouldShowMonthlyReminder === 'boolean'
      ? raw.shouldShowMonthlyReminder
      : !hasDonated && !hasPendingVerification && !reminderShownThisMonth,
    donationUrl: typeof raw.donationUrl === 'string' && raw.donationUrl.trim()
      ? raw.donationUrl.trim()
      : defaults.donationUrl,
  };
}

function extractError(data: unknown): string | null {
  if (!isRecord(data)) return null;
  if (typeof data.error === 'string' && data.error.trim()) {
    return data.error;
  }
  return null;
}

function dispatchDonationStatusChanged(status: DonationStatus): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent(DONATION_STATUS_CHANGED_EVENT, {
      detail: status,
    }),
  );
}

export function useDonationStatus(): UseDonationStatusReturn {
  const [status, setStatus] = useState<DonationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiClient.get<ApiPayload<DonationStatus>>('/api/donations/status');
      if (!response.ok) {
        throw new Error(extractError(response.data) || 'Failed to fetch support status');
      }

      const normalized = normalizeDonationStatus(response.data);
      setStatus(normalized);
      return normalized;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch support status';
      setError(message);
      const fallback = {
        ...createDefaultDonationStatus(),
        reminderShownThisMonth: true,
        shouldShowMonthlyReminder: false,
      };
      setStatus(fallback);
      return fallback;
    } finally {
      setLoading(false);
    }
  }, []);

  const createSupportIntent = useCallback(async (payload: CreateSupportIntentPayload = {}) => {
    const response = await apiClient.post<ApiPayload<DonationStatus>, CreateSupportIntentPayload>(
      '/api/donations/intent',
      payload,
    );

    if (!response.ok) {
      throw new Error(extractError(response.data) || 'Failed to record support intent');
    }

    const normalized = normalizeDonationStatus(response.data);
    setStatus(normalized);
    setError(null);
    dispatchDonationStatusChanged(normalized);
    return normalized;
  }, []);

  const addDonationEvent = useCallback(async (payload: AddDonationEventPayload) => {
    const response = await apiClient.post<ApiPayload<DonationStatus>, AddDonationEventPayload>(
      '/api/donations',
      payload,
    );

    if (!response.ok) {
      throw new Error(extractError(response.data) || 'Failed to save donation');
    }

    const normalized = normalizeDonationStatus(response.data);
    setStatus(normalized);
    setError(null);
    dispatchDonationStatusChanged(normalized);
    return normalized;
  }, []);

  const markReminderShown = useCallback(async (payload: MarkReminderShownPayload = {}) => {
    const monthKey = payload.monthKey || status?.currentMonthKey || getCurrentMonthKey();
    const response = await apiClient.post<ApiPayload<DonationStatus>, MarkReminderShownPayload>(
      '/api/donations/reminder-shown',
      { monthKey },
    );

    if (!response.ok) {
      throw new Error(extractError(response.data) || 'Failed to update reminder status');
    }

    const normalized = normalizeDonationStatus(response.data);
    setStatus(normalized);
    setError(null);
    dispatchDonationStatusChanged(normalized);
    return normalized;
  }, [status?.currentMonthKey]);

  useEffect(() => {
    refresh().catch(() => {
      // refresh already stores fallback status/error
    });
  }, [refresh]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return () => {};
    }

    const onStatusChanged = () => {
      refresh().catch(() => {
        // refresh already stores fallback status/error
      });
    };

    window.addEventListener(DONATION_STATUS_CHANGED_EVENT, onStatusChanged as EventListener);
    return () => {
      window.removeEventListener(DONATION_STATUS_CHANGED_EVENT, onStatusChanged as EventListener);
    };
  }, [refresh]);

  const derived = useMemo(() => {
    return {
      hasDonated: status?.hasDonated ?? false,
      tier: status?.tier ?? 'none',
      supportStatus: status?.supportStatus ?? 'none',
    };
  }, [status?.hasDonated, status?.tier, status?.supportStatus]);

  return {
    status,
    loading,
    error,
    hasDonated: derived.hasDonated,
    tier: derived.tier,
    supportStatus: derived.supportStatus,
    refresh,
    createSupportIntent,
    addDonationEvent,
    markReminderShown,
  };
}

export type { UseDonationStatusReturn };
export default useDonationStatus;
