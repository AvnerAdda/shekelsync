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
          },
        ],
      },
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

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(onEditProperty).toHaveBeenCalledWith(11);
  });
});
