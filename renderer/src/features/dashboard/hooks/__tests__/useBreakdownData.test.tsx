import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BreakdownType } from '@renderer/types/analytics';
import { useBreakdownData } from '../useBreakdownData';

const mockGet = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

const START_DATE = new Date('2025-01-01T00:00:00Z');
const END_DATE = new Date('2025-01-31T00:00:00Z');

function buildResponse(data: unknown) {
  return { ok: true, data };
}

describe('useBreakdownData', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches initial breakdown types once and serves cached values', async () => {
    const expensePayload = { summary: { total: 100 } };
    const incomePayload = { summary: { total: 250 } };
    mockGet.mockResolvedValueOnce(buildResponse(expensePayload));
    mockGet.mockResolvedValueOnce(buildResponse(incomePayload));

    const { result } = renderHook(({ startDate, endDate }) =>
      useBreakdownData({ startDate, endDate }),
      {
        initialProps: { startDate: START_DATE, endDate: END_DATE },
      },
    );

    await waitFor(() => {
      expect(result.current.breakdownData.expense).toEqual(expensePayload);
      expect(result.current.breakdownData.income).toEqual(incomePayload);
    });

    await act(async () => {
      await result.current.refreshBreakdowns(['expense']);
    });

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('invalidates cache when date range changes', async () => {
    const firstPayload = { summary: { total: 100 } };
    const secondPayload = { summary: { total: 200 } };
    mockGet.mockResolvedValue(buildResponse(firstPayload));

    const { result, rerender } = renderHook(
      ({ startDate, endDate, types }: { startDate: Date; endDate: Date; types?: BreakdownType[] }) =>
        useBreakdownData({ startDate, endDate, initialTypes: types }),
      {
        initialProps: { startDate: START_DATE, endDate: END_DATE, types: ['expense'] as BreakdownType[] },
      },
    );

    await waitFor(() => {
      expect(result.current.breakdownData.expense).toEqual(firstPayload);
    });

    mockGet.mockResolvedValue(buildResponse(secondPayload));
    const nextStart = new Date('2025-02-01T00:00:00Z');
    const nextEnd = new Date('2025-02-28T00:00:00Z');

    await act(async () => {
      rerender({ startDate: nextStart, endDate: nextEnd, types: ['expense'] });
      await result.current.refreshBreakdowns(['expense']);
    });

    await waitFor(() => {
      expect(result.current.breakdownData.expense).toEqual(secondPayload);
    });

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('exposes errors when fetch fails', async () => {
    mockGet.mockResolvedValue({ ok: false, status: 500 });
    const { result } = renderHook(() =>
      useBreakdownData({ startDate: START_DATE, endDate: END_DATE, initialTypes: ['expense'] }),
    );

    await waitFor(() => {
      expect(result.current.breakdownErrors.expense).toBeTruthy();
      expect(result.current.breakdownData.expense).toBeNull();
    });
  });
});
