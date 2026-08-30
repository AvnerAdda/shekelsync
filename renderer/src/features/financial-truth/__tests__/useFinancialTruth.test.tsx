import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFinancialTruth } from '../useFinancialTruth';

const post = vi.fn();

vi.mock('@renderer/lib/api-client', () => ({
  apiClient: { post: (...args: unknown[]) => post(...args) },
}));

const correction = {
  id: 42,
  requestId: 'request-42',
  targetKind: 'occurrence',
  patternId: 7,
  occurrenceId: 'pattern:7:2026-09-01',
  categoryDefinitionId: null,
  action: 'skip_occurrence',
  scope: 'occurrence',
  effectiveDate: null,
  reasonCode: 'not_coming',
  sourceFeature: 'dashboard',
  sourceKey: 'forecast-card:7',
  status: 'active',
  createdAt: '2026-08-27T00:00:00.000Z',
  revertedAt: null,
};

describe('useFinancialTruth', () => {
  beforeEach(() => post.mockReset());

  it('commits a card-specific correction and announces only affected caches', async () => {
    post.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        correction,
        truthRevision: 9,
        affectedDomains: ['forecast', 'subscriptions'],
        refreshState: 'pending',
      },
    });
    const changed = vi.fn();
    const refreshed = vi.fn();
    window.addEventListener('financialTruthChanged', changed);
    window.addEventListener('dataRefresh', refreshed);
    const { result } = renderHook(() => useFinancialTruth());

    await act(async () => {
      await result.current.create({
        requestId: 'request-42',
        target: { kind: 'occurrence', patternId: 7, occurrenceId: 'pattern:7:2026-09-01' },
        action: 'skip_occurrence',
        scope: 'occurrence',
        reasonCode: 'not_coming',
        source: { feature: 'dashboard', sourceKey: 'forecast-card:7' },
      });
    });

    expect(post).toHaveBeenCalledWith('/api/financial-truth/corrections', expect.objectContaining({
      requestId: 'request-42',
      target: { kind: 'occurrence', patternId: 7, occurrenceId: 'pattern:7:2026-09-01' },
    }));
    expect(result.current.lastCorrection).toEqual(correction);
    expect(changed).toHaveBeenCalledOnce();
    expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual(expect.objectContaining({
      truthRevision: 9,
      correctionId: 42,
      affectedDomains: ['forecast', 'subscriptions'],
    }));
    expect(refreshed).not.toHaveBeenCalled();
    window.removeEventListener('financialTruthChanged', changed);
    window.removeEventListener('dataRefresh', refreshed);
  });

  it('reverts the exact correction used for Undo', async () => {
    post.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        correction: { ...correction, status: 'reverted' },
        truthRevision: 10,
        affectedDomains: ['forecast'],
        refreshState: 'pending',
      },
    });
    const { result } = renderHook(() => useFinancialTruth());

    await act(async () => { await result.current.revert(42); });

    expect(post).toHaveBeenCalledWith('/api/financial-truth/corrections/42/revert', {});
    expect(result.current.lastCorrection).toBeNull();
  });
});
