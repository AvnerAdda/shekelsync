import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuestsPanel from '../QuestsPanel';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));

vi.mock('@/lib/api-client', () => ({ apiClient: { get: mockGet, post: mockPost } }));
vi.mock('@renderer/i18n/I18nProvider', () => ({ useLocaleSettings: () => ({ locale: 'en' }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({ formatCurrency: (value: number) => String(value) }),
}));

describe('QuestsPanel', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockGet.mockImplementation(async (url: string) => ({
      ok: true,
      data: url.includes('/active') ? {
        quests: Array.from({ length: 5 }, (_, index) => ({
          id: index + 1,
          action_type: 'quest_reduce_spending',
          user_status: 'active',
          title: `Quest ${index + 1}`,
        })),
      } : null,
    }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('moves an accepted quest from proposals to the accepted tab', async () => {
    mockPost.mockResolvedValue({ ok: true, data: { success: true, deadline: '2026-10-01T00:00:00.000Z' } });
    render(<QuestsPanel />);
    const buttons = await screen.findAllByRole('button', { name: 'actions.accept' });
    expect(buttons).toHaveLength(5);

    fireEvent.click(buttons[0]);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'tabs.proposed (4)' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'tabs.accepted (1)' }));
    expect(screen.getByText('Quest 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'actions.verify' })).toBeEnabled();
    expect(mockPost).toHaveBeenCalledWith('/api/analytics/quests/1/accept');
  });

  it.each([
    [{ message: 'Maximum active quests reached (5)' }, 'Maximum active quests reached (5)'],
    [null, 'Failed to accept quest'],
  ])('shows the acceptance failure and restores the button without losing the proposal', async (data, message) => {
    mockPost.mockResolvedValue({ ok: false, status: 409, data });
    render(<QuestsPanel />);
    const buttons = await screen.findAllByRole('button', { name: 'actions.accept' });

    fireEvent.click(buttons[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    await waitFor(() => expect(buttons[0]).toBeEnabled());
    expect(screen.getByRole('tab', { name: 'tabs.proposed (5)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'tabs.accepted (0)' })).toBeInTheDocument();
  });

  it.each([
    ['actions.decline', 'Failed to decline quest'],
    ['actions.generate', 'Failed to generate quests'],
  ])('handles a rejected %s action through the error alert', async (action, message) => {
    mockPost.mockResolvedValue({ ok: false, data: null });
    render(<QuestsPanel />);
    await screen.findAllByRole('button', { name: 'actions.accept' });

    fireEvent.click(screen.getAllByRole('button', { name: action })[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    await waitFor(() => expect(screen.getAllByRole('button', { name: action })[0]).toBeEnabled());
  });
});
