import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

export type HistoryTimeRangeOption = '1d' | '1w' | '1m' | '2m' | '3m' | '6m' | '1y' | 'ytd' | 'all';
export type ViewModeOption = 'summary' | 'detailed';
export type PortfolioChartScopeOption = 'exclude_real_estate' | 'all' | 'liquid' | 'restricted' | 'illiquid';

interface InvestmentsFiltersContextValue {
  historyTimeRange: HistoryTimeRangeOption;
  setHistoryTimeRange: (range: HistoryTimeRangeOption) => void;
  chartScope: PortfolioChartScopeOption;
  setChartScope: (scope: PortfolioChartScopeOption) => void;
  viewMode: ViewModeOption;
  setViewMode: (mode: ViewModeOption) => void;
  refreshTrigger: number;
  triggerRefresh: () => void;
  isRefreshing: boolean;
  setIsRefreshing: (isRefreshing: boolean) => void;
}

const InvestmentsFiltersContext = createContext<InvestmentsFiltersContextValue | undefined>(undefined);

export const InvestmentsFiltersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [historyTimeRange, setHistoryTimeRange] = useState<HistoryTimeRangeOption>('3m');
  const [chartScope, setChartScope] = useState<PortfolioChartScopeOption>('exclude_real_estate');
  const [viewMode, setViewMode] = useState<ViewModeOption>('summary');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const triggerRefresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  const value = useMemo(
    () => ({
      historyTimeRange,
      setHistoryTimeRange,
      chartScope,
      setChartScope,
      viewMode,
      setViewMode,
      refreshTrigger,
      triggerRefresh,
      isRefreshing,
      setIsRefreshing,
    }),
    [historyTimeRange, chartScope, viewMode, refreshTrigger, isRefreshing, triggerRefresh]
  );

  return <InvestmentsFiltersContext.Provider value={value}>{children}</InvestmentsFiltersContext.Provider>;
};

export const useInvestmentsFilters = () => {
  const context = useContext(InvestmentsFiltersContext);
  if (!context) {
    throw new Error('useInvestmentsFilters must be used within a InvestmentsFiltersProvider');
  }
  return context;
};
