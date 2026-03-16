import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n, { initializeI18n } from '@renderer/i18n';

import SubscriptionCalendar from '../SubscriptionCalendar';
import {
  formatSubscriptionCalendarMonthLabel,
  getSubscriptionCalendarWeekdayLabels,
} from '../../utils/subscription-calendar-locale';

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    formatCurrency: (value: number) => `₪${value}`,
  }),
}));

vi.mock('@mui/material', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  return {
    Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Typography: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    IconButton: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>{children}</button>
    ),
    Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>{children}</button>
    ),
    Stack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Skeleton: () => <div>loading-skeleton</div>,
    alpha: () => 'rgba(0, 0, 0, 0.1)',
    useTheme: () => ({
      palette: {
        divider: '#cccccc',
        primary: { main: '#1976d2' },
      },
      breakpoints: {
        down: () => '(max-width:600px)',
      },
    }),
    useMediaQuery: () => false,
  };
});

vi.mock('@mui/icons-material', () => ({
  ChevronLeft: () => <span>prev</span>,
  ChevronRight: () => <span>next</span>,
  Today: () => <span>today</span>,
}));

vi.mock('../CalendarDayCell', () => ({
  default: ({ date }: { date: Date }) => <div data-testid="calendar-day-cell">{date.getDate()}</div>,
}));

vi.mock('../CalendarDayDetail', () => ({
  default: () => null,
}));

describe('SubscriptionCalendar', () => {
  beforeAll(() => {
    initializeI18n('he');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {});

  it('renders the month title and weekday headers in Hebrew', async () => {
    await i18n.changeLanguage('he');
    const now = new Date();

    render(
      <SubscriptionCalendar
        subscriptions={[]}
        loading={false}
        onEdit={() => {}}
      />,
    );

    expect(
      screen.getByText(formatSubscriptionCalendarMonthLabel(now, 'he')),
    ).toBeInTheDocument();

    getSubscriptionCalendarWeekdayLabels('he').forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it('renders the localized month total text when the current month has charges', async () => {
    await i18n.changeLanguage('fr');
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const nextExpectedDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-10`;

    render(
      <SubscriptionCalendar
        subscriptions={[
          {
            id: 1,
            pattern_key: 'netflix',
            display_name: 'Netflix',
            detected_frequency: 'monthly',
            detected_amount: 99,
            amount_is_fixed: 1,
            consistency_score: 0.9,
            user_frequency: null,
            user_amount: null,
            billing_day: 10,
            status: 'active',
            category_definition_id: null,
            category_name: null,
            category_icon: null,
            category_color: '#ff0000',
            parent_category_name: null,
            first_detected_date: nextExpectedDate,
            last_charge_date: nextExpectedDate,
            next_expected_date: nextExpectedDate,
            is_manual: 0,
            notes: null,
            occurrence_count: 3,
            total_spent: 297,
          },
        ]}
        loading={false}
        onEdit={() => {}}
      />,
    );

    expect(screen.getByText('Total : ₪99')).toBeInTheDocument();
  });
});
