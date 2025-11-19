import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBreakdownData } from '../useBreakdownData';

const mockGet = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

describe('useBreakdownData cache', () => {
  const START = new Date('2025-05-01T00:00:00Z');
  const END = new Date('2025-05-31T00:00:00Z');

  beforeEach(() => {
    mockGet.mockReset();
  });

  it('returns cached results when repeated within TTL', async () => {
    mockGet.mockResolvedValueOnce({ ok: true, data: { summary: { total: 100 } } });

    const { result } = renderHook(() =>
      useBreakdownData({ startDate: START, endDate: END, initialTypes: ['expense'] }),
    );

    await waitFor(() => {
      expect(result.current.breakdownData.expense?.summary.total).toBe(100);
    });

    await act(async () => {
      await result.current.refreshBreakdowns(['expense']);
    });

    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('invalidates cache across different ranges', async () => {
    mockGet
      .mockResolvedValueOnce({ ok: true, data: { summary: { total: 10 } } })
      .mockResolvedValueOnce({ ok: true, data: { summary: { total: 20 } } });

    const { result, rerender } = renderHook(
      ({ startDate, endDate }) => useBreakdownData({ startDate, endDate, initialTypes: ['expense'] }),
      { initialProps: { startDate: START, endDate: END } },
    );

    await waitFor(() => {
      expect(result.current.breakdownData.expense?.summary.total).toBe(10);
    });

    const nextStart = new Date('2025-06-01T00:00:00Z');
    const nextEnd = new Date('2025-06-30T00:00:00Z');

    rerender({ startDate: nextStart, endDate: nextEnd });

    await act(async () => {
      await result.current.refreshBreakdowns(['expense']);
    });

    await waitFor(() => {
      expect(result.current.breakdownData.expense?.summary.total).toBe(20);
    });

    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
