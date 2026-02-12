import { PortfolioSummary } from '@renderer/types/investments';

export const hasPortfolioAccounts = (
  portfolioData: PortfolioSummary | null | undefined,
): boolean => Boolean(portfolioData && portfolioData.summary.totalAccounts > 0);

export const formatSignedPercent = (value: number, digits = 2): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;

export const formatSignedCurrencyValue = (
  value: number,
  formatter: (amount: number) => string,
): string => {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatter(value)}`;
};
