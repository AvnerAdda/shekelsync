import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardInsights } from '../useDashboardInsights';

const mockGet = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

describe('useDashboardInsights', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('loads each shared dashboard insight once', async () => {
    mockGet.mockImplementation((endpoint: string) => {
      if (endpoint === '/api/forecast/daily?days=30') {
        return Promise.resolve({ ok: true, data: { dailyForecasts: [], budgetOutlook: [] } });
      }
      if (endpoint === '/api/analytics/personal-intelligence?days=60') {
        return Promise.resolve({
          ok: true,
          data: { overallHealthScore: 72, healthBreakdown: { savingsScore: 80 } },
        });
      }
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    const { result } = renderHook(() => useDashboardInsights());

    await waitFor(() => {
      expect(result.current.forecastLoading).toBe(false);
      expect(result.current.healthLoading).toBe(false);
    });

    expect(result.current.forecastData).toEqual({ dailyForecasts: [], budgetOutlook: [] });
    expect(result.current.healthSnapshot?.overallHealthScore).toBe(72);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenCalledWith('/api/forecast/daily?days=30');
    expect(mockGet).toHaveBeenCalledWith('/api/analytics/personal-intelligence?days=60');
  });

  it('surfaces forecast failures without discarding health data', async () => {
    mockGet.mockImplementation((endpoint: string) => {
      if (endpoint === '/api/forecast/daily?days=30') {
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

    const { result } = renderHook(() => useDashboardInsights());

    await waitFor(() => expect(result.current.forecastLoading).toBe(false));

    expect(result.current.forecastError).toContain('12 seconds');
    expect(result.current.healthSnapshot?.overallHealthScore).toBe(64);
  });
});
