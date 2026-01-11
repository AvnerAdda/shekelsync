import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { subDays, addDays } from 'date-fns';
import { AggregationPeriod } from '@renderer/types/dashboard';

export type PeriodDays = 30 | 60 | 90;

interface DashboardFiltersContextValue {
  startDate: Date;
  endDate: Date;
  setDateRange: (start: Date, end: Date) => void;
  aggregationPeriod: AggregationPeriod;
  setAggregationPeriod: (period: AggregationPeriod) => void;
  hoveredDate: string | null;
  setHoveredDate: (value: string | null) => void;
  /** Number of days to look back for historical data */
  periodDays: PeriodDays;
  setPeriodDays: (days: PeriodDays) => void;
  /** Forecast is always 30 days ahead from today */
  forecastEndDate: Date;
}

const DashboardFiltersContext = createContext<DashboardFiltersContextValue | undefined>(undefined);

export const DashboardFiltersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [periodDays, setPeriodDaysState] = useState<PeriodDays>(30);
  const [startDate, setStartDate] = useState(() => subDays(new Date(), 30));
  const [endDate, setEndDate] = useState(() => new Date());
  const [aggregationPeriod, setAggregationPeriod] = useState<AggregationPeriod>('daily');
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  // Forecast always 30 days ahead from today
  const forecastEndDate = useMemo(() => addDays(new Date(), 30), []);

  const setDateRange = (start: Date, end: Date) => {
    setStartDate(start);
    setEndDate(end);
  };

  const setPeriodDays = useCallback((days: PeriodDays) => {
    setPeriodDaysState(days);
    setStartDate(subDays(new Date(), days));
    setEndDate(new Date());
  }, []);

  const value = useMemo(
    () => ({
      startDate,
      endDate,
      setDateRange,
      aggregationPeriod,
      setAggregationPeriod,
      hoveredDate,
      setHoveredDate,
      periodDays,
      setPeriodDays,
      forecastEndDate,
    }),
    [aggregationPeriod, endDate, hoveredDate, startDate, periodDays, setPeriodDays, forecastEndDate]
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
