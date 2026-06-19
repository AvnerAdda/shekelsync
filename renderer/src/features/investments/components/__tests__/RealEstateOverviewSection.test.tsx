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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback,
  }),
}));

describe('RealEstateOverviewSection', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('renders real estate KPIs and opens the selected property for editing', async () => {
    const onEditProperty = vi.fn();
    mockGet.mockResolvedValue({
      ok: true,
      data: {
        generatedAt: '2026-06-18T12:00:00.000Z',
        valuationSource: 'manual_simulator',
        marketCompsAvailable: false,
        summary: {
          propertyCount: 1,
          propertyMarketValue: 2000000,
          ownedPropertyValue: 2000000,
          netEquity: 500000,
          totalMortgageBalance: 1500000,
          ownedMortgageBalance: 1500000,
          monthlyMortgagePayment: 7500,
          monthlyRent: 0,
          monthlyCashFlow: -7500,
          missingProfiles: 0,
          averageLoanToValue: 75,
          equityRatio: 25,
        },
        properties: [
          {
            accountId: 11,
            accountName: 'Example apartment',
            currency: 'ILS',
            city: 'Example City',
            neighborhood: 'Example Neighborhood',
            propertyType: 'apartment',
            ownershipPercentage: 100,
            propertyMarketValue: 2000000,
            ownedPropertyValue: 2000000,
            netEquity: 500000,
            totalMortgageBalance: 1500000,
            ownedMortgageBalance: 1500000,
            monthlyMortgagePayment: 7500,
            mortgageInterestRate: null,
            mortgageTermYears: 30,
            loanToValue: 75,
            equityRatio: 25,
            purchasePrice: 2000000,
            purchaseDate: '2026-05-26',
            valueChange: 0,
            valueChangePercent: 0,
            monthlyRent: null,
            annualExpenses: null,
            monthlyCashFlow: -7500,
            annualDebtService: 90000,
            debtServiceCoverage: 0,
            valuationMethod: 'manual',
            confidence: 'manual',
            lastValuationDate: '2026-06-18',
            scenarioConservative: 1840000,
            scenarioBase: 2000000,
            scenarioOptimistic: 2160000,
            hasProfile: true,
          },
        ],
      },
    });

    render(<RealEstateOverviewSection onEditProperty={onEditProperty} />);

    await waitFor(() => {
      expect(screen.getByText('Example apartment')).toBeInTheDocument();
    });

    expect(screen.getAllByText('₪2,000,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪500,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪1,500,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₪7,500').length).toBeGreaterThan(0);
    expect(screen.getAllByText('75.0%').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(onEditProperty).toHaveBeenCalledWith(11);
  });
});
