import { getInstitutionLabel, type InstitutionMetadata } from '@renderer/shared/components/InstitutionBadge';

// Must match PortfolioHistorySection
export const PORTFOLIO_CHART_COLORS = [
  '#3ea54d',
  '#00897B',
  '#e88b78',
  '#F97316',
  '#F4A261',
  '#26A69A',
  '#06B6D4',
  '#78e88b',
  '#EF4444',
  '#14B8A6',
  '#286b33',
  '#6b3328',
  '#F59E0B',
];

export const getPortfolioAccountColor = (
  orderedAccounts: Array<{ id: number }>,
  accountId: number,
  fallbackColor: string,
): string => {
  const index = orderedAccounts.findIndex((account) => account.id === accountId);
  if (index === -1) {
    return fallbackColor;
  }
  return PORTFOLIO_CHART_COLORS[index % PORTFOLIO_CHART_COLORS.length];
};

/**
 * Accounts whose card opens something on click: pikadon details, the
 * property view, or the value-update (new statement) form. Bank balances
 * come from bank sync, so there is nothing to open for them.
 */
export const canOpenPortfolioAccount = (account: { account_type?: string | null }): boolean =>
  Boolean(account.account_type) && account.account_type !== 'bank_balance';

export const calculatePortfolioRoi = (currentValue: number, costBasis: number): number =>
  costBasis > 0 ? ((currentValue - costBasis) / costBasis) * 100 : 0;

export const resolvePortfolioInstitutionName = (institution: unknown, locale: string): string => {
  if (!institution) return '';
  if (typeof institution === 'string') return institution;
  return (
    getInstitutionLabel(institution as InstitutionMetadata, locale) ||
    (institution as InstitutionMetadata).vendor_code ||
    ''
  );
};
