import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TelegramPanel from '../TelegramPanel';

const showNotification = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string; [key: string]: unknown }) =>
      options?.defaultValue ?? _key,
  }),
}));

vi.mock('@renderer/features/notifications/NotificationContext', () => ({
  useNotification: () => ({
    showNotification,
  }),
}));

describe('TelegramPanel', () => {
  beforeEach(() => {
    showNotification.mockReset();
  });

  it('loads Telegram status and saves a bot token', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      settings: {
        telegram: {
          enabled: false,
          deliveryMode: 'both',
          pushOnScheduledSync: true,
          localeMode: 'app',
        },
      },
    });
    const update = vi.fn().mockResolvedValue({
      success: true,
      settings: {
        telegram: {
          enabled: false,
          deliveryMode: 'both',
          pushOnScheduledSync: true,
          localeMode: 'app',
        },
      },
    });
    const getStatus = vi.fn().mockResolvedValue({
      success: true,
      status: {
        enabled: false,
        deliveryMode: 'both',
        pushOnScheduledSync: true,
        configured: true,
        paired: false,
        runtimeActive: false,
        localOnly: true,
        botUsername: 'shekelsync_bot',
      },
    });
    const saveBotToken = vi.fn().mockResolvedValue({
      success: true,
      status: {
        enabled: false,
        deliveryMode: 'both',
        pushOnScheduledSync: true,
        configured: true,
        paired: false,
        runtimeActive: false,
        localOnly: true,
        botUsername: 'shekelsync_bot',
      },
    });

    (window as any).electronAPI = {
      settings: {
        get,
        update,
        onChange: vi.fn(() => vi.fn()),
      },
      telegram: {
        getStatus,
        saveBotToken,
      },
    };

    render(<TelegramPanel />);

    expect(await screen.findByText('Telegram')).toBeInTheDocument();
    expect(await screen.findByText('Bot token saved', {}, { timeout: 15000 })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Telegram Bot Token'), {
      target: { value: '123456:ABC' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Bot Token' }));

    await waitFor(() => {
      expect(saveBotToken).toHaveBeenCalledWith('123456:ABC');
    });
  }, 15000);

  it('shows pairing instructions and can disconnect', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      settings: {
        telegram: {
          enabled: true,
          deliveryMode: 'both',
          pushOnScheduledSync: true,
          localeMode: 'app',
        },
      },
    });
    const update = vi.fn().mockResolvedValue({
      success: true,
      settings: {
        telegram: {
          enabled: true,
          deliveryMode: 'both',
          pushOnScheduledSync: true,
          localeMode: 'app',
        },
      },
    });
    const getStatus = vi.fn().mockResolvedValue({
      success: true,
      status: {
        enabled: true,
        deliveryMode: 'both',
        pushOnScheduledSync: true,
        configured: true,
        paired: true,
        runtimeActive: true,
        localOnly: true,
        botUsername: 'shekelsync_bot',
        chatUsername: 'alice',
      },
    });
    const beginPairing = vi.fn().mockResolvedValue({
      success: true,
      status: {
        enabled: true,
        deliveryMode: 'both',
        pushOnScheduledSync: true,
        configured: true,
        paired: true,
        runtimeActive: true,
        localOnly: true,
        botUsername: 'shekelsync_bot',
        pairingCode: 'ABC123',
        pairingExpiresAt: '2026-03-24T12:05:00.000Z',
        chatUsername: 'alice',
      },
    });
    const disconnect = vi.fn().mockResolvedValue({
      success: true,
      status: {
        enabled: false,
        deliveryMode: 'both',
        pushOnScheduledSync: true,
        configured: false,
        paired: false,
        runtimeActive: false,
        localOnly: true,
      },
    });

    (window as any).electronAPI = {
      settings: {
        get,
        update,
        onChange: vi.fn(() => vi.fn()),
      },
      telegram: {
        getStatus,
        beginPairing,
        disconnect,
      },
    };

    render(<TelegramPanel />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pair Telegram Chat' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Pair Telegram Chat' }));

    await waitFor(() => {
      expect(beginPairing).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => {
      expect(disconnect).toHaveBeenCalled();
    });
  });

  it('warns when scheduled digests are enabled but the app does not stay running in the tray', async () => {
    const get = vi.fn().mockResolvedValue({
      success: true,
      settings: {
        telegram: {
          enabled: true,
          deliveryMode: 'both',
          pushOnScheduledSync: true,
          localeMode: 'app',
        },
      },
    });
    const update = vi.fn().mockResolvedValue({
      success: true,
      settings: {
        telegram: {
          enabled: true,
          deliveryMode: 'both',
          pushOnScheduledSync: true,
          localeMode: 'app',
        },
      },
    });
    const getStatus = vi.fn().mockResolvedValue({
      success: true,
      status: {
        enabled: true,
        deliveryMode: 'both',
        pushOnScheduledSync: true,
        configured: true,
        paired: true,
        runtimeActive: true,
        localOnly: true,
        syncStatus: {
          keepRunningInTray: false,
          backgroundSync: {
            enabled: true,
          },
        },
      },
    });

    (window as any).electronAPI = {
      settings: {
        get,
        update,
        onChange: vi.fn(() => vi.fn()),
      },
      telegram: {
        getStatus,
      },
    };

    render(<TelegramPanel />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'Background sync is enabled but the app is allowed to exit on close. Telegram delivery stops when the app process stops.',
        ),
      ).toBeInTheDocument();
    });
  });
});
