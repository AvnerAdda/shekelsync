import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancialCorrectionDialog from '../FinancialCorrectionDialog';

const post = vi.fn();

vi.mock('@renderer/lib/api-client', () => ({
  apiClient: { post: (...args: unknown[]) => post(...args) },
}));

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({ formatCurrency: (value: number) => `₪${value}` }),
}));

const labels: Record<string, string> = {
  'financialTruth.correctTitle': 'Correct this prediction',
  'financialTruth.correctDescription': 'Shared everywhere',
  'financialTruth.actions.skipOccurrence': 'Not coming this time',
  'financialTruth.actions.skipOccurrenceHint': 'Skip one',
  'financialTruth.actions.suppressPattern': 'This is not recurring',
  'financialTruth.actions.suppressPatternHint': 'Stop future projections',
  'financialTruth.actions.endPattern': 'It ended or was cancelled',
  'financialTruth.actions.endPatternHint': 'End from date',
  'financialTruth.actions.pausePattern': 'Pause it for now',
  'financialTruth.actions.pausePatternHint': 'Pause',
  'financialTruth.actions.overridePattern': 'The details are wrong',
  'financialTruth.actions.overridePatternHint': 'Override details',
  'financialTruth.impactTitle': 'What will change',
  'financialTruth.impactValues': 'Estimated impact',
  'financialTruth.apply': 'Apply correction',
  'actions.cancel': 'Cancel',
  'actions.undo': 'Undo',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => labels[key]
      || (typeof fallback === 'string' ? fallback : key),
  }),
}));

function previewResponse(patternId: number) {
  return {
    ok: true,
    data: {
      success: true,
      truthRevision: 3,
      target: { patternId },
      impact: { monthlyDelta: -50, sixMonthDelta: -300, affectedSurfaces: ['forecast', 'subscriptions'] },
    },
  };
}

describe('FinancialCorrectionDialog', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockImplementation((url: string, body: any) => {
      const patternId = body.target.patternId;
      if (url.endsWith('/preview')) return Promise.resolve(previewResponse(patternId));
      return Promise.resolve({
        ok: true,
        data: {
          success: true,
          correction: { id: patternId, action: body.action },
          truthRevision: 4,
          affectedDomains: ['forecast', 'subscriptions'],
          refreshState: 'pending',
        },
      });
    });
  });

  it('previews and commits only the identifiers belonging to the clicked card', async () => {
    const onClose = vi.fn();
    const onApplied = vi.fn();
    const { rerender } = render(
      <FinancialCorrectionDialog
        open
        target={{
          kind: 'occurrence',
          patternId: 11,
          occurrenceId: 'pattern:11:2026-09-01',
          title: 'First card',
          amount: 50,
          capabilities: ['skip_occurrence', 'suppress_pattern'],
        }}
        sourceFeature="dashboard_forecast"
        sourceKey="card:first"
        onClose={onClose}
        onApplied={onApplied}
      />,
    );

    expect(screen.getByText('First card')).toBeInTheDocument();
    expect(screen.queryByText('Second card')).not.toBeInTheDocument();
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/api/financial-truth/corrections/preview',
      expect.objectContaining({
        target: { kind: 'occurrence', patternId: 11, occurrenceId: 'pattern:11:2026-09-01', categoryDefinitionId: undefined },
        source: { feature: 'dashboard_forecast', sourceKey: 'card:first' },
      }),
    ));

    fireEvent.click(screen.getByLabelText('This is not recurring'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply correction' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Apply correction' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/api/financial-truth/corrections',
      expect.objectContaining({
        target: expect.objectContaining({ patternId: 11, occurrenceId: 'pattern:11:2026-09-01' }),
        action: 'suppress_pattern',
      }),
    ));
    expect(onApplied).toHaveBeenCalledWith(11, 'suppress_pattern');
    expect(onClose).toHaveBeenCalled();

    rerender(
      <FinancialCorrectionDialog
        open
        target={{ kind: 'pattern', patternId: 22, title: 'Second card', amount: 80 }}
        sourceFeature="subscriptions"
        sourceKey="card:second"
        onClose={onClose}
      />,
    );
    expect(await screen.findByText('Second card')).toBeInTheDocument();
    expect(screen.queryByText('First card')).not.toBeInTheDocument();
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/api/financial-truth/corrections/preview',
      expect.objectContaining({ target: expect.objectContaining({ patternId: 22 }) }),
    ));
  });

  it('keeps a failed correction open and presents the error without an unhandled rejection', async () => {
    const onClose = vi.fn();
    post.mockImplementation((url: string) => {
      if (url.endsWith('/preview')) return Promise.resolve(previewResponse(31));
      return Promise.resolve({ ok: false, data: { error: 'Correction could not be saved' } });
    });

    render(
      <FinancialCorrectionDialog
        open
        target={{
          kind: 'pattern',
          patternId: 31,
          title: 'Failed correction',
          capabilities: ['suppress_pattern'],
        }}
        sourceFeature="money_review"
        sourceKey="card:failed"
        onClose={onClose}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply correction' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Apply correction' }));

    expect(await screen.findByText('Correction could not be saved')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
