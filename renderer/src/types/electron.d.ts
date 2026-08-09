// Type definitions for Electron API exposed through preload script

interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
  manualInstallUrl?: string | null;
  updateMode?: 'automatic' | 'manual' | 'disabled';
}

interface UpdateProgressInfo {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

interface UpdaterApi {
  checkForUpdates: () => Promise<{
    success: boolean;
    error?: string;
    updateInfo?: UpdateInfo | null;
    isUpdateAvailable?: boolean;
    currentVersion?: string;
    manualInstallUrl?: string | null;
    updateMode?: 'automatic' | 'manual' | 'disabled';
  }>;
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  quitAndInstall: () => Promise<{ success: boolean; error?: string }>;
  openManualUpdatePage: () => Promise<{ success: boolean; error?: string; url?: string }>;
  getUpdateInfo: () => Promise<{
    autoUpdateEnabled: boolean;
    currentVersion: string;
    platform: string;
    manualInstallUrl?: string | null;
    updateMode?: 'automatic' | 'manual' | 'disabled';
    reason?: string | null;
  }>;
}

interface ElectronEventsApi {
  onScrapeProgress: (callback: (data: any) => void) => () => void;
  onAuthSessionChanged: (callback: (data: any) => void) => () => void;
  onWindowStateChanged: (callback: (data: { maximized: boolean }) => void) => () => void;
  onUpdateCheckingForUpdate: (callback: () => void) => () => void;
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
  onUpdateNotAvailable: (callback: (info?: UpdateInfo) => void) => () => void;
  onUpdateError: (callback: (error: { message: string; updateMode?: 'automatic' | 'manual' | 'disabled'; manualInstallUrl?: string | null }) => void) => () => void;
  onUpdateDownloadProgress: (callback: (progress: UpdateProgressInfo) => void) => () => void;
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => () => void;
}

interface WindowApi {
  minimize: () => Promise<void>;
  maximize: () => Promise<boolean>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  zoomIn: () => Promise<number>;
  zoomOut: () => Promise<number>;
  zoomReset: () => Promise<number>;
}

interface DatabaseApi {
  query: (sql: string, params?: any[]) => Promise<{ success: boolean; data?: any[]; rowCount?: number; error?: string }>;
  test: () => Promise<{ success: boolean; error?: string }>;
  stats: () => Promise<{ success: boolean; stats?: any; error?: string }>;
}

interface ApiClientApi {
  request: (method: string, endpoint: string, data?: any, headers?: any) => Promise<{
    status: number;
    statusText: string;
    data: any;
    ok: boolean;
  }>;
}

interface FileApi {
  showSaveDialog: (options: any) => Promise<{ canceled: boolean; filePath?: string }>;
  showOpenDialog: (options: any) => Promise<{ canceled: boolean; filePaths?: string[] }>;
  writeFile: (filePath: string, data: any, options?: any) => Promise<{ success: boolean; error?: string }>;
}

interface AuthApi {
  getSession: () => Promise<{ success: boolean; session?: any; error?: string }>;
  setSession: (session: any) => Promise<{ success: boolean; session?: any; error?: string }>;
  clearSession: () => Promise<{ success: boolean; error?: string }>;
}

interface ChatbotSecretsApi {
  getStatus: () => Promise<{ success: boolean; hasOpenAiApiKey?: boolean; error?: string }>;
  setOpenAiApiKey: (apiKey: string) => Promise<{ success: boolean; hasOpenAiApiKey?: boolean; error?: string }>;
  clearOpenAiApiKey: () => Promise<{ success: boolean; hasOpenAiApiKey?: boolean; error?: string }>;
}

interface LogApi {
  info: (message: string, data?: any) => void;
  warn: (message: string, data?: any) => void;
  error: (message: string, data?: any) => void;
  debug: (message: string, data?: any) => void;
}

interface DiagnosticsApi {
  getInfo: () => Promise<any>;
  openLogDirectory: () => Promise<{ success: boolean; error?: string }>;
  exportDiagnostics: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  copyDiagnostics: () => Promise<{ success: boolean; error?: string }>;
}

interface BackgroundSyncSettings {
  enabled: boolean;
  intervalHours: 48 | 168 | 720;
  runOnStartup: boolean;
  keepRunningInTray: boolean;
  headless: boolean;
  showBrowserOnSync?: boolean;
  lastRunAt?: string;
  lastResult?: {
    status: 'success' | 'partial' | 'failed' | 'skipped' | 'blocked';
    message?: string;
    totals?: {
      totalProcessed: number;
      successCount: number;
      failureCount: number;
      blockedCount?: number;
      totalTransactions: number;
    };
  };
}

interface ElectronAppSettings {
  backgroundSync?: BackgroundSyncSettings;
  [key: string]: unknown;
}

interface SettingsApi {
  get: () => Promise<{ success: boolean; settings?: ElectronAppSettings; error?: string }>;
  update: (patch: Partial<ElectronAppSettings>) => Promise<{ success: boolean; settings?: ElectronAppSettings; error?: string }>;
  onChange: (callback: (settings: ElectronAppSettings) => void) => () => void;
}

interface AppApi {
  getVersion: () => Promise<string>;
  relaunch: () => Promise<{ success: boolean; error?: string }>;
}

interface DatabaseMaintenanceApi {
  backup: (targetPath: string) => Promise<{ success: boolean; error?: string; path?: string }>;
  restore: (sourcePath: string) => Promise<{ success: boolean; error?: string; path?: string; restartRecommended?: boolean }>;
}

interface PlatformApi {
  isWindows: boolean;
  isMacOS: boolean;
  isLinux: boolean;
  reduceVisualEffects: boolean;
}

interface DevApi {
  reload: () => Promise<void>;
  toggleDevTools: () => Promise<void>;
  log: (...args: any[]) => void;
}

interface ElectronAPI {
  window: WindowApi;
  db?: DatabaseApi;
  api: ApiClientApi;
  file: FileApi;
  auth: AuthApi;
  chatbotSecrets?: ChatbotSecretsApi;
  log: LogApi;
  diagnostics: DiagnosticsApi;
  settings: SettingsApi;
  app: AppApi;
  database: DatabaseMaintenanceApi;
  events: ElectronEventsApi;
  platform: PlatformApi;
  updater: UpdaterApi;
  dev?: DevApi;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
