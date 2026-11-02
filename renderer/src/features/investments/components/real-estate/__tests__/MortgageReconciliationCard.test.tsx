import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MortgageReconciliationCard from '../MortgageReconciliationCard';

const { mockGet, mockPut } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPut: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: mockGet, put: mockPut } }));
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

const reconciliation = {
  accountId: 4,
  status: 'drift',
  matchedCount: 2,
  matcher: { vendor: 'discount', accountNumber: '0162', pattern: 'דסק משכנתא חיוב', source: 'linked_transactions' },
  candidates: [{ vendor: 'discount', accountNumber: '0162', pattern: 'דסק משכנתא חיוב', name: 'דסק-משכנתא חיוב', count: 2, lastDate: '2026-10-10', lastAmount: 6700.8 }],
  months: [
    { month: '2026-09', expected: 0, actual: 3469.45, difference: 3469.45, differencePct: null, tolerance: 20, status: 'unexpected' },
    { month: '2026-10', expected: 6626, actual: 6700.8, difference: 74.8, differencePct: 1.13, tolerance: 66.3, status: 'drift' },
    { month: '2026-11', expected: 6626, actual: 0, difference: -6626, differencePct: -100, tolerance: 66.3, status: 'pending' },
  ],
  summary: { latestMonth: '2026-10', latestStatus: 'drift', latestDifference: 74.8, averageDifference: 74.8, suggestion: 'latest_drift' },
};

const largeGap = {
  ...reconciliation,
  matcher: { ...reconciliation.matcher, source: 'saved' },
  months: [{ month: '2026-10', expected: 4247, actual: 6700.8, difference: 2453.8, differencePct: 57.8, tolerance: 42, status: 'drift' }],
  summary: {
    latestMonth: '2026-10', latestStatus: 'drift', latestDifference: 2453.8, averageDifference: 2453.8, suggestion: 'large_gap',
    composition: {
      paying: [{ trackId: '7', type: 'variable_cpi', label: null, payment: 474, date: '2026-10-10' }, { trackId: '8', type: 'fixed_unlinked', label: null, payment: 3773, date: '2026-10-01' }],
      notYetPaying: [{ trackId: '9', type: 'variable_unlinked', label: null, firstPaymentDate: '2026-12-01' }],
    },
  },
};

describe('MortgageReconciliationCard', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
    mockGet.mockResolvedValue({ ok: true, data: reconciliation });
  });

  it('shows computed vs debited payments with a suggestion', async () => {
    render(<MortgageReconciliationCard accountId={4} />);
    expect(await screen.findByText('Computed vs debited by the bank')).toBeInTheDocument();
    expect(screen.getByText(/from payments linked to this property/)).toBeInTheDocument();
    expect(screen.getByText('₪6,701')).toBeInTheDocument();
    expect(screen.getByText('Differs')).toBeInTheDocument();
    expect(screen.getByText('Unexpected')).toBeInTheDocument();
    expect(screen.getByText(/A first payment often includes extra days of interest/)).toBeInTheDocument();
  });

  it('explains a large gap by track and opens the track editor', async () => {
    mockGet.mockResolvedValue({ ok: true, data: largeGap });
    const onEditTracks = vi.fn();
    render(<MortgageReconciliationCard accountId={4} onEditTracks={onEditTracks} />);
    expect(await screen.findByText(/your tracks only add up to ₪4,247/)).toBeInTheDocument();
    expect(screen.getByText('Fixed, unlinked (קל"צ): ₪3,773 on Oct 1')).toBeInTheDocument();
    expect(screen.getByText('Variable, unlinked: no payment yet, first one on Dec 1')).toBeInTheDocument();
    // The current debit is preselected: nothing to save.
    expect(screen.getByText('This debit is already used.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use this debit' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit tracks' }));
    expect(onEditTracks).toHaveBeenCalled();
  });

  it('saves the chosen debit as the payment matcher', async () => {
    const withSecond = {
      ...reconciliation,
      candidates: [...reconciliation.candidates, { vendor: 'leumi', accountNumber: '777', pattern: 'לאומי משכנתא', name: 'לאומי משכנתא', count: 1, lastDate: '2026-10-01', lastAmount: 100 }],
    };
    mockGet.mockResolvedValue({ ok: true, data: withSecond });
    mockPut.mockResolvedValue({ ok: true, data: { ...withSecond, matcher: { vendor: 'leumi', accountNumber: '777', pattern: 'לאומי משכנתא', source: 'saved' } } });
    render(<MortgageReconciliationCard accountId={4} />);
    await screen.findByText('Computed vs debited by the bank');
    fireEvent.mouseDown(screen.getByLabelText('Mortgage debit'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText(/לאומי משכנתא/));
    fireEvent.click(screen.getByRole('button', { name: 'Use this debit' }));
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith(
      '/api/investments/real-estate/properties/4/mortgage/payment-matcher',
      { vendor: 'leumi', accountNumber: '777', pattern: 'לאומי משכנתא' },
    ));
    expect(await screen.findByText(/chosen by you/)).toBeInTheDocument();
    expect(screen.getByText('Saved: this debit is used to check your payments.')).toBeInTheDocument();
  });
});
