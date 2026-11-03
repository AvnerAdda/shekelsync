import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MortgageHealth, SaleAnalysis } from '@renderer/types/investments';

import SaleAnalysisPanel from '../SaleAnalysisPanel';
import MortgageHealthPanel from '../MortgageHealthPanel';

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

const sale = {
  asOf: '2026-11-01',
  settings: { alternativeReturnPct: 5 },
  assumptions: ['down_payment_derived'],
  property: { value: 2736851, ownershipPct: 100, purchasePrice: 2730000, purchaseDate: '2026-08-01' },
  debt: { balance: 1363853, accruedInterest: 3239, undrawn: 682500, prepaymentFees: { tracks: [], operational: 60, total: 1068 }, payoffToday: 2050660 },
  cashInvested: { upfront: 682500, payments: 13253, total: 695753, plannedUpfront: 0 },
  costs: [],
  breakEven: { clearDebtPrice: 2112993, recoverCashPrice: 2829895, clearDebtVsValuePct: -22.8, recoverCashVsValuePct: 3.4 },
  today: { price: 2736851, saleCosts: 80737, capitalGainsTax: 0, mortgagePayoff: 1367092, undrawnCommitment: 682500, prepaymentFees: 1068, netProceeds: 605454, profit: -90299 },
  sensitivity: [{ changePct: -5, price: 2600008, netProceeds: 472000, profit: -223000 }, { changePct: 0, price: 2736851, netProceeds: 605454, profit: -90299 }],
  alternative: {
    points: [
      { year: 2026, date: '2026-11-01', propertyValue: 2736851, ownerWealth: 612255, alternativeWealth: 702055, advantage: -89800 },
      { year: 2040, date: '2040-12-01', propertyValue: 4100000, ownerWealth: 1639500, alternativeWealth: 1515753, advantage: 123747 },
    ],
    advantageToday: -89800,
    crossoverYear: 2036,
    alwaysBehind: false,
    rentConfigured: true,
  },
  breakEvenAppreciationPct10y: 0.95,
  indexedValue: { series: 'cbs.hpi.national', ratio: 1.02, fromPeriod: '2025-01', toPeriod: '2026-07', value: 2784600, purchasePrice: 2730000, purchaseMonth: '2025-01', noDataSincePurchase: false },
} as unknown as SaleAnalysis;

const health = {
  overall: 'watch',
  rates: { verdict: 'good', tracks: [{ trackId: 'fixed', type: 'fixed_unlinked', comparison: 'rate', yours: 4.54, benchmark: 4.62, delta: -0.08, verdict: 'good', benchmarkPeriod: '2026-08' }] },
  exposure: {
    verdict: 'watch', mix: { fixedPct: 54.7, primePct: 36.6, variablePct: 8.6, cpiLinkedPct: 8.6 }, meetsFixedThird: true,
    steadyMonth: '2027-02', steadyPayment: 10010, perPrimePoint: 444, basePeakPayment: 10552, worstCasePayment: 12767, worstIncreasePct: 27.5,
  },
  affordability: {
    verdict: 'watch', paymentToIncomePct: 39.9, stressedPaymentToIncomePct: 50.8, regulatoryCapPct: 50, comfortablePct: 30,
    income: { monthly: 25118, method: 'median', monthsWithIncome: 6, months: [], source: 'transactions' },
  },
  equity: { verdict: 'watch', loanToValuePct: 74.8, priceDropToZeroEquityPct: 25.2, principalShareOfPaymentPct: 29.1, ltvBelow60: '2036-12', ltvBelow50: '2041-10', principalExceedsInterestFrom: '2040-01' },
  prepayment: { trackId: 'fixed', type: 'fixed_unlinked', rate: 4.45, amount: 100000, interestSaved: 239630, feeEstimate: 0, monthsShortened: 59 },
} as unknown as MortgageHealth;

describe('SaleAnalysisPanel', () => {
  it('shows the four break-even answers and the sale breakdown', () => {
    const onEdit = vi.fn();
    render(<SaleAnalysisPanel sale={sale} onEditAssumptions={onEdit} />);
    expect(screen.getAllByText('₪605,454').length).toBeGreaterThan(0);
    expect(screen.getByText('₪2,112,993')).toBeInTheDocument();
    expect(screen.getByText('-22.8% vs today\'s value')).toBeInTheDocument();
    expect(screen.getByText('₪2,829,895')).toBeInTheDocument();
    expect(screen.getByText('Ahead from 2036')).toBeInTheDocument();
    expect(screen.getByText('Still owed for drawdowns to come')).toBeInTheDocument();
    expect(screen.getByText(/Down payment assumed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Assumptions & purchase costs/ }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('offers the CBS price-index value', async () => {
    const onUse = vi.fn().mockResolvedValue(undefined);
    render(<SaleAnalysisPanel sale={sale} onEditAssumptions={vi.fn()} onUsePriceIndex={onUse} />);
    expect(screen.getByText(/\+2.0% from/)).toBeInTheDocument();
    expect(screen.getByText(/worth about ₪2,784,600/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use for my valuation' }));
    expect(onUse).toHaveBeenCalled();
  });
});

describe('MortgageHealthPanel', () => {
  it('shows a verdict per area with the numbers behind it', () => {
    render(<MortgageHealthPanel health={health} />);
    expect(screen.getAllByText('Watch').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText('Good').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('39.9%')).toBeInTheDocument();
    expect(screen.getByText('+₪444')).toBeInTheDocument();
    expect(screen.getByText('74.8%')).toBeInTheDocument();
    expect(screen.getByText(/median of the last 6 months/)).toBeInTheDocument();
    expect(screen.getByText(/save about ₪239,630 in interest and finish it 59 months earlier/)).toBeInTheDocument();
  });
});
