import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DonationReminderDialog from '../components/DonationReminderDialog';
import { DONATION_OPEN_MODAL_EVENT } from '../constants';
import { createDefaultDonationStatus, getDonationTier } from '../types';

const translations: Record<string, string> = {
  'support.reminder.title': 'Support ShekelSync',
  'support.reminder.message': 'Monthly reminder message',
  'support.reminder.monthlyHint': 'Monthly hint',
  'support.reminder.actions.later': 'Maybe later',
  'support.reminder.actions.donateNow': 'Donate now',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] || key,
  }),
}));

describe('donation helper functions', () => {
  it('maps totals to generic supporter tier', () => {
    expect(getDonationTier(0)).toBe('none');
    expect(getDonationTier(2)).toBe('one_time');
    expect(getDonationTier(5)).toBe('one_time');
    expect(getDonationTier(20)).toBe('one_time');
  });

  it('creates a non-donor reminder default state', () => {
    const status = createDefaultDonationStatus();

    expect(status.hasDonated).toBe(false);
    expect(status.tier).toBe('none');
    expect(status.shouldShowMonthlyReminder).toBe(true);
  });
});

describe('DonationReminderDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls dismiss handler when Maybe later is clicked', async () => {
    const onDismissForMonth = vi.fn().mockResolvedValue(undefined);

    render(
      <DonationReminderDialog
        open
        status={createDefaultDonationStatus()}
        onDismissForMonth={onDismissForMonth}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));

    await waitFor(() => {
      expect(onDismissForMonth).toHaveBeenCalledTimes(1);
    });
  });

  it('opens support modal and marks reminder shown when Donate now is clicked', async () => {
    const onDismissForMonth = vi.fn().mockResolvedValue(undefined);
    const eventListener = vi.fn();
    window.addEventListener(DONATION_OPEN_MODAL_EVENT, eventListener as EventListener);

    render(
      <DonationReminderDialog
        open
        status={createDefaultDonationStatus()}
        onDismissForMonth={onDismissForMonth}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Donate now' }));

    await waitFor(() => {
      expect(onDismissForMonth).toHaveBeenCalledTimes(1);
    });
    expect(eventListener).toHaveBeenCalledTimes(1);

    window.removeEventListener(DONATION_OPEN_MODAL_EVENT, eventListener as EventListener);
  });
});
