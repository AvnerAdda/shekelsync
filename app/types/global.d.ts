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

  interface ElectronAppSettings {
    telemetry?: ElectronTelemetryPreferences;
    [key: string]: unknown;
  }

  interface ElectronWindowControls {
    minimize?: () => Promise<void>;
    maximize?: () => Promise<void>;
    close?: () => Promise<void>;
    isMaximized?: () => Promise<boolean>;
    zoomIn?: () => Promise<void>;
    zoomOut?: () => Promise<void>;
    zoomReset?: () => Promise<void>;
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
  }

  interface ElectronPlatformInfo {
    isWindows?: boolean;
    isMacOS?: boolean;
    isLinux?: boolean;
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
    }>;
    openLogDirectory?: () => Promise<{ success: boolean; error?: string }>;
    exportDiagnostics?: (filePath: string) => Promise<ElectronDiagnosticsExportResult>;
  }

  interface ElectronSettingsApi {
    get?: () => Promise<{ success: boolean; settings?: ElectronAppSettings; error?: string }>;
    update?: (
      patch: Partial<ElectronAppSettings>,
    ) => Promise<{ success: boolean; settings?: ElectronAppSettings; error?: string }>;
    onChange?: (callback: (settings: ElectronAppSettings) => void) => ElectronEventUnsubscribe | void;
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
    app?: ElectronAppApi;
    events?: ElectronEventsApi;
    platform?: ElectronPlatformInfo;
    dev?: ElectronDevTools;
    log?: ElectronLogBridge;
    diagnostics?: ElectronDiagnosticsApi;
    settings?: ElectronSettingsApi;
    telemetry?: ElectronTelemetryApi;
  }

  interface Window {
    electronAPI?: ElectronAPI;
  }
}
