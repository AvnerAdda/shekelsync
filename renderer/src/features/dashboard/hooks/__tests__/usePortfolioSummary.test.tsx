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
          illiquid: { totalValue: 200 },
          restricted: { totalValue: 400 },
        },
        breakdown: [
          { category: 'cash', name: 'Cash', type: 'bank_balance', totalValue: 100 },
          { category: 'liquid', name: 'Brokerage', totalValue: 300 },
          { category: 'illiquid', name: 'Real Estate', type: 'real_estate', totalValue: 200 },
          { category: 'restricted', name: 'Pension', totalValue: 400 },
        ],
        accounts: [
          {
            id: 1,
            account_name: 'Cash',
            account_type: 'bank_balance',
            investment_category: 'cash',
            currency: 'ILS',
            current_value: 100,
            cost_basis: 100,
          },
          {
            id: 2,
            account_name: 'Brokerage',
            account_type: 'brokerage',
            investment_category: 'liquid',
            currency: 'ILS',
            current_value: 300,
            cost_basis: 250,
          },
          {
            id: 3,
            account_name: 'Real Estate',
            account_type: 'real_estate',
            investment_category: 'illiquid',
            currency: 'ILS',
            current_value: 200,
            cost_basis: 200,
          },
          {
            id: 4,
            account_name: 'Pension',
            account_type: 'pension',
            investment_category: 'restricted',
            currency: 'ILS',
            current_value: 400,
            cost_basis: 350,
          },
        ],
      },
    });

    const { result } = renderHook(() => usePortfolioSummary());

    await waitFor(() => {
      expect(result.current.portfolioValue).toBe(800);
      expect(result.current.liquidPortfolio).toEqual([
        { name: 'Brokerage', value: 300, percentage: 100, category: 'liquid' },
      ]);
      expect(result.current.illiquidPortfolio).toEqual([]);
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
      expect(result.current.illiquidPortfolio).toEqual([]);
      expect(result.current.restrictedPortfolio).toEqual([]);
    });
  });
});
