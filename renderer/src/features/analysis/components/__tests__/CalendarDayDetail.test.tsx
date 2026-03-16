import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n, { initializeI18n } from '@renderer/i18n';

import CalendarDayDetail from '../CalendarDayDetail';

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    formatCurrency: (value: number) => `₪${value}`,
  }),
}));

vi.mock('@renderer/features/breakdown/components/CategoryIcon', () => ({
  default: ({ iconName }: { iconName: string }) => <span>{iconName}</span>,
}));

vi.mock('@mui/material', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  return {
    Popover: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
    Drawer: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
    Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Typography: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Stack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    IconButton: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>{children}</button>
    ),
    Chip: ({ label }: { label: React.ReactNode }) => <span>{label}</span>,
    Divider: () => <hr />,
    alpha: () => 'rgba(0, 0, 0, 0.1)',
    useTheme: () => ({
      palette: {
        background: { paper: '#ffffff' },
        divider: '#cccccc',
        primary: { main: '#1976d2' },
        common: { black: '#000000' },
      },
      breakpoints: {
        down: () => '(max-width:600px)',
      },
    }),
    useMediaQuery: () => false,
  };
});

vi.mock('@mui/icons-material', () => ({
  Edit: () => <span>edit</span>,
  Close: () => <span>close</span>,
}));

describe('CalendarDayDetail', () => {
  beforeAll(() => {
    initializeI18n('fr');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('renders a localized title and localized frequency chip', () => {
    const onClose = vi.fn();
    const onEdit = vi.fn();

    render(
      <CalendarDayDetail
        open
        anchorEl={document.body}
        date={new Date('2026-03-20T12:00:00.000Z')}
        subscriptions={[
          {
            amount: 99,
            subscription: {
              id: 1,
              pattern_key: 'netflix',
              display_name: 'Netflix',
              detected_frequency: 'monthly',
              detected_amount: 99,
              amount_is_fixed: 1,
              consistency_score: 0.9,
              user_frequency: null,
              user_amount: null,
              billing_day: 20,
              status: 'active',
              category_definition_id: null,
              category_name: null,
              category_icon: 'payments',
              category_color: '#ff0000',
              parent_category_name: null,
              first_detected_date: '2026-01-20',
              last_charge_date: '2026-02-20',
              next_expected_date: '2026-03-20',
              is_manual: 0,
              notes: null,
              occurrence_count: 3,
              total_spent: 297,
            },
          },
        ]}
        onClose={onClose}
        onEdit={onEdit}
      />,
    );

    expect(screen.getByText(/^Frais du /)).toBeInTheDocument();
    expect(screen.getByText('Mensuel')).toBeInTheDocument();
    expect(screen.getByText('₪99')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button').at(-1)!);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
