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
      { ...createEmptyTrack('fixed_unlinked', '2026-09-10'), id: 11, rate: 4.5, tranches: [{ drawDate: '2026-09-10', amount: 400000, status: 'drawn' }] },
      { ...createEmptyTrack('prime', '2026-09-10'), id: 12, margin: -0.75, tranches: [{ drawDate: '2026-09-10', amount: 500000, status: 'drawn' }] },
    ],
    events: [],
  },
  legacy: null, summary: null, schedule: null, scenario: {},
} as unknown as MortgageView;

const preview: RefinancePreviewResponse = {
  date: '2026-11-10',
  closedTrackIds: ['11'],
  closedBalance: 398000,
  offerAmount: 398000,
  offerTracks: [{ id: 'offer-0', type: 'fixed_unlinked', rate: 4.1, rateConvention: 'nominal', termMonths: 358, amount: 398000, firstPaymentDate: '2026-12-10' }],
  costs: { prepaymentFees: 60, switchingCosts: 3000, total: 3060, financed: false },
  current: { monthlyPayment: 4800, remainingPayments: 1728000, maturityDate: '2056-09-10' },
  offer: { monthlyPayment: 4650, remainingPayments: 1670940, maturityDate: '2056-09-10' },
  savings: { monthlyPaymentChange: -150, nominal: 54000, presentValue: 30000, discountRatePct: 4 },
  breakEvenMonths: 21,
  verdict: 'worth_it',
  series: [{ month: '2026-12', current: 4800, offer: 4650 }],
  warnings: [],
};

describe('applyRefinanceToDraft', () => {
  it('closes the replaced tracks and adds the offer tracks drawn on the refinance date', () => {
    const draft = applyRefinanceToDraft(view, preview, '2026-11-01');
    expect(draft.tracks).toHaveLength(3);
    expect(draft.tracks[2]).toMatchObject({ type: 'fixed_unlinked', rate: 4.1, termMonths: 358, firstPaymentDate: '2026-12-10' });
    expect(draft.tracks[2].tranches[0]).toMatchObject({ drawDate: '2026-11-10', amount: 398000, status: 'planned', rate: 4.1 });
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
        monthlyIncome: 20000,
        scenarios: [
          { key: 'base', paymentIn1y: 7500, paymentIn3y: 7600, paymentIn5y: 7800, peakPayment: 8000, peakMonth: '2056-09', totalCost: 1200000, totalCostDelta: 0, peakDeltaPct: 0, peakPaymentToIncomePct: 40, payments: [{ month: '2027-01', payment: 7500 }] },
          { key: 'combined', paymentIn1y: 8500, paymentIn3y: 9000, paymentIn5y: 9500, peakPayment: 10000, peakMonth: '2056-09', totalCost: 1600000, totalCostDelta: 400000, peakDeltaPct: 25, peakPaymentToIncomePct: 50, payments: [{ month: '2027-01', payment: 8500 }] },
        ],
      },
    });
    render(<MortgageStressPanel accountId={4} />);
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost.mock.calls[0][1]).toEqual({ scenarios: [{ scenario: { primeShiftPct: 1.5, cpiAnnualOverridePct: 3 } }] });
    expect((await screen.findAllByText('Prime +2% & inflation 4%')).length).toBeGreaterThan(0);
    expect(screen.getByText('₪400,000')).toBeInTheDocument();
    expect(screen.getByText('50.0%')).toBeInTheDocument();
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
          { trackId: '11', type: 'fixed_unlinked', label: null, balance: 399000, currentRate: 4.5, status: 'checked', marketRate: 4.75, marketPeriod: '2026-08', verdict: 'not_worth_it', monthlyPaymentChange: 100, saving: -15000, fees: 3060, breakEvenMonths: null },
          { trackId: '12', type: 'prime', label: null, balance: 499000, currentRate: 4, status: 'no_benchmark' },
        ],
      },
    });
  });

  it('checks each track against the market and compares then applies an offer', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockPost.mockResolvedValue({ ok: true, data: preview });
    render(<RefinancePanel accountId={4} view={view} onApply={onApply} />);
    expect(await screen.findByText('4.50% → 4.75%')).toBeInTheDocument();
    expect(screen.getAllByText('No gain').length).toBeGreaterThan(0);
    expect(screen.getByText(/No public market average/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Fixed, unlinked .* ₪399,000/));
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
