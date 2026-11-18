import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { endOfDay, startOfMonth } from 'date-fns';
import { monthsAhead, startOfTrailingMonths } from '@renderer/shared/utils/month-window';
import { AggregationPeriod } from '@renderer/types/dashboard';

export type DashboardPeriodPreset = 'mtd' | '1m' | 'custom';

interface DashboardFiltersContextValue {
  startDate: Date;
  endDate: Date;
  setDateRange: (start: Date, end: Date) => void;
  aggregationPeriod: AggregationPeriod;
  setAggregationPeriod: (period: AggregationPeriod) => void;
  hoveredDate: string | null;
  setHoveredDate: (value: string | null) => void;
  periodPreset: DashboardPeriodPreset;
  setPeriodPreset: (preset: Exclude<DashboardPeriodPreset, 'custom'>) => void;
  /** Forecast always runs one calendar month ahead of today */
  forecastEndDate: Date;
}

const DashboardFiltersContext = createContext<DashboardFiltersContextValue | undefined>(undefined);

export const DashboardFiltersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [periodPreset, setPeriodPresetState] = useState<DashboardPeriodPreset>('mtd');
  const [startDate, setStartDate] = useState(() => startOfMonth(new Date()));
  const [endDate, setEndDate] = useState(() => endOfDay(new Date()));
  const [aggregationPeriod, setAggregationPeriod] = useState<AggregationPeriod>('daily');
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const forecastEndDate = useMemo(() => monthsAhead(new Date()), []);

  const setDateRange = useCallback((start: Date, end: Date) => {
    setStartDate(start);
    setEndDate(end);
    setPeriodPresetState('custom');
    setHoveredDate(null);
  }, []);

  const setPeriodPreset = useCallback((preset: Exclude<DashboardPeriodPreset, 'custom'>) => {
    const now = new Date();
    setPeriodPresetState(preset);
    setStartDate(preset === 'mtd' ? startOfMonth(now) : startOfTrailingMonths(now));
    setEndDate(endOfDay(now));
    setHoveredDate(null);
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
      periodPreset,
      setPeriodPreset,
      forecastEndDate,
    }),
    [
      aggregationPeriod,
      endDate,
      hoveredDate,
      startDate,
      periodPreset,
      setDateRange,
      setPeriodPreset,
      forecastEndDate,
    ]
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
