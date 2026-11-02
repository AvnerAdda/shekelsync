import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MortgageTracksDialog from '../MortgageTracksDialog';
import { createEmptyTrack } from '../mortgage-utils';

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));

vi.mock('@/lib/api-client', () => ({ apiClient: { post: mockPost } }));
vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({ maskAmounts: false, formatCurrency: (value: number) => `₪${Math.round(value).toLocaleString('en-US')}` }),
}));
vi.mock('react-i18next', () => {
  const t = (_key: string, fallback?: string, options?: Record<string, unknown>) => (
    typeof fallback === 'string' && options
      ? fallback.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options[name] ?? ''))
      : fallback
  );
  return { useTranslation: () => ({ t }) };
});

const previewResponse = {
  ok: true,
  data: {
    asOf: '2026-11-01',
    summary: {
      source: 'draft', balance: 500000, nextPayment: 2387.78, nextPaymentDate: '2026-11-10', weightedRate: 4,
      maturityDate: '2056-09-10', drawn: 500000, undrawn: 0, interestPaid: 0, interestRemaining: 0, indexationToDate: 0,
      totalCost: 359000, tracks: [{ trackId: 'track-0', type: 'prime', balance: 500000, nextPayment: 2387.78, currentRate: 4 }], warnings: [],
    },
    schedule: null,
    market: { currentPrime: 4.75 },
  },
};

describe('MortgageTracksDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockPost.mockReset();
    mockPost.mockResolvedValue(previewResponse);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const initialDraft = {
    tracks: [{ ...createEmptyTrack('prime', '2026-09-10'), margin: -0.75, firstPaymentDate: '2026-10-10', tranches: [{ drawDate: '2026-09-10', amount: 500000, status: 'drawn' as const }] }],
    events: [],
  };

  it('shows prime fields, previews the payment once and saves the draft', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<MortgageTracksDialog open initialDraft={initialDraft} onClose={onClose} onSave={onSave} />);

    expect(screen.getByLabelText(/Margin vs prime/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Interest rate/)).not.toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost.mock.calls[0][0]).toBe('/api/investments/real-estate/mortgage/preview');
    expect(await screen.findByText('Today: 4.00% (4.07% effective)')).toBeInTheDocument();
    expect(screen.getByText('₪2,388')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save mortgage' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].tracks[0]).toMatchObject({ type: 'prime', margin: -0.75 });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('switches to a fixed track and shows the converted effective rate', async () => {
    render(<MortgageTracksDialog open initialDraft={initialDraft} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.mouseDown(screen.getByLabelText('Track type'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Fixed, unlinked (קל"צ)'));
    const rate = await screen.findByLabelText(/^Interest rate/);
    fireEvent.change(rate, { target: { value: '4' } });
    expect(await screen.findByText('= 4.07% effective')).toBeInTheDocument();
  });

  it('flags a mis-dated first payment on the track and fixes it in one click', async () => {
    const misdated = {
      tracks: [{ ...createEmptyTrack('prime', '2026-09-10'), margin: -0.75, firstPaymentDate: '2026-12-01', tranches: [{ drawDate: '2026-09-10', amount: 500000, status: 'drawn' as const }] }],
      events: [],
    };
    render(<MortgageTracksDialog open initialDraft={misdated} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText(/is 82 days after the draw/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Set to / }));
    await waitFor(() => expect(screen.queryByText(/is 82 days after the draw/)).not.toBeInTheDocument());
    expect(screen.getByLabelText(/First payment date/)).toHaveValue('2026-10-10');
  });
});
