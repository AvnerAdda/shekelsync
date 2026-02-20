import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DONATION_STATUS_CHANGED_EVENT } from '../constants';
import { useDonationStatus } from '../hooks/useDonationStatus';

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

const baseStatus = {
  hasDonated: false,
  tier: 'none',
  supportStatus: 'none',
  totalAmountUsd: 0,
  currentMonthKey: '2026-02',
  reminderShownThisMonth: false,
  shouldShowMonthlyReminder: true,
  plans: [],
};

function okResponse(data: unknown) {
  return {
    ok: true,
    data: {
      success: true,
      data,
    },
  };
}

describe('useDonationStatus', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('loads and normalizes status payload on mount', async () => {
    mockGet.mockResolvedValueOnce(
      okResponse({
        ...baseStatus,
        supportStatus: 'clicked',
        shouldShowMonthlyReminder: undefined,
      }),
    );

    const { result } = renderHook(() => useDonationStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    expect(mockGet).toHaveBeenCalledWith('/api/donations/status');
    expect(result.current.status?.supportStatus).toBe('pending');
    expect(result.current.supportStatus).toBe('pending');
    expect(result.current.hasDonated).toBe(false);
    expect(result.current.tier).toBe('none');
    expect(result.current.status?.shouldShowMonthlyReminder).toBe(false);
  });

  it('stores a safe fallback when the initial refresh fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() => useDonationStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe('network down');
    });

    expect(result.current.status?.reminderShownThisMonth).toBe(true);
    expect(result.current.status?.shouldShowMonthlyReminder).toBe(false);
    expect(result.current.hasDonated).toBe(false);
    expect(result.current.supportStatus).toBe('none');
  });

  it('marks reminder as shown using current month key and emits status-changed event', async () => {
    const updatedStatus = {
      ...baseStatus,
      reminderShownThisMonth: true,
      shouldShowMonthlyReminder: false,
    };

    mockGet.mockResolvedValueOnce(okResponse(baseStatus));
    mockGet.mockResolvedValueOnce(okResponse(updatedStatus));
    mockPost.mockResolvedValueOnce(okResponse(updatedStatus));
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const { result } = renderHook(() => useDonationStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.status?.currentMonthKey).toBe('2026-02');
    });

    await act(async () => {
      await result.current.markReminderShown();
    });

    expect(mockPost).toHaveBeenCalledWith('/api/donations/reminder-shown', { monthKey: '2026-02' });
    await waitFor(() => {
      expect(result.current.status?.reminderShownThisMonth).toBe(true);
      expect(result.current.status?.shouldShowMonthlyReminder).toBe(false);
    });

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: DONATION_STATUS_CHANGED_EVENT }));
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
    dispatchSpy.mockRestore();
  });

  it('refreshes when the global donation status event is fired', async () => {
    mockGet.mockResolvedValueOnce(
      okResponse({
        ...baseStatus,
        reminderShownThisMonth: true,
        shouldShowMonthlyReminder: false,
      }),
    );
    mockGet.mockResolvedValueOnce(
      okResponse({
        ...baseStatus,
        hasDonated: true,
        tier: 'one_time',
        supportStatus: 'verified',
        totalAmountUsd: 25,
        reminderShownThisMonth: true,
        shouldShowMonthlyReminder: false,
        aiAgentAccessLevel: 'standard',
        canAccessAiAgent: true,
      }),
    );

    const { result } = renderHook(() => useDonationStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.supportStatus).toBe('none');
    });

    act(() => {
      window.dispatchEvent(new CustomEvent(DONATION_STATUS_CHANGED_EVENT));
    });

    await waitFor(() => {
      expect(result.current.supportStatus).toBe('verified');
      expect(result.current.hasDonated).toBe(true);
      expect(result.current.tier).toBe('one_time');
    });

    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
