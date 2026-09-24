import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves cash-flow history and fills missing dates', async () => {
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
          { date: '2024-03-01', income: 100, operatingIncome: 80, expenses: 40, investments: 150, operatingExpenses: 30, pairedCardRepayments: 25 },
          { date: '2024-03-02', income: 50, expenses: 60 },
          { date: '2024-03-04', income: 0, expenses: 0, investments: -25 },
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

    expect(result.current.data?.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: '2024-03-01', income: 100, operatingIncome: 80, expenses: 40, investments: 150, operatingExpenses: 30, pairedCardRepayments: 25 }),
        expect.objectContaining({ date: '2024-03-02', income: 50, expenses: 60 }),
        expect.objectContaining({ date: '2024-03-03', income: 0, expenses: 0, investments: 0 }),
        expect.objectContaining({ date: '2024-03-04', income: 0, expenses: 0, investments: -25 }),
        expect.objectContaining({ date: '2024-03-05', income: null, expenses: null, investments: null }),
      ]),
    );
    expect(result.current.data?.history).toHaveLength(31);

    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('fetches only the requested period on current-month loads and refreshes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z'));
    mockGet.mockResolvedValue({
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
          { date: '2024-03-01', income: 100, operatingIncome: 100, expenses: 40, operatingExpenses: 5 },
          { date: '2024-03-02', income: 50, operatingIncome: 50, expenses: 60, operatingExpenses: 10 },
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

    expect(mockGet).toHaveBeenCalledTimes(1);

    await act(async () => { result.current.refresh(); });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(2);
    const requestedUrl = `/api/analytics/dashboard?startDate=${START.toISOString()}&endDate=${END.toISOString()}&aggregation=daily&includeBreakdowns=0`;
    expect(mockGet.mock.calls.map(([url]) => url)).toEqual([requestedUrl, requestedUrl]);
  });

  it('sets error state when request fails', async () => {
    mockGet.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() =>
      useDashboardData({ startDate: START, endDate: END, aggregation: 'daily' }),
    );

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
      expect(result.current.data).toBeNull();
    });
  });
});
