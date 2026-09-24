import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpendingTimelineResponse } from '@renderer/types/spending-categories';
import RollingAllocationPanel from '../RollingAllocationPanel';

const { mockGet, filters } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  filters: { startDate: new Date(2026, 8, 1), endDate: new Date(2026, 8, 3), aggregationPeriod: 'monthly' },
}));
vi.mock('@renderer/lib/api-client', () => ({ apiClient: { get: mockGet } }));
vi.mock('../../DashboardFiltersContext', () => ({ useDashboardFilters: () => filters }));
vi.mock('@app/contexts/FinancePrivacyContext', () => ({ useFinancePrivacy: () => ({ formatCurrency: (value: number) => `₪${value}` }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/features/analysis/components/SpendingTimeline', () => ({
  default: ({ points, splitBySpendingType }: { points: { date: string }[]; splitBySpendingType: boolean }) => (
    <div data-testid="timeline" data-split={String(splitBySpendingType)}>{points.map((point) => point.date).join(',')}</div>
  ),
}));

function responseFor(url: string) {
  const params = new URL(url, 'http://localhost').searchParams;
  const start = params.get('startDate')!;
  const end = params.get('endDate')!;
  const amounts = { essential: 50, growth: 40, stability: 5, reward: 5, unallocated: 0 };
  const data: SpendingTimelineResponse = {
    period: { start, end, rolling_days: 30, history_start: start },
    targets: { essential: 50, growth: 20, stability: 15, reward: 15 },
    categories_by_allocation: { essential: [], growth: [], stability: [], reward: [], unallocated: [] },
    points: [...new Set([start, end])].map((date) => ({
      date, window_start: start, income: 100, expenses: 70, net: 30, surplus: 30, deficit: 0, has_income: true,
      expense_amounts: { ...amounts, growth: 10 }, allocation_amounts: amounts, percentages: amounts, transaction_counts: amounts,
    })),
  };
  return { ok: true, data };
}

describe('RollingAllocationPanel', () => {
  beforeEach(() => {
    filters.startDate = new Date(2026, 8, 1);
    filters.endDate = new Date(2026, 8, 3);
    mockGet.mockReset().mockImplementation(async (url: string) => responseFor(url));
  });

  it('uses dashboard calendar dates and a fixed 30-day window, independent of aggregation and split', async () => {
    render(<RollingAllocationPanel />);
    await screen.findByTestId('timeline');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/spending-categories/timeline?rollingDays=30&startDate=2026-09-01&endDate=2026-09-03', { cacheMode: 'no-store' });
    expect(screen.getByTestId('timeline')).toHaveAttribute('data-split', 'true');
    fireEvent.click(screen.getByRole('switch', { name: 'timeline.splitBySpendingType' }));
    expect(screen.getByTestId('timeline')).toHaveAttribute('data-split', 'false');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('keeps long custom periods intact across bounded requests with no duplicate dates', async () => {
    filters.startDate = new Date(2025, 0, 1);
    render(<RollingAllocationPanel />);
    await screen.findByTestId('timeline');
    const ranges = mockGet.mock.calls.map(([url]) => new URL(url, 'http://localhost').searchParams);
    expect(ranges.map((params) => [params.get('startDate'), params.get('endDate')])).toEqual([
      ['2025-01-01', '2026-01-01'], ['2026-01-02', '2026-09-03'],
    ]);
    expect(screen.getByTestId('timeline')).toHaveTextContent('2025-01-01,2026-01-01,2026-01-02,2026-09-03');
  });

  it('ignores stale requests after the dashboard period changes and refreshes on data changes', async () => {
    let resolveOld!: (value: ReturnType<typeof responseFor>) => void;
    mockGet.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { rerender } = render(<RollingAllocationPanel />);
    const oldUrl = mockGet.mock.calls[0][0];
    filters.startDate = new Date(2026, 7, 5);
    rerender(<RollingAllocationPanel />);
    await screen.findByTestId('timeline');
    await act(async () => { resolveOld(responseFor(oldUrl)); });
    expect(screen.getByTestId('timeline')).toHaveTextContent('2026-08-05,2026-09-03');
    act(() => { window.dispatchEvent(new Event('dataRefresh')); });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3));
    await screen.findByTestId('timeline');
  });

  it('offers retry after a failed request without displaying stale data', async () => {
    mockGet.mockResolvedValueOnce({ ok: false });
    render(<RollingAllocationPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('timeline.error');
    expect(screen.queryByTestId('timeline')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'timeline.retry' }));
    await screen.findByTestId('timeline');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
