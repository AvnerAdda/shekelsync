import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  InvestmentsFiltersProvider,
  useInvestmentsFilters,
} from '../InvestmentsFiltersContext';

const DisplayConsumer = () => {
  const { dateRange, historyTimeRange, viewMode, refreshTrigger, isRefreshing } =
    useInvestmentsFilters();

  return (
    <>
      <span data-testid="dateRange">{dateRange}</span>
      <span data-testid="historyRange">{historyTimeRange}</span>
      <span data-testid="viewMode">{viewMode}</span>
      <span data-testid="refreshTrigger">{refreshTrigger}</span>
      <span data-testid="isRefreshing">{isRefreshing ? 'yes' : 'no'}</span>
    </>
  );
};

const ActionsConsumer = () => {
  const {
    setDateRange,
    setHistoryTimeRange,
    setViewMode,
    triggerRefresh,
    setIsRefreshing,
  } = useInvestmentsFilters();

  return (
    <>
      <button type="button" onClick={() => setDateRange('3m')}>
        set-date
      </button>
      <button type="button" onClick={() => setHistoryTimeRange('1y')}>
        set-history
      </button>
      <button type="button" onClick={() => setViewMode('detailed')}>
        set-view
      </button>
      <button type="button" onClick={triggerRefresh}>
        trigger-refresh
      </button>
      <button type="button" onClick={() => setIsRefreshing(true)}>
        set-refreshing
      </button>
    </>
  );
};

const expectText = (testId: string, value: string) => {
  expect(screen.getByTestId(testId)).toHaveTextContent(value);
};

describe('InvestmentsFiltersContext', () => {
  it('throws when hook is used without provider', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const OrphanConsumer = () => {
      useInvestmentsFilters();
      return null;
    };

    expect(() => render(<OrphanConsumer />)).toThrowError(
      /useInvestmentsFilters must be used within a InvestmentsFiltersProvider/
    );
    consoleErrorSpy.mockRestore();
  });

  it('exposes default filter values and updates via setters', () => {
    render(
      <InvestmentsFiltersProvider>
        <DisplayConsumer />
        <ActionsConsumer />
      </InvestmentsFiltersProvider>
    );

    expectText('dateRange', 'all');
    expectText('historyRange', '3m');
    expectText('viewMode', 'summary');
    expectText('refreshTrigger', '0');
    expectText('isRefreshing', 'no');

    fireEvent.click(screen.getByText('set-date'));
    fireEvent.click(screen.getByText('set-history'));
    fireEvent.click(screen.getByText('set-view'));
    fireEvent.click(screen.getByText('trigger-refresh'));
    fireEvent.click(screen.getByText('set-refreshing'));

    expectText('dateRange', '3m');
    expectText('historyRange', '1y');
    expectText('viewMode', 'detailed');
    expectText('refreshTrigger', '1');
    expectText('isRefreshing', 'yes');
  });
});
