import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SmartNotifications from '../SmartNotifications';

const mockGet = vi.fn();
const mockPost = vi.fn();
const showNotification = vi.fn();

const translations: Record<string, string> = {
  'common.close': 'Close',
  'insights.snapshot.alert.title': 'Progress Snapshot',
  'insights.snapshot.alert.message': 'See your progress across completed time periods.',
  'insights.snapshot.alert.action': 'View Snapshot',
  'insights.snapshot.modal.title': 'Progress Snapshot',
  'insights.snapshot.modal.loading': 'Loading snapshot...',
  'insights.snapshot.modal.empty': 'No snapshot data available yet.',
  'insights.snapshot.modal.fetchError': 'Failed to load snapshot progress.',
  'insights.snapshot.modal.currentPeriod': 'Current',
  'insights.snapshot.modal.previousPeriod': 'Previous',
  'insights.snapshot.modal.previousNet': 'Previous net',
  'insights.snapshot.modal.insufficientHistory': 'Insufficient history for a full previous period comparison.',
  'insights.snapshot.modal.notAvailable': 'N/A',
  'insights.snapshot.modal.daysTracked': '{{count}} days tracked',
  'insights.snapshot.periodLabels.week': 'Week',
  'insights.snapshot.periodLabels.month': 'Month',
  'insights.snapshot.periodLabels.2month': '2 Months',
  'insights.snapshot.periodLabels.6month': '6 Months',
  'insights.snapshot.periodLabels.1year': '1 Year',
  'insights.snapshot.periodLabels.sinceStart': 'Since ShekelSync Started',
  'insights.snapshot.metrics.income': 'Income',
  'insights.snapshot.metrics.expenses': 'Expenses',
  'insights.snapshot.metrics.investmentOutflow': 'Investment Outflow',
  'insights.snapshot.metrics.investmentInflow': 'Investment Inflow',
  'insights.snapshot.metrics.net': 'Net',
  'insights.snapshot.metrics.txCount': 'Transactions',
};

vi.mock('@mui/material', () => {
  const component = (tag: any) =>
    ({ children }: { children?: React.ReactNode }) => React.createElement(tag, null, children);

  return {
    Box: component('div'),
    Typography: component('span'),
    Badge: ({ children, badgeContent }: { children?: React.ReactNode; badgeContent?: React.ReactNode }) => (
      <span>
        <span>{badgeContent}</span>
        {children}
      </span>
    ),
    IconButton: ({ children, onClick, 'aria-label': ariaLabel }: { children?: React.ReactNode; onClick?: () => void; 'aria-label'?: string }) => (
      <button onClick={onClick} aria-label={ariaLabel}>
        {children}
      </button>
    ),
    Popover: ({ open, children }: { open: boolean; children?: React.ReactNode }) => (open ? <div>{children}</div> : null),
    List: component('div'),
    ListItem: component('div'),
    Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
      <button onClick={onClick}>
        {children}
      </button>
    ),
    Chip: ({ label }: { label?: React.ReactNode }) => <span>{label}</span>,
    Divider: () => <hr />,
    Alert: component('div'),
    CircularProgress: () => <div role="progressbar" />,
    Tooltip: ({ children, title }: { children: React.ReactElement; title?: React.ReactNode }) => (
      React.cloneElement(children, { 'aria-label': typeof title === 'string' ? title : undefined })
    ),
    Stack: component('div'),
    Avatar: component('div'),
    Tabs: component('div'),
    Tab: ({ label }: { label?: React.ReactNode }) => <button>{label}</button>,
  };
});

vi.mock('@mui/icons-material', () => {
  const icon = (name: string) => () => <span>{name}</span>;

  return {
    Notifications: icon('Notifications'),
    Warning: icon('Warning'),
    Error: icon('Error'),
    Info: icon('Info'),
    TrendingUp: icon('TrendingUp'),
    ShoppingCart: icon('ShoppingCart'),
    Store: icon('Store'),
    MonetizationOn: icon('MonetizationOn'),
    Timeline: icon('Timeline'),
    CheckCircle: icon('CheckCircle'),
    Close: icon('Close'),
    Refresh: icon('Refresh'),
    Sync: icon('Sync'),
    Category: icon('Category'),
    CloudDone: icon('CloudDone'),
    Lightbulb: icon('Lightbulb'),
  };
});

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

vi.mock('../../NotificationContext', () => ({
  useNotification: () => ({ showNotification }),
}));

vi.mock('../InsightsPanel', () => ({
  default: () => <div data-testid="insights-panel" />,
}));

vi.mock('../SnapshotProgressModal', () => ({
  default: ({ open, loading, error, data }: { open: boolean; loading: boolean; error: string | null; data: unknown }) => {
    if (!open) return null;
    if (loading) return <div data-testid="snapshot-modal">loading snapshot</div>;
    if (error) return <div data-testid="snapshot-modal">{error}</div>;
    return <div data-testid="snapshot-modal">{data ? 'snapshot modal open' : 'empty'}</div>;
  },
}));

vi.mock('@renderer/shared/components/LicenseReadOnlyAlert', () => ({
  __esModule: true,
  default: () => null,
  isLicenseReadOnlyError: () => ({ isReadOnly: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'insights.snapshot.modal.daysTracked' && typeof options?.count === 'number') {
        return `${options.count} days tracked`;
      }
      return translations[key] || key;
    },
    i18n: { language: 'en' },
  }),
}));

const baseNotificationsResponse = {
  ok: true,
  data: {
    success: true,
    data: {
      summary: {
        total: 1,
        by_type: {
          budget_warning: 1,
        },
        by_severity: {
          critical: 0,
          warning: 1,
          info: 0,
        },
      },
      notifications: [
        {
          id: 'notif-1',
          type: 'budget_warning',
          severity: 'warning',
          title: 'Budget warning',
          message: 'Groceries budget is at 85%',
          data: {},
          timestamp: '2025-08-20T10:00:00.000Z',
          actionable: false,
        },
      ],
    },
  },
};

const snapshotProgressResponse = {
  ok: true,
  data: {
    success: true,
    data: {
      triggerKey: '2025-08-17',
      generatedAt: '2025-08-20T12:00:00.000Z',
      periods: [
        {
          key: 'week',
          label: 'Week',
          current: {
            start: '2025-08-10',
            end: '2025-08-16',
            income: 1200,
            expenses: 800,
            investmentOutflow: 200,
            investmentInflow: 40,
            net: 240,
            txCount: 9,
          },
          previous: {
            start: '2025-08-03',
            end: '2025-08-09',
            income: 1000,
            expenses: 750,
            investmentOutflow: 100,
            investmentInflow: 0,
            net: 150,
            txCount: 8,
          },
          deltaNet: 90,
          deltaNetPct: 60,
          hasData: true,
        },
      ],
      sinceStart: {
        startDate: '2025-01-15',
        endDate: '2025-08-20',
        daysTracked: 218,
        income: 12000,
        expenses: 9000,
        investmentOutflow: 2500,
        investmentInflow: 900,
        net: 1400,
        txCount: 112,
      },
    },
  },
};

describe('SmartNotifications snapshot flow', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockGet.mockReset();
    mockPost.mockReset();

    mockGet.mockImplementation((endpoint: string) => {
      if (endpoint === '/api/notifications?limit=20') {
        return Promise.resolve(baseNotificationsResponse);
      }
      if (endpoint === '/api/notifications/snapshot-progress') {
        return Promise.resolve(snapshotProgressResponse);
      }
      return Promise.resolve({ ok: true, data: { success: true } });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('injects the synthetic snapshot alert when trigger key is unseen', async () => {
    render(<SmartNotifications />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/notifications?limit=20');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Smart Alerts' }));

    expect(screen.getByText('Progress Snapshot')).toBeInTheDocument();
    expect(screen.getByText('See your progress across completed time periods.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View Snapshot' })).toBeInTheDocument();
  });

  it('writes seen key, opens snapshot modal, and removes synthetic alert after click', async () => {
    render(<SmartNotifications />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/notifications?limit=20');
    });

    const alertsButton = screen.getByRole('button', { name: 'Smart Alerts' });
    fireEvent.click(alertsButton);

    fireEvent.click(screen.getByRole('button', { name: 'View Snapshot' }));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/notifications/snapshot-progress');
    });

    const storedTriggerKey = window.localStorage.getItem('smart_alert.snapshot_seen_trigger_key.v1');
    expect(storedTriggerKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => {
      expect(screen.getByTestId('snapshot-modal')).toHaveTextContent('snapshot modal open');
    });

    fireEvent.click(alertsButton);

    expect(screen.queryByText('See your progress across completed time periods.')).not.toBeInTheDocument();
  });
});
