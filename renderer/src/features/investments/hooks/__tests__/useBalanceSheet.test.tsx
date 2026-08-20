import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestmentBalanceSheetResponse } from '@renderer/types/investments';
import { useInvestmentBalanceSheet } from '../useBalanceSheet';

const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mockGet,
  },
}));

function makeBalanceSheet(total: number): InvestmentBalanceSheetResponse {
  const emptyBucket = {
    totalValue: 0,
    accountsCount: 0,
    accountsWithValue: 0,
    missingValueCount: 0,
    newestUpdateDate: null,
  };

  return {
    generatedAt: '2026-08-12T10:00:00.000Z',
    assets: {
      total,
      newestUpdateDate: '2026-08-12',
      buckets: {
        cash: { ...emptyBucket, totalValue: total, accountsCount: 1, accountsWithValue: 1 },
        liquid: { ...emptyBucket },
        illiquid: { ...emptyBucket },
        restricted: { ...emptyBucket },
        stability: { ...emptyBucket },
        other: { ...emptyBucket },
      },
      currencies: { distinct: ['ILS'], hasMultiple: false },
    },
    liabilities: {
      pendingCreditCardDebt: 0,
      pendingCreditCardDebtStatus: 'ok',
      lastCreditCardRepaymentDate: '2026-08-01',
      creditCardVendorCount: 1,
    },
    netWorth: total,
    netWorthStatus: 'ok',
    missingValuationsCount: 0,
  };
}

describe('useInvestmentBalanceSheet', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('keeps the last successful snapshot when a refresh fails', async () => {
    const snapshot = makeBalanceSheet(1_000);
    mockGet.mockResolvedValueOnce({ ok: true, data: snapshot });

    const { result } = renderHook(() => useInvestmentBalanceSheet());

    await waitFor(() => {
      expect(result.current.data).toEqual(snapshot);
      expect(result.current.loading).toBe(false);
    });

    mockGet.mockResolvedValueOnce({ ok: false, statusText: 'Offline' });
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.data).toEqual(snapshot);
    expect(result.current.error?.message).toBe('Offline');
    expect(result.current.loading).toBe(false);
  });

  it('ignores an older response that finishes after a newer refresh', async () => {
    let resolveFirstRequest: ((value: unknown) => void) | undefined;
    const firstRequest = new Promise((resolve) => {
      resolveFirstRequest = resolve;
    });
    const newerSnapshot = makeBalanceSheet(2_000);

    mockGet
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce({ ok: true, data: newerSnapshot });

    const { result } = renderHook(() => useInvestmentBalanceSheet());
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.data).toEqual(newerSnapshot);

    await act(async () => {
      resolveFirstRequest?.({ ok: true, data: makeBalanceSheet(500) });
      await firstRequest;
    });

    expect(result.current.data).toEqual(newerSnapshot);
  });
});
