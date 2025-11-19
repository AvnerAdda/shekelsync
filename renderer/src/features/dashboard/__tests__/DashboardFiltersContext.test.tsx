import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DashboardFiltersProvider, useDashboardFilters } from '../DashboardFiltersContext';
import { AggregationPeriod } from '@renderer/types/dashboard';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <DashboardFiltersProvider>{children}</DashboardFiltersProvider>
);

describe('DashboardFiltersContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('provides default filter values derived from the current date', () => {
    const { result } = renderHook(() => useDashboardFilters(), { wrapper });
    const { startDate, endDate, aggregationPeriod, hoveredDate } = result.current;

    expect(startDate.getFullYear()).toBe(2024);
    expect(startDate.getMonth()).toBe(2); // March (0-indexed)
    expect(startDate.getDate()).toBe(1);

    expect(endDate.getTime()).toBe(new Date('2024-03-15T12:00:00Z').getTime());
    expect(aggregationPeriod).toBe<AggregationPeriod>('daily');
    expect(hoveredDate).toBeNull();
  });

  it('allows updating date range, aggregation period, and hovered date', () => {
    const { result } = renderHook(() => useDashboardFilters(), { wrapper });
    const newStart = new Date('2024-02-01T00:00:00Z');
    const newEnd = new Date('2024-02-29T23:59:59Z');

    act(() => {
      result.current.setDateRange(newStart, newEnd);
      result.current.setAggregationPeriod('weekly');
      result.current.setHoveredDate('2024-02-14');
    });

    expect(result.current.startDate).toBe(newStart);
    expect(result.current.endDate).toBe(newEnd);
    expect(result.current.aggregationPeriod).toBe<AggregationPeriod>('weekly');
    expect(result.current.hoveredDate).toBe('2024-02-14');
  });

  it('throws a helpful error when used outside the provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useDashboardFilters())).toThrowError(
      'useDashboardFilters must be used within a DashboardFiltersProvider'
    );

    consoleError.mockRestore();
  });
});
