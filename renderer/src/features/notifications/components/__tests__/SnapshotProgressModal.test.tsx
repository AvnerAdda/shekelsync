import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
    IconButton: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
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
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'insights.snapshot.modal.daysTracked' && typeof options?.count === 'number') {
        return `${options.count} days tracked`;
      }
      return translations[key] || key;
    },
    i18n: { language: 'en' },
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
