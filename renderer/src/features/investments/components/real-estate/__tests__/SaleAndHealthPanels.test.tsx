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
  property: { value: 2020000, ownershipPct: 100, purchasePrice: 2000000, purchaseDate: '2026-08-01' },
  debt: { balance: 1000000, accruedInterest: 2500, undrawn: 500000, prepaymentFees: { tracks: [], operational: 60, total: 1000 }, payoffToday: 1503500 },
  cashInvested: { upfront: 500000, payments: 10000, total: 510000, plannedUpfront: 0 },
  costs: [],
  breakEven: { clearDebtPrice: 1563500, recoverCashPrice: 2073500, clearDebtVsValuePct: -22.6, recoverCashVsValuePct: 2.6 },
  today: { price: 2020000, saleCosts: 60000, capitalGainsTax: 0, mortgagePayoff: 1002500, undrawnCommitment: 500000, prepaymentFees: 1000, netProceeds: 456500, profit: -53500 },
  sensitivity: [{ changePct: -5, price: 1919000, netProceeds: 355500, profit: -154500 }, { changePct: 0, price: 2020000, netProceeds: 456500, profit: -53500 }],
  alternative: {
    points: [
      { year: 2026, date: '2026-11-01', propertyValue: 2020000, ownerWealth: 460000, alternativeWealth: 520000, advantage: -60000 },
      { year: 2040, date: '2040-12-01', propertyValue: 3000000, ownerWealth: 1200000, alternativeWealth: 1100000, advantage: 100000 },
    ],
    advantageToday: -60000,
    crossoverYear: 2036,
    alwaysBehind: false,
    rentConfigured: true,
  },
  breakEvenAppreciationPct10y: 0.95,
  indexedValue: { series: 'cbs.hpi.national', ratio: 1.02, fromPeriod: '2025-01', toPeriod: '2026-07', value: 2040000, purchasePrice: 2000000, purchaseMonth: '2025-01', noDataSincePurchase: false },
} as unknown as SaleAnalysis;

const health = {
  overall: 'watch',
  rates: { verdict: 'good', tracks: [{ trackId: 'fixed', type: 'fixed_unlinked', comparison: 'rate', yours: 4.5, benchmark: 4.75, delta: -0.25, verdict: 'good', benchmarkPeriod: '2026-08' }] },
  exposure: {
    verdict: 'watch', mix: { fixedPct: 40, primePct: 50, variablePct: 10, cpiLinkedPct: 10 }, meetsFixedThird: true,
    steadyMonth: '2027-02', steadyPayment: 7500, perPrimePoint: 300, basePeakPayment: 8000, worstCasePayment: 10000, worstIncreasePct: 33.3,
  },
  affordability: {
    verdict: 'watch', paymentToIncomePct: 37.5, stressedPaymentToIncomePct: 50, regulatoryCapPct: 50, comfortablePct: 30,
    income: { monthly: 20000, method: 'median', monthsWithIncome: 6, months: [], source: 'transactions' },
  },
  equity: { verdict: 'watch', loanToValuePct: 75, priceDropToZeroEquityPct: 25, principalShareOfPaymentPct: 30, ltvBelow60: '2036-12', ltvBelow50: '2041-10', principalExceedsInterestFrom: '2040-01' },
  prepayment: { trackId: 'fixed', type: 'fixed_unlinked', rate: 4.5, amount: 100000, interestSaved: 150000, feeEstimate: 0, monthsShortened: 48 },
} as unknown as MortgageHealth;

describe('SaleAnalysisPanel', () => {
  it('shows the four break-even answers and the sale breakdown', () => {
    const onEdit = vi.fn();
    render(<SaleAnalysisPanel sale={sale} onEditAssumptions={onEdit} />);
    expect(screen.getAllByText('₪456,500').length).toBeGreaterThan(0);
    expect(screen.getByText('₪1,563,500')).toBeInTheDocument();
    expect(screen.getByText('-22.6% vs today\'s value')).toBeInTheDocument();
    expect(screen.getByText('₪2,073,500')).toBeInTheDocument();
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
    expect(screen.getByText(/worth about ₪2,040,000/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use for my valuation' }));
    expect(onUse).toHaveBeenCalled();
  });
});

describe('MortgageHealthPanel', () => {
  it('shows a verdict per area with the numbers behind it', () => {
    render(<MortgageHealthPanel health={health} />);
    expect(screen.getAllByText('Watch').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText('Good').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('37.5%')).toBeInTheDocument();
    expect(screen.getByText('+₪300')).toBeInTheDocument();
    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByText(/median of the last 6 months/)).toBeInTheDocument();
    expect(screen.getByText(/save about ₪150,000 in interest and finish it 48 months earlier/)).toBeInTheDocument();
  });
});
