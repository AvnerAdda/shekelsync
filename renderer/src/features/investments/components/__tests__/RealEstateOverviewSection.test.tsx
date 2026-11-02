import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RealEstateOverviewSection from '../RealEstateOverviewSection';

const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mockGet,
  },
}));

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    maskAmounts: false,
    formatCurrency: (value: number) => `₪${value.toLocaleString('en-US')}`,
  }),
}));

vi.mock('react-i18next', () => {
  // Stable like the real i18next `t`, so effects keyed on it don't re-run every render.
  const t = (_key: string, fallback?: string) => fallback;
  return { useTranslation: () => ({ t }) };
});

describe('RealEstateOverviewSection', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  function routeGets(overview: unknown) {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/market-data/snapshot')) {
        return Promise.resolve({
          ok: true,
          data: {
            asOf: '2026-11-01',
            hasData: true,
            policyRate: { value: 3.25, since: '2026-09-03' },
            prime: { value: 4.75 },
            nextDecisionDate: '2026-11-23',
            cpi: { lastPeriod: '2026-09', yearOverYear: 1.6, knownPeriod: '2026-09' },
            inflationExpectation1y: { value: 1.74, period: '2026-10' },
            housePrices: { lastPeriod: '2026-07', yearOverYear: -1.8, newDwellingsYearOverYear: null },
            averageMortgageRates: {},
            series: {},
          },
        });
      }
      return Promise.resolve({ ok: true, data: overview });
    });
  }

  it('renders real estate KPIs and opens the selected property for editing', async () => {
    const onEditProperty = vi.fn();
    routeGets({
        generatedAt: '2026-06-18T12:00:00.000Z',
        valuationSource: 'manual_simulator',
        marketCompsAvailable: false,
        summary: {
          propertyCount: 1,
          propertyMarketValue: 2730000,
          ownedPropertyValue: 2730000,
          netEquity: 682500,
          totalMortgageBalance: 2047500,
          ownedMortgageBalance: 2047500,
          monthlyMortgagePayment: 9500,
          monthlyRent: 0,
          monthlyCashFlow: -9500,
          missingProfiles: 0,
          averageLoanToValue: 75,
          equityRatio: 25,
        },
        properties: [
          {
            accountId: 11,
            accountName: 'Bat Yam apartment',
            currency: 'ILS',
            city: 'Bat Yam',
            neighborhood: 'Kodshei Kahir',
            propertyType: 'apartment',
            ownershipPercentage: 100,
            propertyMarketValue: 2730000,
            ownedPropertyValue: 2730000,
            netEquity: 682500,
            totalMortgageBalance: 2047500,
            ownedMortgageBalance: 2047500,
            monthlyMortgagePayment: 9500,
            mortgageInterestRate: null,
            mortgageTermYears: 30,
            loanToValue: 75,
            equityRatio: 25,
            purchasePrice: 2730000,
            purchaseDate: '2026-05-26',
            valueChange: 0,
            valueChangePercent: 0,
            monthlyRent: null,
            annualExpenses: null,
            monthlyCashFlow: -9500,
            annualDebtService: 114000,
            debtServiceCoverage: 0,
            valuationMethod: 'manual',
            confidence: 'manual',
            lastValuationDate: '2026-06-18',
            scenarioConservative: 2511600,
            scenarioBase: 2730000,
            scenarioOptimistic: 2948400,
            hasProfile: true,
            mortgage: {
              source: 'tracks',
              balance: 1361854,
              nextPayment: 6613,
              nextPaymentDate: '2026-11-10',
              weightedRate: 4.12,
              maturityDate: '2056-09-10',
              drawn: 1363000,
              undrawn: 681500,
              interestPaid: 4700,
              interestRemaining: 1500000,
              indexationToDate: 0,
              totalCost: 1620000,
              tracks: [],
              warnings: [],
            },
          },
        ],
    });

    render(<RealEstateOverviewSection onEditProperty={onEditProperty} />);

    await waitFor(() => {
      expect(screen.getByText('Bat Yam apartment')).toBeInTheDocument();
    });

    expect(screen.getAllByText('₪2,730,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪682,500').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪2,047,500').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪9,500').length).toBeGreaterThan(0);
    expect(screen.getAllByText('75.0%').length).toBeGreaterThan(0);

    // Live market data strip and live mortgage caption.
    await waitFor(() => expect(screen.getByText('4.75%')).toBeInTheDocument());
    expect(screen.getByText('Prime')).toBeInTheDocument();
    expect(screen.getByText('live · {{rate}}%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(onEditProperty).toHaveBeenCalledWith(11);
  });
});
