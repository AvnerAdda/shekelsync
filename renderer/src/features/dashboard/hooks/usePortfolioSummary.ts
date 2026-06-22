import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import {
  InvestmentBreakdownEntry,
  InvestmentSummaryResponse,
  PortfolioBreakdownItem,
  PortfolioSummary,
} from '@renderer/types/investments';
import {
  getPortfolioScopeTotal,
  PortfolioScopeKey,
} from '@renderer/features/investments/utils/portfolio-categories';

interface UsePortfolioSummaryResult {
  portfolioValue: number | null;
  liquidPortfolio: PortfolioBreakdownItem[];
  illiquidPortfolio: PortfolioBreakdownItem[];
  restrictedPortfolio: PortfolioBreakdownItem[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

const DASHBOARD_PORTFOLIO_SCOPE: PortfolioScopeKey = 'exclude_real_estate';

function entryMatchesPortfolioScope(
  entry: InvestmentBreakdownEntry,
  scope: PortfolioScopeKey,
): boolean {
  if (scope === 'all') {
    return true;
  }

  if (scope === 'exclude_real_estate') {
    return entry.type !== 'real_estate';
  }

  return entry.category === scope;
}

function getBreakdownValue(entry: InvestmentBreakdownEntry): number {
  return Number(entry.totalValue ?? 0) || 0;
}

export function usePortfolioSummary(): UsePortfolioSummaryResult {
  const [portfolioValue, setPortfolioValue] = useState<number | null>(null);
  const [liquidPortfolio, setLiquidPortfolio] = useState<PortfolioBreakdownItem[]>([]);
  const [illiquidPortfolio, setIlliquidPortfolio] = useState<PortfolioBreakdownItem[]>([]);
  const [restrictedPortfolio, setRestrictedPortfolio] = useState<PortfolioBreakdownItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);

  const fetchSummary = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get('/api/investments/summary');
      if (!response.ok) {
        throw new Error('Failed to fetch portfolio summary');
      }

      const result = response.data as InvestmentSummaryResponse;
      const summary = result?.summary ?? {};
      const breakdownEntries = Array.isArray(result?.breakdown) ? result.breakdown : [];
      const scopedBreakdownEntries = breakdownEntries
        .filter((entry) => entryMatchesPortfolioScope(entry, DASHBOARD_PORTFOLIO_SCOPE));
      const hasAccountRows = Array.isArray(result?.accounts) && result.accounts.length > 0;
      const scopedPortfolioValue = hasAccountRows
        ? getPortfolioScopeTotal(result as unknown as PortfolioSummary, DASHBOARD_PORTFOLIO_SCOPE)
        : scopedBreakdownEntries.reduce((sum, entry) => sum + getBreakdownValue(entry), 0);
      const totalPortfolioValue = scopedBreakdownEntries.length > 0 || hasAccountRows
        ? scopedPortfolioValue
        : Number(summary?.totalPortfolioValue ?? 0);

      const buildItemsForCategory = (category: string): PortfolioBreakdownItem[] => {
        const entries = breakdownEntries.filter((entry) => entry.category === category);
        const categoryTotal = entries.reduce((sum, entry) => sum + getBreakdownValue(entry), 0);

        return entries.map((entry) => {
          const value = getBreakdownValue(entry);

          return {
            name: entry.name || entry.type || 'Unknown',
            value,
            percentage: categoryTotal > 0 ? (value / categoryTotal) * 100 : 0,
            category: entry.category,
          };
        });
      };

      const liquidItems = buildItemsForCategory('liquid');
      const restrictedItems = buildItemsForCategory('restricted');
      const illiquidItems = buildItemsForCategory('illiquid');

      if (requestId !== requestIdRef.current) {
        return;
      }

      setPortfolioValue(totalPortfolioValue);
      setLiquidPortfolio(liquidItems);
      setIlliquidPortfolio(illiquidItems);
      setRestrictedPortfolio(restrictedItems);
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setPortfolioValue(0);
      setLiquidPortfolio([]);
      setIlliquidPortfolio([]);
      setRestrictedPortfolio([]);
      setError(err as Error);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const refresh = useCallback(() => {
    void fetchSummary();
  }, [fetchSummary]);

  return {
    portfolioValue,
    liquidPortfolio,
    illiquidPortfolio,
    restrictedPortfolio,
    loading,
    error,
    refresh,
  };
}
