import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccountSignals } from '../useAccountSignals';

const mockGet = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

describe('useAccountSignals', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('computes average budget usage and bank account presence', async () => {
    mockGet.mockResolvedValueOnce({ ok: true, data: [{ percentage: 40 }, { percentage: 60 }] });
    mockGet.mockResolvedValueOnce({ ok: true, data: [{ id: 1 }] });

    const { result } = renderHook(() => useAccountSignals());

    await waitFor(() => {
      expect(result.current.budgetUsage).toBe(50);
      expect(result.current.hasBankAccounts).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenNthCalledWith(1, '/api/budgets/usage');
    expect(mockGet).toHaveBeenNthCalledWith(2, '/api/credentials');
  });

  it('exposes refresh helper to re-query signals', async () => {
    mockGet.mockResolvedValueOnce({ ok: true, data: [{ percentage: 20 }] });
    mockGet.mockResolvedValueOnce({ ok: true, data: [] });

    const { result } = renderHook(() => useAccountSignals());

    await waitFor(() => {
      expect(result.current.budgetUsage).toBe(20);
      expect(result.current.hasBankAccounts).toBe(false);
    });

    mockGet.mockResolvedValueOnce({ ok: true, data: [{ percentage: 80 }] });
    mockGet.mockResolvedValueOnce({ ok: true, data: [{ id: 2 }, { id: 3 }] });

    result.current.refresh();

    await waitFor(() => {
      expect(result.current.budgetUsage).toBe(80);
      expect(result.current.hasBankAccounts).toBe(true);
    });
  });

  it('handles API failures gracefully', async () => {
    mockGet.mockResolvedValueOnce({ ok: false, status: 500 });
    mockGet.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() => useAccountSignals());

    await waitFor(() => {
      expect(result.current.budgetUsage).toBeUndefined();
      expect(result.current.hasBankAccounts).toBeNull();
    });
  });
});
