import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { subDays, addDays, startOfMonth } from 'date-fns';
import { AggregationPeriod } from '@renderer/types/dashboard';

export type DashboardPeriodPreset = 'mtd' | '30d' | 'custom';

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
  /** Forecast is always 30 days ahead from today */
  forecastEndDate: Date;
}

const DashboardFiltersContext = createContext<DashboardFiltersContextValue | undefined>(undefined);

export const DashboardFiltersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [periodPreset, setPeriodPresetState] = useState<DashboardPeriodPreset>('mtd');
  const [startDate, setStartDate] = useState(() => startOfMonth(new Date()));
  const [endDate, setEndDate] = useState(() => new Date());
  const [aggregationPeriod, setAggregationPeriod] = useState<AggregationPeriod>('daily');
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  // Forecast always 30 days ahead from today
  const forecastEndDate = useMemo(() => addDays(new Date(), 30), []);

  const setDateRange = useCallback((start: Date, end: Date) => {
    setStartDate(start);
    setEndDate(end);
    setPeriodPresetState('custom');
  }, []);

  const setPeriodPreset = useCallback((preset: Exclude<DashboardPeriodPreset, 'custom'>) => {
    const now = new Date();
    setPeriodPresetState(preset);
    setStartDate(preset === 'mtd' ? startOfMonth(now) : subDays(now, 30));
    setEndDate(now);
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
