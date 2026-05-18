import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateManager } from '../useUpdateManager';

const showNotification = vi.fn();

vi.mock('@renderer/features/notifications/NotificationContext', () => ({
  useNotification: () => ({
    showNotification,
  }),
}));

type UpdateInfo = {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
  manualInstallUrl?: string | null;
  updateMode?: 'automatic' | 'manual' | 'disabled';
};

type EventCallbacks = {
  checking?: () => void;
  available?: (info: UpdateInfo) => void;
  notAvailable?: (info?: UpdateInfo) => void;
  error?: (error: { message: string }) => void;
  progress?: (progress: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  }) => void;
  downloaded?: (info: UpdateInfo) => void;
};

function setupElectronApi(options?: {
  checkForUpdatesResult?: {
    success: boolean;
    error?: string;
    updateInfo?: UpdateInfo | null;
    isUpdateAvailable?: boolean;
    currentVersion?: string;
    manualInstallUrl?: string | null;
    updateMode?: 'automatic' | 'manual' | 'disabled';
  };
  currentVersion?: string;
  updateMode?: 'automatic' | 'manual' | 'disabled';
  manualInstallUrl?: string | null;
}) {
  const callbacks: EventCallbacks = {};

  const updater = {
    checkForUpdates: vi
      .fn()
      .mockResolvedValue(options?.checkForUpdatesResult ?? { success: true, updateInfo: null }),
    downloadUpdate: vi.fn().mockResolvedValue({ success: true }),
    quitAndInstall: vi.fn().mockResolvedValue({ success: true }),
    openManualUpdatePage: vi.fn().mockResolvedValue({ success: true, url: options?.manualInstallUrl }),
    getUpdateInfo: vi.fn().mockResolvedValue({
      autoUpdateEnabled: true,
      currentVersion: options?.currentVersion ?? '0.1.13',
      platform: 'linux',
      updateMode: options?.updateMode ?? 'automatic',
      manualInstallUrl: options?.manualInstallUrl ?? null,
    }),
  };

  const events = {
    onUpdateCheckingForUpdate: vi.fn((callback: () => void) => {
      callbacks.checking = callback;
      return vi.fn();
    }),
    onUpdateAvailable: vi.fn((callback: (info: UpdateInfo) => void) => {
      callbacks.available = callback;
      return vi.fn();
    }),
    onUpdateNotAvailable: vi.fn((callback: (info?: UpdateInfo) => void) => {
      callbacks.notAvailable = callback;
      return vi.fn();
    }),
    onUpdateError: vi.fn((callback: (error: { message: string }) => void) => {
      callbacks.error = callback;
      return vi.fn();
    }),
    onUpdateDownloadProgress: vi.fn(
      (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => {
        callbacks.progress = callback;
        return vi.fn();
      }
    ),
    onUpdateDownloaded: vi.fn((callback: (info: UpdateInfo) => void) => {
      callbacks.downloaded = callback;
      return vi.fn();
    }),
  };

  (window as any).electronAPI = {
    updater,
    events,
  };

  return { updater, callbacks };
}

describe('useUpdateManager', () => {
  beforeEach(() => {
    showNotification.mockReset();
  });

  it('marks update as not available when manual check returns same version', async () => {
    const { updater } = setupElectronApi({
      currentVersion: '0.1.13',
      checkForUpdatesResult: {
        success: true,
        isUpdateAvailable: false,
        currentVersion: '0.1.13',
        updateInfo: { version: '0.1.13' },
      },
    });

    const { result } = renderHook(() => useUpdateManager());

    await act(async () => {
      await result.current.checkForUpdates();
    });

    await waitFor(() => {
      expect(result.current.updateState.status).toBe('not-available');
    });
    expect(result.current.updateState.updateInfo).toBeNull();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('ignores update-available event when event version matches current version', async () => {
    const { updater, callbacks } = setupElectronApi({
      currentVersion: '0.1.13',
    });

    const { result } = renderHook(() => useUpdateManager());

    await waitFor(() => {
      expect(updater.getUpdateInfo).toHaveBeenCalledTimes(1);
    });

    act(() => {
      callbacks.available?.({ version: '0.1.13' });
    });

    await waitFor(() => {
      expect(result.current.updateState.status).toBe('not-available');
    });
    expect(result.current.updateState.updateInfo).toBeNull();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('keeps newer version update-available event behavior', async () => {
    const { updater, callbacks } = setupElectronApi({
      currentVersion: '0.1.13',
    });

    const { result } = renderHook(() => useUpdateManager());

    await waitFor(() => {
      expect(updater.getUpdateInfo).toHaveBeenCalledTimes(1);
    });

    act(() => {
      callbacks.available?.({ version: '0.1.14' });
    });

    await waitFor(() => {
      expect(result.current.updateState.status).toBe('available');
    });
    expect(result.current.updateState.updateInfo?.version).toBe('0.1.14');
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('opens the manual update page instead of downloading in manual mode', async () => {
    const { updater } = setupElectronApi({
      currentVersion: '0.1.13',
      updateMode: 'manual',
      manualInstallUrl: 'https://github.com/AvnerAdda/shekelsync/releases/latest',
      checkForUpdatesResult: {
        success: true,
        isUpdateAvailable: true,
        currentVersion: '0.1.13',
        updateMode: 'manual',
        manualInstallUrl: 'https://github.com/AvnerAdda/shekelsync/releases/latest',
        updateInfo: {
          version: '0.1.14',
          updateMode: 'manual',
          manualInstallUrl: 'https://github.com/AvnerAdda/shekelsync/releases/latest',
        },
      },
    });

    const { result } = renderHook(() => useUpdateManager());

    await act(async () => {
      await result.current.checkForUpdates();
    });

    await waitFor(() => {
      expect(result.current.updateState.status).toBe('available');
    });

    await act(async () => {
      await result.current.downloadUpdate();
    });

    expect(updater.openManualUpdatePage).toHaveBeenCalledTimes(1);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });
});
