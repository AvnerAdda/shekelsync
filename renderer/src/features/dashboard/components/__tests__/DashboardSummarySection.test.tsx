import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import DashboardSummarySection from '../DashboardSummarySection';
import { DashboardFiltersProvider } from '../../DashboardFiltersContext';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../SummaryCards', () => ({
  default: () => <div data-testid="summary-cards" />,
}));

function renderSection(summary: any) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <DashboardFiltersProvider>
        <DashboardSummarySection
          data={{ summary }}
          portfolioValue={0}
          liquidPortfolio={[]}
          restrictedPortfolio={[]}
          budgetUsage={0}
          breakdownData={{}}
          hasBankAccounts={true}
          compareToLastMonth={false}
          onToggleCompare={vi.fn()}
        />
      </DashboardFiltersProvider>
    </ThemeProvider>,
  );
}

describe('DashboardSummarySection', () => {
  it('hides the no-income alert when there are transactions (e.g., expenses)', () => {
    renderSection({
      totalIncome: 0,
      totalExpenses: 123,
      netInvestments: 0,
      totalCapitalReturns: 0,
    });

    expect(screen.queryByText('noIncomeTitle')).not.toBeInTheDocument();
  });

  it('shows the no-income alert only when there is no transaction activity', () => {
    renderSection({
      totalIncome: 0,
      totalExpenses: 0,
      netInvestments: 0,
      totalCapitalReturns: 0,
    });

    expect(screen.getByText('noIncomeTitle')).toBeInTheDocument();
  });
});

