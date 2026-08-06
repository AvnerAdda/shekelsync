import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScrapeProgress } from '@app/hooks/useScrapeProgress';

describe('useScrapeProgress', () => {
  let progressHandler: ((event: Record<string, unknown>) => void) | undefined;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    progressHandler = undefined;
    unsubscribe.mockReset();
    (window as any).electronAPI = {
      events: {
        onScrapeProgress: vi.fn((handler) => {
          progressHandler = handler;
          return unsubscribe;
        }),
      },
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('preserves partial as a terminal completion status', () => {
    const { result, unmount } = renderHook(() => useScrapeProgress());

    act(() => {
      progressHandler?.({ status: 'starting' });
    });
    expect(result.current.isRunning).toBe(true);

    act(() => {
      progressHandler?.({ status: 'partial', vendor: 'hapoalim', progress: 100 });
    });

    expect(result.current.latestEvent).toMatchObject({
      status: 'partial',
      vendor: 'hapoalim',
      progress: 100,
    });
    expect(result.current.isRunning).toBe(false);
    expect(result.current.lastCompletedAt).toBeInstanceOf(Date);

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('treats blocked as terminal without recording a completion', () => {
    const { result } = renderHook(() => useScrapeProgress());

    act(() => {
      progressHandler?.({ status: 'in_progress', progress: 50 });
    });
    expect(result.current.isRunning).toBe(true);

    act(() => {
      progressHandler?.({ status: 'blocked', error: 'Credentials unavailable' });
    });

    expect(result.current.latestEvent).toMatchObject({
      status: 'blocked',
      error: 'Credentials unavailable',
    });
    expect(result.current.isRunning).toBe(false);
    expect(result.current.lastCompletedAt).toBeNull();
  });
});
