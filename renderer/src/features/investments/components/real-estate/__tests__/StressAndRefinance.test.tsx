import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MortgageView, RefinancePreviewResponse } from '@renderer/types/investments';

import MortgageStressPanel from '../MortgageStressPanel';
import RefinancePanel, { applyRefinanceToDraft } from '../RefinancePanel';
import { createEmptyTrack } from '../mortgage-utils';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: mockGet, post: mockPost } }));
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

const view = {
  accountId: 4,
  asOf: '2026-11-01',
  source: 'tracks',
  mortgage: {
    tracks: [
      { ...createEmptyTrack('fixed_unlinked', '2026-09-10'), id: 11, rate: 4.45, tranches: [{ drawDate: '2026-09-10', amount: 747500, status: 'drawn' }] },
      { ...createEmptyTrack('prime', '2026-09-10'), id: 12, margin: -0.75, tranches: [{ drawDate: '2026-09-10', amount: 500000, status: 'drawn' }] },
    ],
    events: [],
  },
  legacy: null, summary: null, schedule: null, scenario: {},
} as unknown as MortgageView;

const preview: RefinancePreviewResponse = {
  date: '2026-11-10',
  closedTrackIds: ['11'],
  closedBalance: 745509,
  offerAmount: 745509,
  offerTracks: [{ id: 'offer-0', type: 'fixed_unlinked', rate: 4.1, rateConvention: 'nominal', termMonths: 358, amount: 745509, firstPaymentDate: '2026-12-10' }],
  costs: { prepaymentFees: 60, switchingCosts: 3000, total: 3060, financed: false },
  current: { monthlyPayment: 6626.2, remainingPayments: 3663812, maturityDate: '2056-09-10' },
  offer: { monthlyPayment: 6473.44, remainingPayments: 3609122, maturityDate: '2056-09-10' },
  savings: { monthlyPaymentChange: -152.76, nominal: 51629, presentValue: 28846, discountRatePct: 4 },
  breakEvenMonths: 21,
  verdict: 'worth_it',
  series: [{ month: '2026-12', current: 6626, offer: 6473 }],
  warnings: [],
};

describe('applyRefinanceToDraft', () => {
  it('closes the replaced tracks and adds the offer tracks drawn on the refinance date', () => {
    const draft = applyRefinanceToDraft(view, preview, '2026-11-01');
    expect(draft.tracks).toHaveLength(3);
    expect(draft.tracks[2]).toMatchObject({ type: 'fixed_unlinked', rate: 4.1, termMonths: 358, firstPaymentDate: '2026-12-10' });
    expect(draft.tracks[2].tranches[0]).toMatchObject({ drawDate: '2026-11-10', amount: 745509, status: 'planned', rate: 4.1 });
    expect(draft.events).toEqual([expect.objectContaining({ type: 'refinance', date: '2026-11-10', closeTrackIndexes: [0], trackIndex: null })]);
  });
});

describe('MortgageStressPanel', () => {
  beforeEach(() => mockPost.mockReset());

  it('requests the presets plus the custom scenario and shows the summary table', async () => {
    mockPost.mockResolvedValue({
      ok: true,
      data: {
        asOf: '2026-11-01',
        monthlyIncome: 25000,
        scenarios: [
          { key: 'base', paymentIn1y: 10010, paymentIn3y: 10020, paymentIn5y: 10059, peakPayment: 10552, peakMonth: '2056-09', totalCost: 1629565, totalCostDelta: 0, peakDeltaPct: 0, peakPaymentToIncomePct: 42.2, payments: [{ month: '2027-01', payment: 10010 }] },
          { key: 'combined', paymentIn1y: 10948, paymentIn3y: 11000, paymentIn5y: 11164, peakPayment: 12767, peakMonth: '2056-09', totalCost: 2153329, totalCostDelta: 523764, peakDeltaPct: 21, peakPaymentToIncomePct: 51.1, payments: [{ month: '2027-01', payment: 10948 }] },
        ],
      },
    });
    render(<MortgageStressPanel accountId={4} />);
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost.mock.calls[0][1]).toEqual({ scenarios: [{ scenario: { primeShiftPct: 1.5, cpiAnnualOverridePct: 3 } }] });
    expect((await screen.findAllByText('Prime +2% & inflation 4%')).length).toBeGreaterThan(0);
    expect(screen.getByText('₪523,764')).toBeInTheDocument();
    expect(screen.getByText('51.1%')).toBeInTheDocument();
  });
});

describe('RefinancePanel', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockGet.mockResolvedValue({
      ok: true,
      data: {
        asOf: '2026-11-01',
        switchingCosts: 3000,
        tracks: [
          { trackId: '11', type: 'fixed_unlinked', label: null, balance: 746507, currentRate: 4.45, status: 'checked', marketRate: 4.62, marketPeriod: '2026-08', verdict: 'not_worth_it', monthlyPaymentChange: 75.35, saving: -18797, fees: 3060, breakEvenMonths: null },
          { trackId: '12', type: 'prime', label: null, balance: 499280, currentRate: 4, status: 'no_benchmark' },
        ],
      },
    });
  });

  it('checks each track against the market and compares then applies an offer', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockPost.mockResolvedValue({ ok: true, data: preview });
    render(<RefinancePanel accountId={4} view={view} onApply={onApply} />);
    expect(await screen.findByText('4.45% → 4.62%')).toBeInTheDocument();
    expect(screen.getAllByText('No gain').length).toBeGreaterThan(0);
    expect(screen.getByText(/No public market average/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Fixed, unlinked .* ₪746,507/));
    fireEvent.change(screen.getByLabelText('Rate %'), { target: { value: '4.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost.mock.calls[0][1]).toMatchObject({ closeTrackIds: ['11'], offerTracks: [expect.objectContaining({ type: 'fixed_unlinked', rate: 4.1 })] });
    expect(await screen.findByText('21 months')).toBeInTheDocument();
    expect(screen.getAllByText('Worth it').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /update my tracks/ }));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(onApply.mock.calls[0][0].events[0]).toMatchObject({ type: 'refinance', closeTrackIndexes: [0] });
  });
});
