// Type definitions for Electron API exposed through preload script

interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

interface UpdateProgressInfo {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

interface UpdaterApi {
  checkForUpdates: () => Promise<{ success: boolean; error?: string; updateInfo?: UpdateInfo }>;
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  quitAndInstall: () => Promise<{ success: boolean; error?: string }>;
  getUpdateInfo: () => Promise<{
    autoUpdateEnabled: boolean;
    currentVersion: string;
    platform: string;
  }>;
}

interface ElectronEventsApi {
  onScrapeProgress: (callback: (data: any) => void) => () => void;
  onScrapeComplete: (callback: (data: any) => void) => () => void;
  onScrapeError: (callback: (data: any) => void) => () => void;
  onDataRefresh: (callback: (data: any) => void) => () => void;
  onNotification: (callback: (data: any) => void) => () => void;
  onAuthSessionChanged: (callback: (data: any) => void) => () => void;
  onWindowStateChanged: (callback: (data: { maximized: boolean }) => void) => () => void;
  onUpdateCheckingForUpdate: (callback: () => void) => () => void;
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
  onUpdateNotAvailable: (callback: (info?: UpdateInfo) => void) => () => void;
  onUpdateError: (callback: (error: { message: string }) => void) => () => void;
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
  getZoomLevel: () => Promise<number>;
}

interface DatabaseApi {
  query: (sql: string, params?: any[]) => Promise<{ success: boolean; data?: any[]; rowCount?: number; error?: string }>;
  test: () => Promise<{ success: boolean; error?: string }>;
  stats: () => Promise<{ success: boolean; stats?: any; error?: string }>;
}

interface ApiClientApi {
  ping: () => Promise<{ success: boolean; data?: any; error?: string }>;
  credentials: () => Promise<{ success: boolean; data?: any; error?: string }>;
  categories: () => Promise<{ success: boolean; data?: any; error?: string }>;
  request: (method: string, endpoint: string, data?: any, headers?: any) => Promise<{
    status: number;
    statusText: string;
    data: any;
    ok: boolean;
  }>;
  get: (endpoint: string, headers?: any) => Promise<any>;
  post: (endpoint: string, data?: any, headers?: any) => Promise<any>;
  put: (endpoint: string, data?: any, headers?: any) => Promise<any>;
  delete: (endpoint: string, headers?: any) => Promise<any>;
  patch: (endpoint: string, data?: any, headers?: any) => Promise<any>;
}

interface ScraperApi {
  start: (options: any, credentials: any) => Promise<{ success: boolean; data?: any; error?: string }>;
  events: (limit?: number) => Promise<{ success: boolean; data?: any; error?: string }>;
  test: (companyId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  onProgress: (callback: (data: any) => void) => () => void;
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

interface TelemetryApi {
  getConfig: () => Promise<any>;
  triggerMainSmoke: () => Promise<{ success: boolean; error?: string }>;
  triggerRendererSmoke: () => Promise<{ success: boolean }>;
}

interface BackgroundSyncSettings {
  enabled: boolean;
  intervalHours: 48 | 168 | 720;
  runOnStartup: boolean;
  keepRunningInTray: boolean;
  headless: boolean;
  lastRunAt?: string;
  lastResult?: {
    status: 'success' | 'failed' | 'skipped' | 'blocked';
    message?: string;
    totals?: {
      totalProcessed: number;
      successCount: number;
      failureCount: number;
      totalTransactions: number;
    };
  };
}

interface ElectronTelemetryPreferences {
  crashReportsEnabled?: boolean;
  lastUpdatedAt?: string | null;
}

interface ElectronAppSettings {
  telemetry?: ElectronTelemetryPreferences;
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
  getName: () => Promise<string>;
  isPackaged: () => Promise<boolean>;
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
}

interface DevApi {
  reload: () => Promise<void>;
  toggleDevTools: () => Promise<void>;
  log: (...args: any[]) => void;
}

interface LicenseStatus {
  registered: boolean;
  licenseType: 'trial' | 'pro' | 'expired' | 'none';
  trialDaysRemaining?: number;
  isReadOnly: boolean;
  canWrite: boolean;
  offlineMode: boolean;
  offlineGraceDaysRemaining?: number | null;
  syncedToCloud: boolean;
  lastValidated?: string;
  email?: string;
  error?: string;
}

interface EmailValidation {
  valid: boolean;
  error?: string;
}

interface LicenseApi {
  getStatus: () => Promise<{ success: boolean; data?: LicenseStatus; error?: string }>;
  register: (email: string) => Promise<{ success: boolean; license?: any; error?: string }>;
  validateEmail: (email: string) => Promise<{ success: boolean; data?: EmailValidation; error?: string }>;
  activatePro: (paymentRef?: string) => Promise<{ success: boolean; error?: string }>;
  canWrite: () => Promise<{ success: boolean; canWrite: boolean; error?: string }>;
  validateOnline: () => Promise<{ success: boolean; status?: LicenseStatus; error?: string }>;
  getInfo: () => Promise<{ success: boolean; data?: any; error?: string }>;
}

interface ElectronAPI {
  window: WindowApi;
  db?: DatabaseApi;
  api: ApiClientApi;
  scraper: ScraperApi;
  file: FileApi;
  auth: AuthApi;
  license: LicenseApi;
  log: LogApi;
  diagnostics: DiagnosticsApi;
  telemetry: TelemetryApi;
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
