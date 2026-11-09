import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InvestmentAccountSummary, PortfolioSummary } from '@renderer/types/investments';
import PerformanceCardsSection from '../PerformanceCardsSection';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../InvestmentPerformanceCard', () => ({
  default: ({ account, onClick }: { account: InvestmentAccountSummary; onClick?: (account: InvestmentAccountSummary) => void }) => (
    <button type="button" data-testid={`card-${account.id}`} disabled={!onClick} onClick={() => onClick?.(account)}>
      {account.account_name}
    </button>
  ),
}));

const account = (id: number, account_type: string, investment_category: string): InvestmentAccountSummary => ({
  id, account_name: `${account_type}-${id}`, account_type, investment_category: investment_category as any,
  currency: 'ILS', current_value: 1000, cost_basis: 900,
});

describe('PerformanceCardsSection account clicks', () => {
  it('makes every card except bank balances clickable', () => {
    const accounts = [
      account(7, 'pension', 'restricted'),
      account(6, 'provident', 'restricted'),
      account(3, 'brokerage', 'liquid'),
      account(4, 'savings', 'liquid'),
      account(5, 'real_estate', 'illiquid'),
      account(1, 'bank_balance', 'liquid'),
    ];
    const portfolioData = {
      categoryBuckets: {
        liquid: { accounts: accounts.filter((item) => item.investment_category === 'liquid') },
        restricted: { accounts: accounts.filter((item) => item.investment_category === 'restricted') },
        illiquid: { accounts: accounts.filter((item) => item.investment_category === 'illiquid') },
      },
    } as unknown as PortfolioSummary;
    const onAccountClick = vi.fn();

    render(
      <PerformanceCardsSection
        portfolioData={portfolioData}
        accountHistories={{}}
        categoryFilter="all"
        onCategoryFilterChange={vi.fn()}
        onAccountClick={onAccountClick}
      />,
    );

    for (const id of [7, 6, 3, 4, 5]) {
      expect((screen.getByTestId(`card-${id}`) as HTMLButtonElement).disabled).toBe(false);
    }
    expect((screen.getByTestId('card-1') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId('card-6'));
    expect(onAccountClick).toHaveBeenCalledWith(expect.objectContaining({ id: 6, account_type: 'provident' }));
  });
});
