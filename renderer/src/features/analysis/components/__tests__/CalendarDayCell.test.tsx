import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n, { initializeI18n } from '@renderer/i18n';

import CalendarDayCell from '../CalendarDayCell';

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    formatCurrency: (value: number) => `₪${value}`,
  }),
}));

describe('CalendarDayCell', () => {
  beforeAll(() => {
    initializeI18n('he');
  });

  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('renders overflow text in Hebrew and notifies when clicked', () => {
    const onClick = vi.fn();

    render(
      <CalendarDayCell
        date={new Date('2026-03-10T12:00:00.000Z')}
        currentMonth={new Date('2026-03-01T12:00:00.000Z')}
        maxDayTotal={250}
        onClick={onClick}
        subscriptions={[
          { amount: 50, subscription: { display_name: 'A', category_color: '#111111' } as any },
          { amount: 50, subscription: { display_name: 'B', category_color: '#222222' } as any },
          { amount: 50, subscription: { display_name: 'C', category_color: '#333333' } as any },
          { amount: 50, subscription: { display_name: 'D', category_color: '#444444' } as any },
          { amount: 50, subscription: { display_name: 'E', category_color: '#555555' } as any },
        ]}
      />,
    );

    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('+2 נוספים')).toBeInTheDocument();

    fireEvent.click(screen.getByText('10'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
