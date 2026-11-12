import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardInsights } from '../useDashboardInsights';

const mockGet = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

const MTD_RANGE = {
  startDate: new Date(2026, 10, 1, 0, 0, 0),
  endDate: new Date(2026, 10, 8, 23, 59, 59, 999),
};
const MTD_HEALTH_ENDPOINT = '/api/analytics/personal-intelligence?startDate=2026-11-01&endDate=2026-11-08';

describe('useDashboardInsights', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('loads each shared dashboard insight once', async () => {
    mockGet.mockImplementation((endpoint: string) => {
      if (endpoint === '/api/forecast/daily?days=90&fromLastData=1') {
        return Promise.resolve({ ok: true, data: { dailyForecasts: [], budgetOutlook: [] } });
      }
      if (endpoint === MTD_HEALTH_ENDPOINT) {
        return Promise.resolve({
          ok: true,
          data: { overallHealthScore: 72, healthBreakdown: { savingsScore: 80 } },
        });
      }
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    const { result } = renderHook(() => useDashboardInsights(MTD_RANGE));

    await waitFor(() => {
      expect(result.current.forecastLoading).toBe(false);
      expect(result.current.healthLoading).toBe(false);
    });

    expect(result.current.forecastData).toEqual({ dailyForecasts: [], budgetOutlook: [] });
    expect(result.current.healthSnapshot?.overallHealthScore).toBe(72);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenCalledWith('/api/forecast/daily?days=90&fromLastData=1');
    expect(mockGet).toHaveBeenCalledWith(MTD_HEALTH_ENDPOINT);
  });

  it('bypasses the forecast cache when refreshing after a transaction mutation', async () => {
    mockGet.mockResolvedValue({ ok: true, data: { dailyForecasts: [] } });
    const { result } = renderHook(() => useDashboardInsights(MTD_RANGE));
    await waitFor(() => expect(result.current.forecastLoading).toBe(false));
    act(() => result.current.refresh());
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/forecast/daily?days=90&fromLastData=1&noCache=1'));
    await waitFor(() => expect(result.current.forecastLoading).toBe(false));
  });

  it('surfaces forecast failures without discarding health data', async () => {
    mockGet.mockImplementation((endpoint: string) => {
      if (endpoint === '/api/forecast/daily?days=90&fromLastData=1') {
        return Promise.resolve({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          data: { retryAfter: 12 },
        });
      }
      return Promise.resolve({
        ok: true,
        data: { overallHealthScore: 64, healthBreakdown: {} },
      });
    });

    const { result } = renderHook(() => useDashboardInsights(MTD_RANGE));

    await waitFor(() => expect(result.current.forecastLoading).toBe(false));

    expect(result.current.forecastError).toContain('12 seconds');
    expect(result.current.healthSnapshot?.overallHealthScore).toBe(64);
  });

  it('scores the period selected on Home and refetches only health when it changes', async () => {
    mockGet.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/api/forecast/daily')) {
        return Promise.resolve({ ok: true, data: { dailyForecasts: [] } });
      }
      const score = endpoint.includes('startDate=2026-10-10') ? 55 : 81;
      return Promise.resolve({ ok: true, data: { overallHealthScore: score, healthBreakdown: {} } });
    });

    const { result, rerender } = renderHook(
      ({ range }) => useDashboardInsights(range),
      { initialProps: { range: MTD_RANGE } },
    );
    await waitFor(() => expect(result.current.healthSnapshot?.overallHealthScore).toBe(81));

    // Last 30 days, inclusive of today: Oct 10 – Nov 8.
    rerender({
      range: { startDate: new Date(2026, 9, 10, 0, 0, 0), endDate: new Date(2026, 10, 8, 23, 59, 59, 999) },
    });
    await waitFor(() => expect(result.current.healthSnapshot?.overallHealthScore).toBe(55));

    expect(mockGet).toHaveBeenCalledWith(
      '/api/analytics/personal-intelligence?startDate=2026-10-10&endDate=2026-11-08',
    );
    const forecastCalls = mockGet.mock.calls.filter(([endpoint]) => String(endpoint).startsWith('/api/forecast'));
    expect(forecastCalls).toHaveLength(1);
  });

  it('does not keep the previous period score when the new period fails to load', async () => {
    mockGet.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/api/forecast/daily')) {
        return Promise.resolve({ ok: true, data: { dailyForecasts: [] } });
      }
      if (endpoint === MTD_HEALTH_ENDPOINT) {
        return Promise.resolve({ ok: true, data: { overallHealthScore: 81, healthBreakdown: {} } });
      }
      return Promise.resolve({ ok: false, status: 500, data: {} });
    });

    const { result, rerender } = renderHook(
      ({ range }) => useDashboardInsights(range),
      { initialProps: { range: MTD_RANGE } },
    );
    await waitFor(() => expect(result.current.healthSnapshot?.overallHealthScore).toBe(81));

    rerender({ range: { startDate: new Date(2026, 9, 1), endDate: new Date(2026, 9, 31, 23, 59, 59) } });
    await waitFor(() => expect(result.current.healthLoading).toBe(false));
    await waitFor(() => expect(result.current.healthSnapshot).toBeNull());
  });
});
