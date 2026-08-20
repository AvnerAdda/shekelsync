const INVESTMENT_TAB_INDEX_BY_ROUTE: Readonly<Record<string, number>> = Object.freeze({
  overview: 0,
  holdings: 1,
  'real-estate': 2,
  performance: 3,
  history: 4,
});

export function resolveInvestmentTabFromSearch(search: string): number | null {
  const requestedTab = new URLSearchParams(search).get('tab')?.trim().toLowerCase();
  if (!requestedTab) return null;
  return INVESTMENT_TAB_INDEX_BY_ROUTE[requestedTab] ?? null;
}
