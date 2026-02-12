import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockLanguage = 'en';

const translations: Record<string, string> = {
  'common.close': 'Close',
  'insights.snapshot.modal.title': 'Progress Snapshot',
  'insights.snapshot.modal.loading': 'Loading snapshot...',
  'insights.snapshot.modal.empty': 'No snapshot data available yet.',
  'insights.snapshot.modal.currentPeriod': 'Current',
  'insights.snapshot.modal.previousPeriod': 'Previous',
  'insights.snapshot.modal.previousNet': 'Previous net',
  'insights.snapshot.modal.insufficientHistory': 'Insufficient history for a full previous period comparison.',
  'insights.snapshot.modal.notAvailable': 'N/A',
  'insights.snapshot.periodLabels.week': 'Week',
  'insights.snapshot.periodLabels.month': 'Month',
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
    Alert: component('div'),
    Box: component('div'),
    Card: component('div'),
    CardContent: component('div'),
    Chip: ({ label }: { label: React.ReactNode }) => <span>{label}</span>,
    CircularProgress: () => <div role="progressbar" />,
    Dialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) => (open ? <div>{children}</div> : null),
    DialogContent: component('div'),
    DialogTitle: component('h2'),
    Divider: component('hr'),
    IconButton: ({
      children,
      onClick,
      'aria-label': ariaLabel,
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      'aria-label'?: string;
    }) => (
      <button onClick={onClick} aria-label={ariaLabel}>
        {children}
      </button>
    ),
    Stack: component('div'),
    Typography: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  };
});

vi.mock('@mui/icons-material', () => ({
  ArrowDownward: () => <span>down</span>,
  ArrowUpward: () => <span>up</span>,
  Close: () => <span>close</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown> | string) => {
      if (key === 'insights.snapshot.modal.daysTracked' && typeof options === 'object' && typeof options?.count === 'number') {
        return `${options.count} days tracked`;
      }
      if (typeof options === 'string') {
        return translations[key] || options;
      }
      return translations[key] || key;
    },
    i18n: { language: mockLanguage },
  }),
}));

import SnapshotProgressModal, { SnapshotProgressData } from '../SnapshotProgressModal';

const sampleData: SnapshotProgressData = {
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
        income: 0,
        expenses: 0,
        investmentOutflow: 0,
        investmentInflow: 0,
        net: 0,
        txCount: 0,
      },
      deltaNet: 240,
      deltaNetPct: null,
      hasData: true,
    },
  ],
  sinceStart: {
    startDate: '2025-01-01',
    endDate: '2025-08-20',
    daysTracked: 232,
    income: 20000,
    expenses: 15000,
    investmentOutflow: 3500,
    investmentInflow: 1200,
    net: 2700,
    txCount: 180,
  },
};

describe('SnapshotProgressModal', () => {
  beforeEach(() => {
    mockLanguage = 'en';
  });

  it('renders nothing when dialog is closed', () => {
    render(
      <SnapshotProgressModal
        open={false}
        onClose={() => {}}
        data={sampleData}
        loading={false}
        error={null}
      />,
    );

    expect(screen.queryByText('Progress Snapshot')).not.toBeInTheDocument();
  });

  it('renders loading state', () => {
    render(
      <SnapshotProgressModal
        open
        onClose={() => {}}
        data={null}
        loading
        error={null}
      />,
    );

    expect(screen.getByText('Loading snapshot...')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders empty state when no data is available', () => {
    render(
      <SnapshotProgressModal
        open
        onClose={() => {}}
        data={null}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText('No snapshot data available yet.')).toBeInTheDocument();
  });

  it('renders snapshot cards and insufficient history state', () => {
    render(
      <SnapshotProgressModal
        open
        onClose={() => {}}
        data={sampleData}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText('Progress Snapshot')).toBeInTheDocument();
    expect(screen.getByText('Week')).toBeInTheDocument();
    expect(screen.getByText('Insufficient history for a full previous period comparison.')).toBeInTheDocument();
    expect(screen.getByText('Since ShekelSync Started')).toBeInTheDocument();
    expect(screen.getByText(/N\/A/)).toBeInTheDocument();
  });

  it('renders custom ranges and negative deltas without insufficient history', () => {
    const customData: SnapshotProgressData = {
      ...sampleData,
      periods: [
        {
          ...sampleData.periods[0],
          current: {
            ...sampleData.periods[0].current,
            range: 'Custom Current',
            net: -120,
          },
          previous: {
            ...sampleData.periods[0].previous,
            range: 'Custom Previous',
            txCount: 7,
            net: 300,
          },
          deltaNet: -420,
          deltaNetPct: -58.3,
        },
      ],
    };

    render(
      <SnapshotProgressModal
        open
        onClose={() => {}}
        data={customData}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText(/Custom Current/)).toBeInTheDocument();
    expect(screen.getByText(/Custom Previous/)).toBeInTheDocument();
    expect(screen.getByText(/-58\.3%/)).toBeInTheDocument();
    expect(screen.queryByText('Insufficient history for a full previous period comparison.')).not.toBeInTheDocument();
  });

  it('invokes onClose when close button is clicked', () => {
    const onClose = vi.fn();

    render(
      <SnapshotProgressModal
        open
        onClose={onClose}
        data={sampleData}
        loading={false}
        error={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('formats currency using french locale branch', () => {
    mockLanguage = 'fr';

    const data: SnapshotProgressData = {
      ...sampleData,
      periods: [
        {
          ...sampleData.periods[0],
          deltaNet: 1000,
          deltaNetPct: 10,
          previous: {
            ...sampleData.periods[0].previous,
            txCount: 1,
          },
        },
      ],
    };

    render(
      <SnapshotProgressModal
        open
        onClose={() => {}}
        data={data}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getAllByText(/₪/).length).toBeGreaterThan(0);
  });

  it('renders fetch error state', () => {
    render(
      <SnapshotProgressModal
        open
        onClose={() => {}}
        data={null}
        loading={false}
        error="Request failed"
      />,
    );

    expect(screen.getByText('Request failed')).toBeInTheDocument();
  });
});
