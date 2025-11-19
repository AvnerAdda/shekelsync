import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import {
  InvestmentSummaryResponse,
  PortfolioBreakdownItem,
} from '@renderer/types/investments';

interface UsePortfolioSummaryResult {
  portfolioValue: number | null;
  liquidPortfolio: PortfolioBreakdownItem[];
  restrictedPortfolio: PortfolioBreakdownItem[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function usePortfolioSummary(): UsePortfolioSummaryResult {
  const [portfolioValue, setPortfolioValue] = useState<number | null>(null);
  const [liquidPortfolio, setLiquidPortfolio] = useState<PortfolioBreakdownItem[]>([]);
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
      const totalPortfolioValue = Number(summary?.totalPortfolioValue ?? 0);

      const breakdownEntries = Array.isArray(result?.breakdown) ? result.breakdown : [];
      const liquidTotal = Number(summary?.liquid?.totalValue ?? 0);
      const restrictedTotal = Number(summary?.restricted?.totalValue ?? 0);

      const liquidItems: PortfolioBreakdownItem[] = breakdownEntries
        .filter((entry) => entry.category === 'liquid')
        .map((entry) => ({
          name: entry.name || entry.type || 'Unknown',
          value: entry.totalValue,
          percentage: liquidTotal > 0 ? (entry.totalValue / liquidTotal) * 100 : 0,
          category: entry.category,
        }));

      const restrictedItems: PortfolioBreakdownItem[] = breakdownEntries
        .filter((entry) => entry.category === 'restricted')
        .map((entry) => ({
          name: entry.name || entry.type || 'Unknown',
          value: entry.totalValue,
          percentage: restrictedTotal > 0 ? (entry.totalValue / restrictedTotal) * 100 : 0,
          category: entry.category,
        }));

      if (requestId !== requestIdRef.current) {
        return;
      }

      setPortfolioValue(totalPortfolioValue);
      setLiquidPortfolio(liquidItems);
      setRestrictedPortfolio(restrictedItems);
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setPortfolioValue(0);
      setLiquidPortfolio([]);
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
    restrictedPortfolio,
    loading,
    error,
    refresh,
  };
}
