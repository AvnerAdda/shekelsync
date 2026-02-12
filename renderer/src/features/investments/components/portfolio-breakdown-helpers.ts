import { getInstitutionLabel, type InstitutionMetadata } from '@renderer/shared/components/InstitutionBadge';

// Must match PortfolioHistorySection
export const PORTFOLIO_CHART_COLORS = [
  '#8884d8',
  '#82ca9d',
  '#ffc658',
  '#ff7300',
  '#0088FE',
  '#00C49F',
  '#FFBB28',
  '#FF8042',
  '#a05195',
  '#d45087',
  '#f95d6a',
  '#ff7c43',
  '#ffa600',
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
