import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardFiltersProvider, useDashboardFilters } from '../../DashboardFiltersContext';
import DashboardPeriodSelector from '../DashboardPeriodSelector';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      ariaLabel: 'Dashboard period',
      mtd: 'MTD',
      last30: '30D',
      custom: 'Custom',
      startDate: 'Start date',
      endDate: 'End date',
      cancel: 'Cancel',
      apply: 'Apply',
    })[key] || key,
  }),
}));

const SelectedPreset = () => {
  const { periodPreset } = useDashboardFilters();
  return <div data-testid="selected-preset">{periodPreset}</div>;
};

describe('DashboardPeriodSelector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the segmented control and exposes MTD, 30D, and Custom', () => {
    render(
      <DashboardFiltersProvider>
        <DashboardPeriodSelector />
        <SelectedPreset />
      </DashboardFiltersProvider>,
    );

    expect(screen.getByRole('button', { name: 'MTD' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '30D' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '30D' }));
    });

    expect(screen.getByTestId('selected-preset')).toHaveTextContent('30d');
  });

  it('opens the custom date controls and applies the range', () => {
    render(
      <DashboardFiltersProvider>
        <DashboardPeriodSelector />
        <SelectedPreset />
      </DashboardFiltersProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

    expect(screen.getAllByLabelText('Start date').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('End date').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByTestId('selected-preset')).toHaveTextContent('custom');
  });
});
