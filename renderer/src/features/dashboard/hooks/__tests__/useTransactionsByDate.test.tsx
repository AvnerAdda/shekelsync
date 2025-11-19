import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useTransactionsByDate } from '../useTransactionsByDate';
import { TransactionDetail } from '@renderer/types/transactions';

const mockGet = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

const sampleTxns: TransactionDetail[] = [
  {
    identifier: 'abc',
    vendor: 'Coffee Shop',
    price: -42,
    description: 'Latte',
    date: '2025-01-05',
    category: 'Food',
    parentCategory: 'Food & Dining',
    categoryType: 'expense',
  },
];

describe('useTransactionsByDate', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('fetches transactions by date and stores results', async () => {
    mockGet.mockResolvedValue({ ok: true, data: { transactions: sampleTxns } });
    const { result } = renderHook(() => useTransactionsByDate());

    await act(async () => {
      await result.current.fetchByDate('2025-01-05');
    });

    await waitFor(() => {
      expect(result.current.transactions).toEqual(sampleTxns);
      expect(result.current.loading).toBe(false);
    });

    expect(mockGet).toHaveBeenCalledWith('/api/analytics/transactions-by-date?date=2025-01-05');
  });

  it('handles api errors gracefully', async () => {
    mockGet.mockResolvedValue({ ok: false, status: 500 });
    const { result } = renderHook(() => useTransactionsByDate());

    await act(async () => {
      await result.current.fetchByDate('2025-01-06');
    });

    await waitFor(() => {
      expect(result.current.transactions).toEqual([]);
      expect(result.current.loading).toBe(false);
    });
  });
});
