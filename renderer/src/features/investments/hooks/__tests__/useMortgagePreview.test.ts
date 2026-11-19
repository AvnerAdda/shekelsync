import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MortgageDraft } from '@renderer/types/investments';
import { createEmptyTrack } from '../../components/real-estate/mortgage-utils';
import { useMortgagePreview } from '../useRealEstateMortgage';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { post } }));

const draft: MortgageDraft = {
  tracks: [{ ...createEmptyTrack('prime', '2026-09-10'), margin: -0.75,
    firstPaymentDate: '2026-10-10', tranches: [{ drawDate: '2026-09-10', amount: 500000, status: 'drawn' }] }],
  events: [],
};

describe('useMortgagePreview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    post.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it.each(['incomplete', 'closed'] as const)('ignores an in-flight response after the draft is %s', async (state) => {
    let resolve!: (value: unknown) => void;
    post.mockReturnValue(new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(({ value }) => useMortgagePreview(value, 10), {
      initialProps: { value: draft as MortgageDraft | null },
    });
    await act(async () => { vi.advanceTimersByTime(10); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);

    rerender({ value: state === 'closed' ? null : { ...draft, tracks: [] } });
    expect(result.current.data).toBeNull();
    await act(async () => { resolve({ ok: true, data: { summary: { nextPayment: 2387.78 } } }); });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
