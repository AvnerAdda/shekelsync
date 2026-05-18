import { useState, useEffect, useCallback, useRef } from 'react';
import { useNotification } from '@renderer/features/notifications/NotificationContext';
import type { UpdateState, UpdateInfo } from '../components/UpdateButton';

type UpdateMode = 'automatic' | 'manual' | 'disabled';

interface UpdateProgressInfo {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

interface UpdateCheckResult {
  success: boolean;
  error?: string;
  updateInfo?: UpdateInfo | null;
  isUpdateAvailable?: boolean;
  currentVersion?: string;
  manualInstallUrl?: string | null;
  updateMode?: UpdateMode;
}

interface UpdateActionResult {
  success: boolean;
  error?: string;
  url?: string;
  manualInstallUrl?: string | null;
  updateMode?: UpdateMode;
}

interface UpdateRuntimeInfo {
  autoUpdateEnabled: boolean;
  currentVersion: string;
  platform: string;
  manualInstallUrl?: string | null;
  updateMode?: UpdateMode;
  reason?: string | null;
}

interface UpdateManagerReturn {
  updateState: UpdateState;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  openManualUpdatePage: () => Promise<void>;
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
    updateMode: 'automatic',
    manualInstallUrl: null,
  });

  const cleanupRef = useRef<Array<() => void>>([]);
  const currentVersionRef = useRef<string | null>(null);
  const updateModeRef = useRef<UpdateMode>('automatic');
  const manualInstallUrlRef = useRef<string | null>(null);
  const { showNotification } = useNotification();

  const normalizeVersion = useCallback((version?: string): string => {
    if (typeof version !== 'string') {
      return '';
    }
    return version.trim().toLowerCase().replace(/^v/, '').split('+')[0];
  }, []);

  const isSameVersion = useCallback(
    (left?: string | null, right?: string | null): boolean => {
      const normalizedLeft = normalizeVersion(left ?? '');
      const normalizedRight = normalizeVersion(right ?? '');
      return Boolean(normalizedLeft && normalizedRight) && normalizedLeft === normalizedRight;
    },
    [normalizeVersion]
  );

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

  const applyRuntimeUpdateInfo = useCallback((info?: {
    updateMode?: UpdateMode;
    manualInstallUrl?: string | null;
    currentVersion?: string;
  } | null) => {
    if (!info) {
      return;
    }

    if (info.currentVersion) {
      currentVersionRef.current = info.currentVersion;
    }

    if (info.updateMode) {
      updateModeRef.current = info.updateMode;
    }

    if (typeof info.manualInstallUrl !== 'undefined') {
      manualInstallUrlRef.current = info.manualInstallUrl ?? null;
    }

    setUpdateState(prev => ({
      ...prev,
      updateMode: info.updateMode ?? prev.updateMode,
      manualInstallUrl:
        typeof info.manualInstallUrl !== 'undefined'
          ? info.manualInstallUrl ?? null
          : prev.manualInstallUrl,
    }));
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

    if (result?.currentVersion) {
      currentVersionRef.current = result.currentVersion;
    }

    applyRuntimeUpdateInfo(result);

    const inferredAvailability =
      Boolean(result?.updateInfo?.version) &&
      !isSameVersion(result?.currentVersion ?? currentVersionRef.current, result?.updateInfo?.version);
    const isUpdateAvailable = result?.isUpdateAvailable ?? inferredAvailability;
    const updateMode = result?.updateMode ?? updateModeRef.current;
    const manualInstallUrl =
      result?.manualInstallUrl ?? result?.updateInfo?.manualInstallUrl ?? manualInstallUrlRef.current;

    const availableUpdateInfo = result?.updateInfo;
    if (result?.success && isUpdateAvailable && availableUpdateInfo?.version) {
      setUpdateState(prev => ({
        ...prev,
        status: 'available',
        updateInfo: {
          ...availableUpdateInfo,
          version: availableUpdateInfo.version,
          updateMode,
          manualInstallUrl,
        },
        updateMode,
        manualInstallUrl,
      }));
    } else if (result?.success) {
      setUpdateState(prev => ({ 
        ...prev, 
        status: 'not-available',
        updateInfo: null,
        updateMode,
        manualInstallUrl,
        error: null,
      }));
    } else {
      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        error: result?.error || 'Failed to check for updates',
      }));
    }
  }, [safeElectronCall, isSameVersion, applyRuntimeUpdateInfo]);

  const openManualUpdatePage = useCallback(async () => {
    if (updateState.status !== 'available') {
      return;
    }

    const updaterApi = typeof window === 'undefined' ? undefined : window.electronAPI?.updater;
    if (!updaterApi?.openManualUpdatePage) {
      const fallbackUrl = updateState.manualInstallUrl ?? updateState.updateInfo?.manualInstallUrl;
      if (fallbackUrl) {
        window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
        return;
      }

      setUpdateState(prev => ({
        ...prev,
        status: 'error',
        error: 'Manual update page is not available',
      }));
      return;
    }
    const openManualUpdatePageFn = updaterApi.openManualUpdatePage;

    const result = await safeElectronCall<UpdateActionResult>(
      () => openManualUpdatePageFn(),
      { success: false, error: 'Manual update page is not available' }
    );

    if (result?.success) {
      showNotification('Download page opened. Install the latest version manually.', 'info');
      return;
    }

    setUpdateState(prev => ({
      ...prev,
      status: 'error',
      error: result?.error || 'Failed to open manual update page',
    }));
  }, [updateState.status, updateState.manualInstallUrl, updateState.updateInfo, safeElectronCall, showNotification]);

  // Download update
  const downloadUpdate = useCallback(async () => {
    if (updateState.status !== 'available') {
      return;
    }

    if (updateState.updateMode === 'manual') {
      await openManualUpdatePage();
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
  }, [updateState.status, updateState.updateMode, openManualUpdatePage, safeElectronCall]);

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
        const updateMode = info?.updateMode ?? updateModeRef.current;
        const manualInstallUrl = info?.manualInstallUrl ?? manualInstallUrlRef.current;
        if (info?.updateMode) {
          updateModeRef.current = info.updateMode;
        }
        if (typeof info?.manualInstallUrl !== 'undefined') {
          manualInstallUrlRef.current = info.manualInstallUrl ?? null;
        }

        if (isSameVersion(currentVersionRef.current, info?.version)) {
          setUpdateState(prev => ({
            ...prev,
            status: 'not-available',
            updateInfo: null,
            updateMode,
            manualInstallUrl,
            error: null,
          }));
          return;
        }
        setUpdateState(prev => ({
          ...prev,
          status: 'available',
          updateInfo: {
            ...info,
            updateMode,
            manualInstallUrl,
          },
          updateMode,
          manualInstallUrl,
          error: null,
        }));
        showNotification(
          updateMode === 'manual'
            ? `Update available: v${info.version}. Open the update menu to install the latest version manually.`
            : `Update available: v${info.version}. Click the update button to download.`,
          'info'
        );
      });
      if (typeof unsubscribe === 'function') {
        cleanup.push(unsubscribe);
      }
    }

    // Update not available
    if (eventsApi.onUpdateNotAvailable) {
      const unsubscribe = eventsApi.onUpdateNotAvailable((info?: UpdateInfo) => {
        if (info?.updateMode) {
          updateModeRef.current = info.updateMode;
        }
        if (typeof info?.manualInstallUrl !== 'undefined') {
          manualInstallUrlRef.current = info.manualInstallUrl ?? null;
        }
        setUpdateState(prev => ({ 
          ...prev, 
          status: 'not-available',
          updateInfo: null,
          updateMode: info?.updateMode ?? prev.updateMode,
          manualInstallUrl:
            typeof info?.manualInstallUrl !== 'undefined'
              ? info.manualInstallUrl ?? null
              : prev.manualInstallUrl,
          error: null,
        }));
      });
      if (typeof unsubscribe === 'function') {
        cleanup.push(unsubscribe);
      }
    }

    // Update error
    if (eventsApi.onUpdateError) {
      const unsubscribe = eventsApi.onUpdateError((errorInfo: { message: string; updateMode?: UpdateMode }) => {
        if (errorInfo.updateMode) {
          updateModeRef.current = errorInfo.updateMode;
        }
        setUpdateState(prev => ({
          ...prev,
          status: 'error',
          updateMode: errorInfo.updateMode ?? prev.updateMode,
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
          updateInfo: { ...prev.updateInfo, ...info, updateMode: info.updateMode ?? prev.updateMode },
          updateMode: info.updateMode ?? prev.updateMode,
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
  }, [showNotification, isSameVersion]);

  useEffect(() => {
    const updaterApi = typeof window === 'undefined' ? undefined : window.electronAPI?.updater;
    if (!updaterApi?.getUpdateInfo) {
      return;
    }
    const getUpdateInfoFn = updaterApi.getUpdateInfo;

    safeElectronCall<UpdateRuntimeInfo | null>(() => getUpdateInfoFn(), null).then((info) => {
      applyRuntimeUpdateInfo(info);
    });
  }, [safeElectronCall, applyRuntimeUpdateInfo]);

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
    openManualUpdatePage,
    installUpdate,
    isUpdateAvailable,
    isUpdateReady,
  };
};
