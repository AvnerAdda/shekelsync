import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';

import { OnboardingProvider, useOnboarding } from '../OnboardingContext';

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <OnboardingProvider>{children}</OnboardingProvider>
);

function buildStatus(firstScrape: boolean, transactionCount = firstScrape ? 12 : 0) {
  return {
    isComplete: false,
    completedSteps: {
      profile: true,
      bankAccount: true,
      creditCard: true,
      firstScrape,
      explored: false,
    },
    stats: {
      accountCount: 2,
      bankAccountCount: 1,
      creditCardCount: 1,
      transactionCount,
      lastScrapeDate: firstScrape ? '2026-03-15T00:00:00.000Z' : null,
      hasProfile: true,
    },
    suggestedAction: firstScrape ? 'explore' : 'scrape',
  };
}

function setVisibilityState(value: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  });
}

describe('OnboardingContext', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockGet.mockReset();
    mockPost.mockReset();
    setVisibilityState('visible');
  });

  afterEach(() => {
    try {
      vi.runOnlyPendingTimers();
    } catch {
      // No-op when the test used real timers.
    }
    vi.useRealTimers();
  });

  it('retries the initial onboarding fetch and resolves status after a transient startup failure', async () => {
    vi.useFakeTimers();

    mockGet
      .mockResolvedValueOnce({ ok: false, data: null })
      .mockResolvedValueOnce({ ok: true, data: buildStatus(true) });

    const { result, unmount } = renderHook(() => useOnboarding(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.status?.completedSteps.firstScrape).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('preserves the last successful status when a later refresh fails', async () => {
    mockGet.mockResolvedValueOnce({ ok: true, data: buildStatus(true) });

    const { result, unmount } = renderHook(() => useOnboarding(), { wrapper });

    await waitFor(() => expect(result.current.status?.completedSteps.firstScrape).toBe(true));

    mockGet.mockResolvedValueOnce({ ok: false, data: null });

    await act(async () => {
      window.dispatchEvent(new Event('dataRefresh'));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.error).toMatch(/failed to fetch onboarding status/i));
    expect(result.current.status?.completedSteps.firstScrape).toBe(true);
    unmount();
  });

  it('refetches onboarding status on dataRefresh events', async () => {
    mockGet
      .mockResolvedValueOnce({ ok: true, data: buildStatus(false) })
      .mockResolvedValueOnce({ ok: true, data: buildStatus(true) });

    const { result, unmount } = renderHook(() => useOnboarding(), { wrapper });

    await waitFor(() => expect(result.current.status?.completedSteps.firstScrape).toBe(false));

    await act(async () => {
      window.dispatchEvent(new Event('dataRefresh'));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.status?.completedSteps.firstScrape).toBe(true));
    expect(mockGet).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('refetches onboarding status when the window becomes visible again', async () => {
    mockGet
      .mockResolvedValueOnce({ ok: true, data: buildStatus(false) })
      .mockResolvedValueOnce({ ok: true, data: buildStatus(true) });

    const { result, unmount } = renderHook(() => useOnboarding(), { wrapper });

    await waitFor(() => expect(result.current.status?.completedSteps.firstScrape).toBe(false));

    setVisibilityState('hidden');
    setVisibilityState('visible');

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.status?.completedSteps.firstScrape).toBe(true));
    expect(mockGet).toHaveBeenCalledTimes(2);
    unmount();
  });
});
