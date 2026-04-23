import type {
  InvestmentAccountSummary,
  InvestmentCategoryKey,
  PortfolioCategoryBucket,
  PortfolioSummary,
} from '@renderer/types/investments';

export const INVESTMENT_CATEGORY_ORDER: InvestmentCategoryKey[] = [
  'cash',
  'liquid',
  'restricted',
  'stability',
  'other',
];

export function isInvestmentCategoryKey(value: unknown): value is InvestmentCategoryKey {
  return typeof value === 'string'
    && INVESTMENT_CATEGORY_ORDER.includes(value as InvestmentCategoryKey);
}

export function normalizeInvestmentCategory(value: unknown): InvestmentCategoryKey {
  return isInvestmentCategoryKey(value) ? value : 'other';
}

function emptyCategoryBucket(): PortfolioCategoryBucket {
  return {
    totalValue: 0,
    totalCost: 0,
    unrealizedGainLoss: 0,
    roi: 0,
    accountsCount: 0,
    accounts: [],
  };
}

function summarizeAccounts(accounts: InvestmentAccountSummary[]): PortfolioCategoryBucket {
  const totalValue = accounts.reduce((sum, account) => sum + (Number(account.current_value) || 0), 0);
  const totalCost = accounts.reduce((sum, account) => sum + (Number(account.cost_basis) || 0), 0);
  const unrealizedGainLoss = totalValue - totalCost;

  return {
    totalValue,
    totalCost,
    unrealizedGainLoss,
    roi: totalCost > 0 ? (unrealizedGainLoss / totalCost) * 100 : 0,
    accountsCount: accounts.filter((account) => (Number(account.current_value) || 0) > 0).length,
    accounts,
  };
}

function deriveAccountsForCategory(
  portfolio: PortfolioSummary | null | undefined,
  category: InvestmentCategoryKey,
): InvestmentAccountSummary[] {
  const accounts = Array.isArray(portfolio?.accounts) ? portfolio.accounts : [];
  return accounts.filter((account) => normalizeInvestmentCategory(account.investment_category) === category);
}

export function getPortfolioCategoryBucket(
  portfolio: PortfolioSummary | null | undefined,
  category: InvestmentCategoryKey,
): PortfolioCategoryBucket {
  const categoryBucket = portfolio?.categoryBuckets?.[category];
  const fallbackAccounts = deriveAccountsForCategory(portfolio, category);
  const fallbackBucket = summarizeAccounts(fallbackAccounts);

  if (!categoryBucket) {
    return fallbackBucket;
  }

  const accounts = Array.isArray(categoryBucket.accounts) ? categoryBucket.accounts : fallbackAccounts;
  return {
    ...emptyCategoryBucket(),
    ...categoryBucket,
    accounts,
  };
}

export function getPortfolioCategoryBuckets(
  portfolio: PortfolioSummary | null | undefined,
): Array<{ key: InvestmentCategoryKey; bucket: PortfolioCategoryBucket }> {
  return INVESTMENT_CATEGORY_ORDER.map((key) => ({
    key,
    bucket: getPortfolioCategoryBucket(portfolio, key),
  }));
}

export function getOrderedPortfolioAccounts(
  portfolio: PortfolioSummary | null | undefined,
): InvestmentAccountSummary[] {
  return getPortfolioCategoryBuckets(portfolio).flatMap(({ bucket }) => bucket.accounts || []);
}
