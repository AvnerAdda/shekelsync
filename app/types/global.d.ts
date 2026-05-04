export {};

declare global {
  type ElectronEventUnsubscribe = () => void;

  interface ElectronApiResponse {
    status: number;
    statusText: string;
    ok: boolean;
    data: unknown;
  }

  interface AuthUserSummary {
    id?: string;
    email?: string;
    name?: string;
    image?: string;
  }

  interface AuthSession {
    accessToken?: string;
    refreshToken?: string;
    tokenType?: string;
    expiresAt?: string;
    user?: AuthUserSummary | null;
    metadata?: Record<string, unknown>;
  }

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

  interface ElectronScrapeProgressEvent {
    vendor?: string;
    status?: string;
    progress?: number;
    message?: string;
    transactions?: number;
    error?: string;
  }

  interface ElectronTelemetryPreferences {
    crashReportsEnabled?: boolean;
    lastUpdatedAt?: string | null;
  }

  interface BackgroundSyncSettings {
    enabled?: boolean;
    intervalHours?: 48 | 168 | 720;
    runOnStartup?: boolean;
    keepRunningInTray?: boolean;
    headless?: boolean;
    showBrowserOnSync?: boolean;
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

  interface TelegramDigestResult {
    status: 'sent' | 'skipped' | 'failed';
    message?: string;
  }

  interface TelegramSettings {
    enabled?: boolean;
    deliveryMode?: 'both';
    pushOnScheduledSync?: boolean;
    localeMode?: 'app';
    lastDigestAt?: string;
    lastDigestResult?: TelegramDigestResult;
  }

  interface ElectronAppSettings {
    appLocale?: 'he' | 'en' | 'fr';
    telemetry?: ElectronTelemetryPreferences;
    backgroundSync?: BackgroundSyncSettings;
    telegram?: TelegramSettings;
    [key: string]: unknown;
  }

  interface ElectronWindowControls {
    minimize?: () => Promise<void>;
    maximize?: () => Promise<boolean>;
    close?: () => Promise<void>;
    isMaximized?: () => Promise<boolean>;
    zoomIn?: () => Promise<number>;
    zoomOut?: () => Promise<number>;
    zoomReset?: () => Promise<number>;
    getZoomLevel?: () => Promise<number>;
  }

  interface ElectronDbApi {
    query?: (sql: string, params?: unknown[]) => Promise<unknown>;
    test?: () => Promise<unknown>;
    stats?: () => Promise<unknown>;
  }

  interface ElectronCoreApi {
    request?: (
      method: string,
      endpoint: string,
      data?: any,
      headers?: Record<string, string>,
    ) => Promise<ElectronApiResponse>;
    get?: (endpoint: string, headers?: Record<string, string>) => Promise<unknown>;
    post?: (endpoint: string, data?: any, headers?: Record<string, string>) => Promise<unknown>;
    put?: (endpoint: string, data?: any, headers?: Record<string, string>) => Promise<unknown>;
    delete?: (endpoint: string, headers?: Record<string, string>) => Promise<unknown>;
    patch?: (endpoint: string, data?: any, headers?: Record<string, string>) => Promise<unknown>;
  }

  interface ElectronAuthBridge {
    getSession?: () => Promise<{ success: boolean; session?: AuthSession | null; error?: string }>;
    setSession?: (
      session: AuthSession | null,
    ) => Promise<{ success: boolean; session?: AuthSession | null; error?: string }>;
    clearSession?: () => Promise<{ success: boolean; error?: string }>;
  }

  interface ElectronChatbotSecretsBridge {
    getStatus?: () => Promise<{
      success: boolean;
      hasOpenAiApiKey?: boolean;
      error?: string;
    }>;
    setOpenAiApiKey?: (apiKey: string) => Promise<{
      success: boolean;
      hasOpenAiApiKey?: boolean;
      error?: string;
    }>;
    clearOpenAiApiKey?: () => Promise<{
      success: boolean;
      hasOpenAiApiKey?: boolean;
      error?: string;
    }>;
  }

  interface ElectronScraperApi {
    start?: (options: unknown, credentials: unknown) => Promise<unknown>;
    events?: (limit?: number) => Promise<unknown>;
    test?: (companyId: string) => Promise<unknown>;
    onProgress?: (callback: (event: ElectronScrapeProgressEvent) => void) => ElectronEventUnsubscribe | void;
  }

  interface ElectronFileApi {
    showSaveDialog?: (
      options: Record<string, unknown>,
    ) => Promise<{ canceled: boolean; filePath?: string | null }>;
    showOpenDialog?: (
      options: Record<string, unknown>,
    ) => Promise<{ canceled: boolean; filePaths: string[] }>;
    writeFile?: (
      filePath: string,
      data: string | Uint8Array,
      options?: { encoding?: BufferEncoding },
    ) => Promise<{ success: boolean; error?: string }>;
  }

  interface ElectronAppApi {
    getVersion?: () => Promise<string>;
    getName?: () => Promise<string>;
    isPackaged?: () => Promise<boolean>;
    relaunch?: () => Promise<{ success: boolean; error?: string }>;
  }

  interface ElectronEventsApi {
    onScrapeProgress?: (
      callback: (event: ElectronScrapeProgressEvent) => void,
    ) => ElectronEventUnsubscribe | void;
    onScrapeComplete?: (callback: (...args: unknown[]) => void) => ElectronEventUnsubscribe | void;
    onScrapeError?: (callback: (...args: unknown[]) => void) => ElectronEventUnsubscribe | void;
    onDataRefresh?: (callback: (...args: unknown[]) => void) => ElectronEventUnsubscribe | void;
    onNotification?: (callback: (...args: unknown[]) => void) => ElectronEventUnsubscribe | void;
    onAuthSessionChanged?: (
      callback: (session: AuthSession | null) => void,
    ) => ElectronEventUnsubscribe | void;
    onWindowStateChanged?: (
      callback: (payload: { maximized: boolean }) => void,
    ) => ElectronEventUnsubscribe | void;
    onUpdateCheckingForUpdate?: (callback: () => void) => ElectronEventUnsubscribe | void;
    onUpdateAvailable?: (callback: (info: UpdateInfo) => void) => ElectronEventUnsubscribe | void;
    onUpdateNotAvailable?: (callback: (info?: UpdateInfo) => void) => ElectronEventUnsubscribe | void;
    onUpdateError?: (
      callback: (error: { message: string }) => void,
    ) => ElectronEventUnsubscribe | void;
    onUpdateDownloadProgress?: (
      callback: (progress: UpdateProgressInfo) => void,
    ) => ElectronEventUnsubscribe | void;
    onUpdateDownloaded?: (callback: (info: UpdateInfo) => void) => ElectronEventUnsubscribe | void;
  }

  interface ElectronPlatformInfo {
    isWindows?: boolean;
    isMacOS?: boolean;
    isLinux?: boolean;
    reduceVisualEffects?: boolean;
  }

  interface ElectronDevTools {
    reload?: () => Promise<void>;
    toggleDevTools?: () => Promise<void>;
    log?: (...args: unknown[]) => void;
  }

  interface ElectronLogBridge {
    info?: (message: string, data?: Record<string, unknown>) => void;
    warn?: (message: string, data?: Record<string, unknown>) => void;
    error?: (message: string, data?: Record<string, unknown>) => void;
    debug?: (message: string, data?: Record<string, unknown>) => void;
  }

  interface ElectronDiagnosticsExportResult {
    success: boolean;
    error?: string;
    path?: string;
  }

  interface AnalyticsMetricSample {
    durationMs: number;
    recordedAt: string;
    type?: string;
    months?: number;
    aggregation?: string;
    groupBy?: string;
    includeTransactions?: boolean;
    dateRange?: {
      start: string;
      end: string;
      previousStart?: string;
      previousEnd?: string;
    };
    rowCounts?: Record<string, number>;
    [key: string]: unknown;
  }

  interface AnalyticsMetricsSnapshot {
    breakdown?: AnalyticsMetricSample[];
    dashboard?: AnalyticsMetricSample[];
    unifiedCategory?: AnalyticsMetricSample[];
    waterfall?: AnalyticsMetricSample[];
    categoryOpportunities?: AnalyticsMetricSample[];
  }

  interface ElectronDiagnosticsApi {
    getInfo?: () => Promise<{
      success: boolean;
      logDirectory?: string;
      logFile?: string;
      appVersion?: string;
      platform?: NodeJS.Platform;
      telemetry?: {
        enabled?: boolean;
        initialized?: boolean;
        dsnConfigured?: boolean;
        dsnHost?: string | null;
        dsnProjectId?: string | null;
        debug?: boolean;
      } | null;
      telemetrySummary?: {
        status: 'opted-in' | 'opted-out';
        destination: string | null;
        initialized: boolean;
        debug: boolean;
      } | null;
      analyticsMetrics?: AnalyticsMetricsSnapshot | null;
      configHealth?: {
        warnings?: Array<{
          code?: string;
          message: string;
          severity?: 'warning' | 'error' | 'info';
        }>;
      } | null;
    }>;
    openLogDirectory?: () => Promise<{ success: boolean; error?: string }>;
    exportDiagnostics?: (filePath: string) => Promise<ElectronDiagnosticsExportResult>;
    copyDiagnostics?: () => Promise<{ success: boolean; error?: string }>;
  }

  interface ElectronDatabaseMaintenanceApi {
    backup?: (targetPath: string) => Promise<{ success: boolean; error?: string; path?: string }>;
    restore?: (sourcePath: string) => Promise<{
      success: boolean;
      error?: string;
      path?: string;
      restartRecommended?: boolean;
    }>;
  }

  interface ElectronUpdaterApi {
    checkForUpdates?: () => Promise<{
      success: boolean;
      error?: string;
      updateInfo?: UpdateInfo | null;
      isUpdateAvailable?: boolean;
      currentVersion?: string;
    }>;
    downloadUpdate?: () => Promise<{ success: boolean; error?: string }>;
    quitAndInstall?: () => Promise<{ success: boolean; error?: string }>;
    getUpdateInfo?: () => Promise<{
      autoUpdateEnabled: boolean;
      currentVersion: string;
      platform: string;
      reason?: string | null;
    }>;
  }

  interface ElectronLicenseStatus {
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

  interface ElectronEmailValidation {
    valid: boolean;
    error?: string;
  }

  interface ElectronLicenseApi {
    getStatus?: () => Promise<{ success: boolean; data?: ElectronLicenseStatus; error?: string }>;
    register?: (email: string) => Promise<{ success: boolean; license?: unknown; error?: string }>;
    validateEmail?: (email: string) => Promise<{ success: boolean; data?: ElectronEmailValidation; error?: string }>;
    activatePro?: (paymentRef?: string) => Promise<{ success: boolean; error?: string }>;
    canWrite?: () => Promise<{ success: boolean; canWrite: boolean; error?: string }>;
    validateOnline?: () => Promise<{ success: boolean; status?: ElectronLicenseStatus; error?: string }>;
    getInfo?: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
  }

  interface ElectronBiometricAuthApi {
    isAvailable?: () => Promise<{ available: boolean; type?: string | null; reason?: string | null }>;
    authenticate?: (reason?: string) => Promise<{
      success: boolean;
      method?: string;
      error?: string;
    }>;
  }

  interface ElectronSettingsApi {
    get?: () => Promise<{ success: boolean; settings?: ElectronAppSettings; error?: string }>;
    update?: (
      patch: Partial<ElectronAppSettings>,
    ) => Promise<{ success: boolean; settings?: ElectronAppSettings; error?: string }>;
    onChange?: (callback: (settings: ElectronAppSettings) => void) => ElectronEventUnsubscribe | void;
  }

  interface ElectronTelegramStatus {
    enabled: boolean;
    deliveryMode: 'both';
    pushOnScheduledSync: boolean;
    configured: boolean;
    paired: boolean;
    botUsername?: string | null;
    chatTitle?: string | null;
    chatUsername?: string | null;
    pairingCode?: string | null;
    pairingExpiresAt?: string | null;
    runtimeActive: boolean;
    lastPollAt?: string | null;
    lastMessageAt?: string | null;
    lastError?: string | null;
    localOnly: boolean;
    syncStatus?: {
      keepRunningInTray?: boolean;
      backgroundSync?: BackgroundSyncSettings | null;
    };
  }

  interface ElectronTelegramApi {
    getStatus?: () => Promise<{ success: boolean; status?: ElectronTelegramStatus; error?: string }>;
    saveBotToken?: (
      token: string,
    ) => Promise<{ success: boolean; status?: ElectronTelegramStatus; error?: string }>;
    beginPairing?: () => Promise<{
      success: boolean;
      pairingCode?: string;
      expiresAt?: string;
      botUsername?: string;
      status?: ElectronTelegramStatus;
      error?: string;
    }>;
    disconnect?: () => Promise<{ success: boolean; status?: ElectronTelegramStatus; error?: string }>;
    sendTestMessage?: () => Promise<{ success: boolean; status?: ElectronTelegramStatus; error?: string }>;
  }

  interface ElectronTelemetryApi {
    getConfig?: () => Promise<{
      dsn?: string | null;
      environment?: string;
      release?: string;
      debug?: boolean;
      enabled?: boolean;
    }>;
    triggerMainSmoke?: () => Promise<{ success: boolean; error?: string }>;
    triggerRendererSmoke?: () => Promise<{ success: boolean; error?: string }>;
  }

  interface ElectronAPI {
    window?: ElectronWindowControls;
    db?: ElectronDbApi;
    api?: ElectronCoreApi;
    scraper?: ElectronScraperApi;
    file?: ElectronFileApi;
    auth?: ElectronAuthBridge;
    chatbotSecrets?: ElectronChatbotSecretsBridge;
    app?: ElectronAppApi;
    events?: ElectronEventsApi;
    platform?: ElectronPlatformInfo;
    dev?: ElectronDevTools;
    log?: ElectronLogBridge;
    diagnostics?: ElectronDiagnosticsApi;
    settings?: ElectronSettingsApi;
    telegram?: ElectronTelegramApi;
    telemetry?: ElectronTelemetryApi;
    updater?: ElectronUpdaterApi;
    license?: ElectronLicenseApi;
    database?: ElectronDatabaseMaintenanceApi;
    biometricAuth?: ElectronBiometricAuthApi;
  }

  interface Window {
    electronAPI?: ElectronAPI;
  }
}
