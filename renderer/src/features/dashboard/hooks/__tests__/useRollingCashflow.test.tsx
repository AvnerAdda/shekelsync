import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRollingCashflow } from '../useRollingCashflow';
import { FINANCIAL_TRUTH_CHANGED_EVENT } from '@renderer/features/financial-truth/types';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('@renderer/lib/api-client', () => ({ apiClient: { get: mockGet } }));
const response = { ok: true, data: { history: [
  { date: '2026-08-03', income: 100, expenses: 20, investments: 30 },
  { date: '2026-09-01', income: 200, expenses: 40, investments: -50 },
] } };

describe('useRollingCashflow', () => {
  beforeEach(() => { mockGet.mockReset().mockResolvedValue(response); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('requests daily actuals with the full lookback and skips unnecessary summary data', async () => {
    const { result } = renderHook(() => useRollingCashflow('2026-09-01', '2026-09-03', true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGet).toHaveBeenCalledWith(
      '/api/analytics/dashboard?startDate=2026-08-03&endDate=2026-09-03&aggregation=daily&includeBreakdowns=0&includeSummary=0&includeChartBreakdowns=0',
      { cacheMode: 'no-store' },
    );
    expect(result.current.history).toEqual(response.data.history);
  });

  it('ignores stale responses after date changes and refreshes after corrections', async () => {
    let resolveOld!: (value: typeof response) => void;
    mockGet.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { result, rerender } = renderHook(({ start }) => useRollingCashflow(start, '2026-09-03', true),
      { initialProps: { start: '2026-09-01' } });
    rerender({ start: '2026-09-02' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { resolveOld({ ok: true, data: { history: [] } }); });
    expect(result.current.history).toEqual(response.data.history);
    act(() => { window.dispatchEvent(new Event(FINANCIAL_TRUTH_CHANGED_EVENT)); });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3));
    expect(mockGet.mock.calls[2][0]).toContain('noCache=1');
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('reuses recent history across tab toggles, repeated focus and returning to a loaded date range', async () => {
    const { result, rerender } = renderHook(({ start, enabled }) => useRollingCashflow(start, '2026-09-03', enabled),
      { initialProps: { start: '2026-09-01', enabled: true } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const history = result.current.history;
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    rerender({ start: '2026-09-01', enabled: false });
    rerender({ start: '2026-09-01', enabled: true });
    expect(result.current.history).toBe(history);
    expect(mockGet).toHaveBeenCalledTimes(1);
    rerender({ start: '2026-09-02', enabled: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ start: '2026-09-01', enabled: true });
    expect(result.current.history).toBe(history);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('shares an in-flight request across focus and tab toggles', async () => {
    let resolve!: (value: typeof response) => void;
    mockGet.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { result, rerender } = renderHook(({ enabled }) => useRollingCashflow('2026-09-01', '2026-09-03', enabled),
      { initialProps: { enabled: true } });
    act(() => { window.dispatchEvent(new Event('focus')); });
    rerender({ enabled: false });
    rerender({ enabled: true });
    expect(mockGet).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(response); });
    expect(result.current.history).toEqual(response.data.history);
    expect(result.current.loading).toBe(false);
  });

  it('refreshes expired data on focus without clearing the displayed series', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const { result } = renderHook(() => useRollingCashflow('2026-09-01', '2026-09-03', true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let resolve!: (value: typeof response) => void;
    mockGet.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    clock.mockReturnValue(now + 60_001);
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result.current.history).toEqual(response.data.history);
    await act(async () => { resolve(response); });
    expect(result.current.loading).toBe(false);
  });

  it('does not let an older request overwrite a forced refresh or its cache', async () => {
    let resolveOld!: (value: typeof response) => void;
    mockGet.mockImplementationOnce(() => new Promise(done => { resolveOld = done; }));
    const { result } = renderHook(() => useRollingCashflow('2026-09-01', '2026-09-03', true));
    await act(async () => { await result.current.refresh(true); });
    await act(async () => { resolveOld({ ok: true, data: { history: [] } }); });
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(result.current.history).toEqual(response.data.history);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('coalesces correction events and keeps the displayed history during refresh', async () => {
    const { result } = renderHook(() => useRollingCashflow('2026-09-01', '2026-09-03', true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let resolve!: (value: typeof response) => void;
    mockGet.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    act(() => {
      window.dispatchEvent(new Event('dataRefresh'));
      window.dispatchEvent(new Event(FINANCIAL_TRUTH_CHANGED_EVENT));
    });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.history).toEqual(response.data.history);
    await act(async () => { resolve({ ok: true, data: { history: [] } }); });
    expect(result.current.history).toEqual([]);
  });

  it('invalidates cached history for corrections received while the overlay is disabled', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useRollingCashflow('2026-09-01', '2026-09-03', enabled),
      { initialProps: { enabled: true } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ enabled: false });
    act(() => { window.dispatchEvent(new Event('dataRefresh')); });
    // Re-enable before the coalescing timer fires: cleanup must invalidate too.
    rerender({ enabled: true });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(mockGet.mock.calls[1][0]).toContain('noCache=1');
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('supports retry after an error', async () => {
    mockGet.mockResolvedValueOnce({ ok: false });
    const { result } = renderHook(() => useRollingCashflow('2026-09-01', '2026-09-03', true));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.history).toEqual([]);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBe(false);
    expect(result.current.history).toEqual(response.data.history);
  });

  it('does not fetch when disabled or when the entire range is in the future', async () => {
    const { result, rerender } = renderHook(({ start, end, enabled }) => useRollingCashflow(start, end, enabled),
      { initialProps: { start: '2026-09-01', end: '2026-09-03', enabled: false } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGet).not.toHaveBeenCalled();
    rerender({ start: '2099-01-01', end: '2099-01-31', enabled: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGet).not.toHaveBeenCalled();
  });
});
