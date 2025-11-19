import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePortfolioSummary } from '../usePortfolioSummary';

const mockGet = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

describe('usePortfolioSummary', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('populates portfolio metrics from API response', async () => {
    mockGet.mockResolvedValueOnce({
      ok: true,
      data: {
        summary: {
          totalPortfolioValue: 1000,
          liquid: { totalValue: 600 },
          restricted: { totalValue: 400 },
        },
        breakdown: [
          { category: 'liquid', name: 'Brokerage', totalValue: 300 },
          { category: 'restricted', name: 'Pension', totalValue: 400 },
        ],
      },
    });

    const { result } = renderHook(() => usePortfolioSummary());

    await waitFor(() => {
      expect(result.current.portfolioValue).toBe(1000);
      expect(result.current.liquidPortfolio).toEqual([
        { name: 'Brokerage', value: 300, percentage: 50, category: 'liquid' },
      ]);
      expect(result.current.restrictedPortfolio).toEqual([
        { name: 'Pension', value: 400, percentage: 100, category: 'restricted' },
      ]);
    });

    expect(mockGet).toHaveBeenCalledWith('/api/investments/summary');
  });

  it('resets state when request fails', async () => {
    mockGet.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() => usePortfolioSummary());

    await waitFor(() => {
      expect(result.current.portfolioValue).toBe(0);
      expect(result.current.liquidPortfolio).toEqual([]);
      expect(result.current.restrictedPortfolio).toEqual([]);
    });
  });
});
