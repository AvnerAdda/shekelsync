import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AboutPanel from '../AboutPanel';
import {
  BUG_REPORT_URL,
  CONTACT_URL,
  DONATION_OPEN_MODAL_EVENT,
  FEEDBACK_URL,
} from '@renderer/features/support/constants';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.version ? `${key}:${options.version}` : key,
  }),
}));

describe('AboutPanel', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('shows the app version and the about text', () => {
    render(<AboutPanel appVersion="v0.1.40" />);
    expect(screen.getByText('title')).toBeInTheDocument();
    expect(screen.getByText('version:v0.1.40')).toBeInTheDocument();
    expect(screen.getByText('features.sync')).toBeInTheDocument();
  });

  it('opens the contact and feedback links externally', () => {
    render(<AboutPanel appVersion="v1" />);
    fireEvent.click(within(screen.getByTestId('about-contact')).getByRole('button', { name: 'contact.action' }));
    expect(openSpy).toHaveBeenLastCalledWith(CONTACT_URL, '_blank', 'noopener,noreferrer');

    const feedback = within(screen.getByTestId('about-feedback'));
    fireEvent.click(feedback.getByRole('button', { name: 'feedback.action' }));
    expect(openSpy).toHaveBeenLastCalledWith(FEEDBACK_URL, '_blank', 'noopener,noreferrer');
    fireEvent.click(feedback.getByRole('button', { name: 'feedback.bug' }));
    expect(openSpy).toHaveBeenLastCalledWith(BUG_REPORT_URL, '_blank', 'noopener,noreferrer');
  });

  it('opens the existing donation flow for Buy me a coffee', () => {
    const listener = vi.fn();
    window.addEventListener(DONATION_OPEN_MODAL_EVENT, listener);
    render(<AboutPanel appVersion="v1" />);
    fireEvent.click(within(screen.getByTestId('about-coffee')).getByRole('button', { name: 'coffee.action' }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
    window.removeEventListener(DONATION_OPEN_MODAL_EVENT, listener);
  });
});
