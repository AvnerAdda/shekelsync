import { useState, useEffect, useCallback, useRef } from 'react';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import type { UpdateState, UpdateInfo } from '../components/UpdateButton';

interface UpdateProgressInfo {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

interface UpdateCheckResult {
  success: boolean;
  error?: string;
  updateInfo?: UpdateInfo;
}

interface UpdateActionResult {
  success: boolean;
  error?: string;
}

interface UpdateManagerReturn {
  updateState: UpdateState;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  isUpdateAvailable: boolean;
  isUpdateReady: boolean;
}

export const useUpdateManager = (): UpdateManagerReturn => {
  const [updateState, setUpdateState] = useState<UpdateState>({
    status: 'idle',
    updateInfo: null,
    downloadProgress: 0,
    error: null,
  });

  const cleanupRef = useRef<Array<() => void>>([]);
  const { showNotification } = useNotification();

  // Helper function to safely call electron APIs
  const safeElectronCall = useCallback(async <T,>(
    operation: () => Promise<T>,
    fallback?: T
  ): Promise<T | undefined> => {
    if (typeof window === 'undefined' || !window.electronAPI?.updater) {
      return fallback;
    }
    try {
      return await operation();
    } catch (error) {
      console.error('Electron API call failed:', error);
      return fallback;
    }
  }, []);

  // Check for updates manually
  const checkForUpdates = useCallback(async () => {
    setUpdateState(prev => ({ ...prev, status: 'checking', error: null }));

    const updaterApi = typeof window === 'undefined' ? undefined : window.electronAPI?.updater;
    if (!updaterApi?.checkForUpdates) {
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        error: 'Auto-updater not available',
      }));
      return;
    }
    const checkForUpdatesFn = updaterApi.checkForUpdates;

    const result = await safeElectronCall<UpdateCheckResult>(
      () => checkForUpdatesFn(),
      { success: false, error: 'Auto-updater not available' }
    );

    if (result?.success && result.updateInfo) {
      setUpdateState(prev => ({
        ...prev,
        status: 'available',
        updateInfo: result.updateInfo ?? null,
      }));
    } else if (result?.success && !result.updateInfo) {
      setUpdateState(prev => ({ 
        ...prev, 
        status: 'not-available',
        error: null,
      }));
    } else {
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        error: result?.error || 'Failed to check for updates',
      }));
    }
  }, [safeElectronCall]);

  // Download update
  const downloadUpdate = useCallback(async () => {
    if (updateState.status !== 'available') {
      return;
    }

    setUpdateState(prev => ({ ...prev, status: 'downloading', downloadProgress: 0 }));

    const updaterApi = typeof window === 'undefined' ? undefined : window.electronAPI?.updater;
    if (!updaterApi?.downloadUpdate) {
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        error: 'Auto-updater not available',
      }));
      return;
    }
    const downloadUpdateFn = updaterApi.downloadUpdate;

    const result = await safeElectronCall<UpdateActionResult>(
      () => downloadUpdateFn(),
      { success: false, error: 'Auto-updater not available' }
    );

    if (!result?.success) {
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        error: result?.error || 'Failed to download update',
      }));
    }
  }, [updateState.status, safeElectronCall]);

  // Install update and restart
  const installUpdate = useCallback(async () => {
    if (updateState.status !== 'downloaded') {
      return;
    }

    const updaterApi = typeof window === 'undefined' ? undefined : window.electronAPI?.updater;
    if (!updaterApi?.quitAndInstall) {
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        error: 'Auto-updater not available',
      }));
      return;
    }
    const quitAndInstallFn = updaterApi.quitAndInstall;

    const result = await safeElectronCall<UpdateActionResult>(
      () => quitAndInstallFn(),
      { success: false, error: 'Auto-updater not available' }
    );

    if (!result?.success) {
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        error: result?.error || 'Failed to install update',
      }));
    }
  }, [updateState.status, safeElectronCall]);

  // Set up event listeners
  useEffect(() => {
    const eventsApi = typeof window === 'undefined' ? undefined : window.electronAPI?.events;
    if (!eventsApi) {
      return;
    }

    const cleanup: Array<() => void> = [];

    // Checking for update
    if (eventsApi.onUpdateCheckingForUpdate) {
      const unsubscribe = eventsApi.onUpdateCheckingForUpdate(() => {
        setUpdateState(prev => ({ ...prev, status: 'checking', error: null }));
      });
      if (typeof unsubscribe === 'function') {
        cleanup.push(unsubscribe);
      }
    }

    // Update available
    if (eventsApi.onUpdateAvailable) {
      const unsubscribe = eventsApi.onUpdateAvailable((info: UpdateInfo) => {
        setUpdateState(prev => ({
          ...prev,
          status: 'available',
          updateInfo: info,
          error: null,
        }));
        showNotification(
          `Update available: v${info.version}. Click the update button to download.`,
          'info'
        );
      });
      if (typeof unsubscribe === 'function') {
        cleanup.push(unsubscribe);
      }
    }

    // Update not available
    if (eventsApi.onUpdateNotAvailable) {
      const unsubscribe = eventsApi.onUpdateNotAvailable(() => {
        setUpdateState(prev => ({ 
          ...prev, 
          status: 'not-available',
          error: null,
        }));
      });
      if (typeof unsubscribe === 'function') {
        cleanup.push(unsubscribe);
      }
    }

    // Update error
    if (eventsApi.onUpdateError) {
      const unsubscribe = eventsApi.onUpdateError((errorInfo: { message: string }) => {
        setUpdateState(prev => ({
          ...prev,
          status: 'error',
          error: errorInfo.message,
        }));
        showNotification(
          `Update check failed: ${errorInfo.message}`,
          'error'
        );
      });
      if (typeof unsubscribe === 'function') {
        cleanup.push(unsubscribe);
      }
    }

    // Download progress
    if (eventsApi.onUpdateDownloadProgress) {
      const unsubscribe = eventsApi.onUpdateDownloadProgress((progress: UpdateProgressInfo) => {
        setUpdateState(prev => ({
          ...prev,
          status: 'downloading',
          downloadProgress: progress.percent,
        }));
      });
      if (typeof unsubscribe === 'function') {
        cleanup.push(unsubscribe);
      }
    }

    // Update downloaded
    if (eventsApi.onUpdateDownloaded) {
      const unsubscribe = eventsApi.onUpdateDownloaded((info: UpdateInfo) => {
        setUpdateState(prev => ({
          ...prev,
          status: 'downloaded',
          updateInfo: { ...prev.updateInfo, ...info },
          downloadProgress: 100,
        }));
        showNotification(
          `Update v${info.version} is ready to install. Click the update button to restart and apply.`,
          'success'
        );
      });
      if (typeof unsubscribe === 'function') {
        cleanup.push(unsubscribe);
      }
    }

    // Store cleanup functions
    cleanupRef.current = cleanup;

    return () => {
      cleanup.forEach(fn => fn());
      cleanupRef.current = [];
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current.forEach(fn => fn());
    };
  }, []);

  // Derived state
  const isUpdateAvailable = updateState.status === 'available';
  const isUpdateReady = updateState.status === 'downloaded';

  return {
    updateState,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    isUpdateAvailable,
    isUpdateReady,
  };
};
