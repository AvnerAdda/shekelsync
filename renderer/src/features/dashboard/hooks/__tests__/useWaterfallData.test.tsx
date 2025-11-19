import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWaterfallData } from '../useWaterfallData';

const mockGet = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

describe('useWaterfallData', () => {
  const START = new Date('2025-01-01T00:00:00Z');
  const END = new Date('2025-01-31T00:00:00Z');
  const url = `/api/analytics/waterfall-flow?startDate=${START.toISOString()}&endDate=${END.toISOString()}`;

  beforeEach(() => {
    mockGet.mockReset();
  });

  it('fetches waterfall data for the provided range', async () => {
    const payload = {
      summary: { totalIncome: 100, totalExpenses: 50, netInvestments: 10, netBalance: 50, totalTransactions: 3 },
      waterfallData: [],
      breakdown: { income: [], expenses: [], investments: [] },
    };
    mockGet.mockResolvedValueOnce({ ok: true, data: payload });

    const { result } = renderHook(() => useWaterfallData({ startDate: START, endDate: END }));

    await waitFor(() => {
      expect(result.current.data).toEqual(payload);
      expect(result.current.loading).toBe(false);
    });

    expect(mockGet).toHaveBeenCalledWith(url);
  });

  it('tracks errors when request fails', async () => {
    mockGet.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() => useWaterfallData({ startDate: START, endDate: END }));

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
      expect(result.current.data).toBeNull();
    });
  });
});
