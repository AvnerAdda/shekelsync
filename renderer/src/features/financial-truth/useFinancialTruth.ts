import { useCallback, useState } from 'react';
import { apiClient } from '@renderer/lib/api-client';
import { FINANCIAL_TRUTH_CHANGED_EVENT } from './types';
import type {
  CorrectionDraft,
  CorrectionMutationResponse,
  CorrectionPreview,
  FinancialCorrection,
} from './types';

function announceTruthChange(response: CorrectionMutationResponse) {
  window.dispatchEvent(new CustomEvent(FINANCIAL_TRUTH_CHANGED_EVENT, {
    detail: {
      truthRevision: response.truthRevision,
      affectedDomains: response.affectedDomains,
      correctionId: response.correction.id,
      refreshState: response.refreshState,
    },
  }));
}

export function useFinancialTruth() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCorrection, setLastCorrection] = useState<FinancialCorrection | null>(null);

  const preview = useCallback(async (draft: CorrectionDraft) => {
    setError(null);
    const response = await apiClient.post<CorrectionPreview>('/api/financial-truth/corrections/preview', draft);
    if (!response.ok || !response.data?.success) {
      throw new Error((response.data as unknown as { error?: string })?.error || 'Could not preview this correction');
    }
    return response.data;
  }, []);

  const create = useCallback(async (draft: CorrectionDraft) => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiClient.post<CorrectionMutationResponse>('/api/financial-truth/corrections', {
        ...draft,
        requestId: draft.requestId || globalThis.crypto?.randomUUID?.() || `correction-${Date.now()}`,
      });
      if (!response.ok || !response.data?.success) {
        throw new Error((response.data as unknown as { error?: string })?.error || 'Could not save this correction');
      }
      setLastCorrection(response.data.correction);
      announceTruthChange(response.data);
      return response.data;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not save this correction';
      setError(message);
      throw caught;
    } finally {
      setBusy(false);
    }
  }, []);

  const revert = useCallback(async (correctionId: number) => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiClient.post<CorrectionMutationResponse>(
        `/api/financial-truth/corrections/${correctionId}/revert`,
        {},
      );
      if (!response.ok || !response.data?.success) {
        throw new Error((response.data as unknown as { error?: string })?.error || 'Could not restore this prediction');
      }
      setLastCorrection(null);
      announceTruthChange(response.data);
      return response.data;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not restore this prediction';
      setError(message);
      throw caught;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, lastCorrection, preview, create, revert, clearLastCorrection: () => setLastCorrection(null) };
}
