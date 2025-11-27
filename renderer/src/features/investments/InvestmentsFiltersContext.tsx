import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

export type DateRangeOption = 'all' | '3m' | '6m' | '1y';
export type HistoryTimeRangeOption = '1m' | '3m' | '6m' | '1y' | 'all';
export type ViewModeOption = 'summary' | 'detailed';

interface InvestmentsFiltersContextValue {
  dateRange: DateRangeOption;
  setDateRange: (range: DateRangeOption) => void;
  historyTimeRange: HistoryTimeRangeOption;
  setHistoryTimeRange: (range: HistoryTimeRangeOption) => void;
  viewMode: ViewModeOption;
  setViewMode: (mode: ViewModeOption) => void;
  refreshTrigger: number;
  triggerRefresh: () => void;
  isRefreshing: boolean;
  setIsRefreshing: (isRefreshing: boolean) => void;
}

const InvestmentsFiltersContext = createContext<InvestmentsFiltersContextValue | undefined>(undefined);

export const InvestmentsFiltersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dateRange, setDateRange] = useState<DateRangeOption>('all');
  const [historyTimeRange, setHistoryTimeRange] = useState<HistoryTimeRangeOption>('3m');
  const [viewMode, setViewMode] = useState<ViewModeOption>('summary');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const triggerRefresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  const value = useMemo(
    () => ({
      dateRange,
      setDateRange,
      historyTimeRange,
      setHistoryTimeRange,
      viewMode,
      setViewMode,
      refreshTrigger,
      triggerRefresh,
      isRefreshing,
      setIsRefreshing,
    }),
    [dateRange, historyTimeRange, viewMode, refreshTrigger, isRefreshing, triggerRefresh]
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

