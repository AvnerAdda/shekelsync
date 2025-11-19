import React, { createContext, useContext, useMemo, useState } from 'react';
import { startOfMonth } from 'date-fns';
import { AggregationPeriod } from '@renderer/types/dashboard';

interface DashboardFiltersContextValue {
  startDate: Date;
  endDate: Date;
  setDateRange: (start: Date, end: Date) => void;
  aggregationPeriod: AggregationPeriod;
  setAggregationPeriod: (period: AggregationPeriod) => void;
  hoveredDate: string | null;
  setHoveredDate: (value: string | null) => void;
}

const DashboardFiltersContext = createContext<DashboardFiltersContextValue | undefined>(undefined);

export const DashboardFiltersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [startDate, setStartDate] = useState(() => startOfMonth(new Date()));
  const [endDate, setEndDate] = useState(() => new Date());
  const [aggregationPeriod, setAggregationPeriod] = useState<AggregationPeriod>('daily');
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const setDateRange = (start: Date, end: Date) => {
    setStartDate(start);
    setEndDate(end);
  };

  const value = useMemo(
    () => ({
      startDate,
      endDate,
      setDateRange,
      aggregationPeriod,
      setAggregationPeriod,
      hoveredDate,
      setHoveredDate,
    }),
    [aggregationPeriod, endDate, hoveredDate, startDate]
  );

  return <DashboardFiltersContext.Provider value={value}>{children}</DashboardFiltersContext.Provider>;
};

export const useDashboardFilters = () => {
  const context = useContext(DashboardFiltersContext);
  if (!context) {
    throw new Error('useDashboardFilters must be used within a DashboardFiltersProvider');
  }
  return context;
};
