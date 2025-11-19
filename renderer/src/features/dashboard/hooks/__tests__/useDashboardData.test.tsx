import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardData } from '../useDashboardData';

const mockGet = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

const START = new Date('2024-03-01T00:00:00Z');
const END = new Date('2024-03-31T00:00:00Z');

describe('useDashboardData', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('fetches dashboard data and builds cumulative series', async () => {
    mockGet.mockResolvedValueOnce({
      ok: true,
      data: {
        dateRange: { start: START, end: END },
        summary: {
          totalIncome: 500,
          totalExpenses: 300,
          netBalance: 200,
          investmentOutflow: 50,
          investmentInflow: 10,
          netInvestments: 40,
          totalAccounts: 3,
        },
        history: [
          { date: '2024-03-01', income: 100, expenses: 40 },
          { date: '2024-03-02', income: 50, expenses: 60 },
        ],
        breakdowns: {
          byCategory: [],
          byVendor: [],
          byMonth: [],
        },
      },
    });

    const { result } = renderHook(() =>
      useDashboardData({ startDate: START, endDate: END, aggregation: 'daily' }),
    );

    await waitFor(() => {
      expect(result.current.data?.summary.totalIncome).toBe(500);
    });

    expect(result.current.cumulativeData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: '2024-03-01', cumulative: 60, netFlow: 60 }),
        expect.objectContaining({ date: '2024-03-02', cumulative: 50, netFlow: -10 }),
      ]),
    );

    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('sets error state when request fails', async () => {
    mockGet.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() =>
      useDashboardData({ startDate: START, endDate: END, aggregation: 'daily' }),
    );

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
      expect(result.current.data).toBeNull();
      expect(result.current.cumulativeData).toEqual([]);
    });
  });
});
