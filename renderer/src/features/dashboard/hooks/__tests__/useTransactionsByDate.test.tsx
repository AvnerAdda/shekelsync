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
    category_name: 'Food',
    parent_name: 'Food & Dining',
    categoryType: 'expense',
  },
];

function deferredResponse() {
  let resolve!: (response: { ok: boolean; data?: { transactions: TransactionDetail[] }; status?: number }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Parameters<typeof resolve>[0]>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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

  it('fetches every transaction in the inclusive date range without pagination', async () => {
    const transactions = Array.from({ length: 125 }, (_, index) => ({
      ...sampleTxns[0],
      identifier: `transaction-${index}`,
      date: index === 0 ? '2025-01-01' : '2025-01-31',
    }));
    mockGet.mockResolvedValue({ ok: true, data: { transactions } });
    const { result } = renderHook(() => useTransactionsByDate());

    await act(async () => {
      await result.current.fetchByRange('2025-01-01', '2025-01-31');
    });

    expect(mockGet).toHaveBeenCalledExactlyOnceWith(
      '/api/analytics/transactions-by-date?startDate=2025-01-01&endDate=2025-01-31',
    );
    expect(result.current.transactions).toEqual(transactions);
    expect(result.current.loading).toBe(false);
  });

  it('keeps the newest range when requests finish out of order', async () => {
    const previous = deferredResponse();
    const latest = deferredResponse();
    mockGet.mockReturnValueOnce(previous.promise).mockReturnValueOnce(latest.promise);
    const { result } = renderHook(() => useTransactionsByDate());
    const latestTransactions = [{ ...sampleTxns[0], identifier: 'latest', date: '2025-02-10' }];
    let previousRequest!: Promise<void>;
    let latestRequest!: Promise<void>;

    act(() => {
      previousRequest = result.current.fetchByRange('2025-01-01', '2025-01-31');
      latestRequest = result.current.fetchByRange('2025-02-01', '2025-02-28');
    });

    await act(async () => {
      latest.resolve({ ok: true, data: { transactions: latestTransactions } });
      await latestRequest;
    });
    expect(result.current.transactions).toEqual(latestTransactions);

    await act(async () => {
      previous.resolve({ ok: true, data: { transactions: sampleTxns } });
      await previousRequest;
    });
    expect(result.current.transactions).toEqual(latestTransactions);
    expect(result.current.loading).toBe(false);
  });

  it('keeps loading the newest selection when an older request fails', async () => {
    const previous = deferredResponse();
    const latest = deferredResponse();
    mockGet.mockReturnValueOnce(previous.promise).mockReturnValueOnce(latest.promise);
    const { result } = renderHook(() => useTransactionsByDate());
    let previousRequest!: Promise<void>;
    let latestRequest!: Promise<void>;

    act(() => {
      previousRequest = result.current.fetchByRange('2025-01-01', '2025-01-31');
      latestRequest = result.current.fetchByDate('2025-02-10');
    });
    await act(async () => {
      previous.reject(new Error('Earlier request failed'));
      await previousRequest;
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      latest.resolve({ ok: true, data: { transactions: sampleTxns } });
      await latestRequest;
    });
    expect(result.current.transactions).toEqual(sampleTxns);
    expect(result.current.loading).toBe(false);
  });

  it('clears the selection and ignores pending responses after reset', async () => {
    const pending = deferredResponse();
    mockGet.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useTransactionsByDate());
    let request!: Promise<void>;

    act(() => { request = result.current.fetchByRange('2025-01-01', '2025-01-31'); });
    expect(result.current.loading).toBe(true);
    act(() => { result.current.reset(); });
    expect(result.current.loading).toBe(false);
    expect(result.current.transactions).toEqual([]);

    await act(async () => {
      pending.resolve({ ok: true, data: { transactions: sampleTxns } });
      await request;
    });
    expect(result.current.transactions).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
