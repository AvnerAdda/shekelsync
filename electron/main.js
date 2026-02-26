// Track if encryption key existed before our code ran (to detect external injection)
const hadKeyAtStart = !!process.env.SHEKELSYNC_ENCRYPTION_KEY;

require('./setup-module-alias');

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  session,
  Tray,
  Menu,
  nativeImage,
  crashReporter,
  clipboard,
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  appRoot,
  rendererRoot,
  resolveAppPath,
  resolveRendererPath,
  requireFromApp,
} = require('./paths');
const {
  logger,
  recordRendererLog,
} = require('./logger');
const {
  getDiagnosticsInfo,
  openDiagnosticsLogDirectory,
  exportDiagnosticsToFile,
  buildDiagnosticsPayload,
} = require('./diagnostics');
const analyticsMetricsStore = require(resolveAppPath('server', 'services', 'analytics', 'metrics-store.js'));
const isPackaged = app.isPackaged;
const isDev = process.env.NODE_ENV === 'development' || !isPackaged;
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const allowUnsafeIpc = process.env.ALLOW_UNSAFE_IPC === 'true';
const allowInsecureEnvKey = process.env.ALLOW_INSECURE_ENV_KEY === 'true';
const keytarDisabledByEnv =
  process.env.KEYTAR_DISABLE === 'true' ||
  process.env.DBUS_SESSION_BUS_ADDRESS === 'disabled:';
const sandboxDisabledByEnv =
  process.env.ELECTRON_DISABLE_SANDBOX === '1' ||
  process.env.ELECTRON_DISABLE_SANDBOX === 'true';
const sandboxDisabledByFlag =
  typeof app.commandLine?.hasSwitch === 'function' && app.commandLine.hasSwitch('no-sandbox');

if (isPackaged && (sandboxDisabledByEnv || sandboxDisabledByFlag)) {
  const reason = sandboxDisabledByEnv ? 'ELECTRON_DISABLE_SANDBOX' : '--no-sandbox';
  logger.error('Sandbox disabled in packaged build. Refusing to start.', { reason });
  console.error('Sandbox disabled in packaged build. Refusing to start.', reason);
  app.exit(1);
}

function abortForSecurity(message) {
  logger.error('Security configuration error', { message });
  console.error('Security configuration error:', message);
  dialog.showErrorBox('Security Configuration Required', message);
  app.exit(1);
}

const APPROVED_FILE_WRITE_TTL_MS = 5 * 60 * 1000;
const approvedFileWrites = new Map();
const approvedFileReads = new Map();

function getSenderUrl(event) {
  const url = event?.senderFrame?.url || event?.sender?.getURL?.();
  return typeof url === 'string' ? url : '';
}

function isTrustedIpcSender(event) {
  const senderUrl = getSenderUrl(event);
  if (!senderUrl) {
    return false;
  }
  if (senderUrl.startsWith('file://')) {
    return true;
  }
  if (!isDev) {
    return false;
  }
  try {
    const parsed = new URL(senderUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch (error) {
    return false;
  }
}

function requireTrustedIpcSender(event, action) {
  if (isTrustedIpcSender(event)) {
    return true;
  }
  logger.warn('Blocked IPC request from untrusted sender', {
    action,
    senderUrl: getSenderUrl(event) || 'unknown',
  });
  return false;
}

function approveFileWrite(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return;
  }
  const normalized = path.resolve(filePath);
  const now = Date.now();
  for (const [key, expiresAt] of approvedFileWrites.entries()) {
    if (expiresAt <= now) {
      approvedFileWrites.delete(key);
    }
  }
  approvedFileWrites.set(normalized, now + APPROVED_FILE_WRITE_TTL_MS);
}

function consumeApprovedFileWrite(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }
  const normalized = path.resolve(filePath);
  const expiresAt = approvedFileWrites.get(normalized);
  if (!expiresAt) {
    return false;
  }
  if (Date.now() > expiresAt) {
    approvedFileWrites.delete(normalized);
    return false;
  }
  approvedFileWrites.delete(normalized);
  return true;
}

function approveFileRead(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return;
  }
  const normalized = path.resolve(filePath);
  const now = Date.now();
  for (const [key, expiresAt] of approvedFileReads.entries()) {
    if (expiresAt <= now) {
      approvedFileReads.delete(key);
    }
  }
  approvedFileReads.set(normalized, now + APPROVED_FILE_WRITE_TTL_MS);
}

function consumeApprovedFileRead(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }
  const normalized = path.resolve(filePath);
  const expiresAt = approvedFileReads.get(normalized);
  if (!expiresAt) {
    return false;
  }
  if (expiresAt <= Date.now()) {
    approvedFileReads.delete(normalized);
    return false;
  }
  approvedFileReads.delete(normalized);
  return true;
}

function resolveDefaultUserDataSqlitePath() {
  const preferredPath = path.join(app.getPath('userData'), 'shekelsync.sqlite');
  const legacyPath = path.join(app.getPath('userData'), 'clarify.sqlite');
  if (fs.existsSync(preferredPath)) {
    return preferredPath;
  }
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }
  return preferredPath;
}

function resolveSqlitePath() {
  return (
    dbManager.getSqlitePath?.() ||
    process.env.SQLITE_DB_PATH ||
    resolveDefaultUserDataSqlitePath()
  );
}

async function backupSqliteDatabase(targetPath, { reason = 'manual' } = {}) {
  if (dbManager.mode !== 'sqlite') {
    return { success: false, error: 'Database backup is supported only for SQLite mode.' };
  }
  if (!targetPath) {
    return { success: false, error: 'No destination provided.' };
  }

  try {
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    const sqliteDb = dbManager.getSqliteDatabase?.();
    if (sqliteDb && typeof sqliteDb.backup === 'function') {
      await sqliteDb.backup(targetPath);
    } else {
      const sourcePath = resolveSqlitePath();
      if (!sourcePath) {
        throw new Error('SQLite database path is unavailable.');
      }
      await fs.promises.copyFile(sourcePath, targetPath);
    }
    logger.info('SQLite backup completed', { targetPath, reason });
    return { success: true, path: targetPath };
  } catch (error) {
    logger.error('SQLite backup failed', { error: error.message, reason });
    return { success: false, error: error.message };
  }
}

async function restoreSqliteDatabase(sourcePath) {
  if (dbManager.mode !== 'sqlite') {
    return { success: false, error: 'Database restore is supported only for SQLite mode.' };
  }
  if (!sourcePath) {
    return { success: false, error: 'No source file provided.' };
  }
  if (!consumeApprovedFileRead(sourcePath)) {
    return { success: false, error: 'File read not approved. Please choose a file again.' };
  }

  const targetPath = resolveSqlitePath();
  if (!targetPath) {
    return { success: false, error: 'SQLite database path is unavailable.' };
  }

  try {
    await dbManager.close();
    await fs.promises.copyFile(sourcePath, targetPath);
    await fs.promises.rm(`${targetPath}-wal`, { force: true });
    await fs.promises.rm(`${targetPath}-shm`, { force: true });
    await dbManager.initialize();
    logger.info('SQLite restore completed', { sourcePath, targetPath });
    return { success: true, path: targetPath, restartRecommended: true };
  } catch (error) {
    logger.error('SQLite restore failed', { error: error.message });
    return { success: false, error: error.message };
  }
}

// Load environment variables from the Next.js app if present (e.g., USE_SQLITE)
// Only load .env.local in development (not in packaged app)
if (!app.isPackaged) {
  try {
    const dotenv = requireFromApp('dotenv');
    const envFile = path.join(appRoot, '.env.local');
    if (fs.existsSync(envFile)) {
      dotenv.config({ path: envFile });
    }
  } catch (error) {
    console.warn('Unable to load dotenv configuration:', error.message);
  }
}

// Reduce GPU-related crashes in certain Linux setups
try {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
} catch (error) {
  console.warn('Failed to disable hardware acceleration:', error.message);
}

// Handle module resolution for development vs production
let autoUpdater;
let lastUpdateBackupVersion = null;
try {
  if (isDev) {
    autoUpdater = requireFromApp('electron-updater').autoUpdater;
  } else {
    autoUpdater = require('electron-updater').autoUpdater;
  }
} catch (error) {
  console.log('electron-updater not available:', error.message);
  autoUpdater = null;
}

const AUTO_UPDATE_ENV_FLAG = 'ENABLE_AUTO_UPDATE';
if (typeof process.env[AUTO_UPDATE_ENV_FLAG] === 'undefined') {
  process.env[AUTO_UPDATE_ENV_FLAG] = 'false';
}

function shouldEnableAutoUpdate() {
  return !isDev && autoUpdater && process.env[AUTO_UPDATE_ENV_FLAG] === 'true';
}

const MIGRATION_ENV_FLAG = 'ALLOW_DB_MIGRATE';
if (typeof process.env[MIGRATION_ENV_FLAG] === 'undefined') {
  process.env[MIGRATION_ENV_FLAG] = 'false';
}
if (process.env[MIGRATION_ENV_FLAG] === 'true') {
  console.warn(`${MIGRATION_ENV_FLAG} flag is enabled. Proceed only if this build is intended for database maintenance.`);
}

// Import configuration and database managers
const { configManager } = require('./config');
const { dbManager } = require('./database');
const sessionStore = require('./session-store');
const { describeTelemetryState } = require('./telemetry-utils');
const secureKeyManager = require('./secure-key-manager');
const licenseService = require('./license-service');
const { createSyncScheduler, normalizeBackgroundSettings } = require('./sync-scheduler');

async function runLicenseSmokeTest(email) {
  if (!email) return;

  try {
    const validation = licenseService.validateEmail(email);
    logger.info('[LicenseSmokeTest] Validation result', {
      email,
      valid: validation.valid,
      error: validation.error,
    });

    if (!validation.valid) {
      return;
    }

    const status = await licenseService.checkLicenseStatus();
    if (status.registered) {
      logger.info('[LicenseSmokeTest] Skipping registration, already registered', {
        licenseType: status.licenseType,
      });
      return;
    }

    const result = await licenseService.registerLicense(email);
    logger.info('[LicenseSmokeTest] Registration result', {
      success: result.success,
      error: result.error,
    });
  } catch (error) {
    logger.error('[LicenseSmokeTest] Failed', { error: error.message });
  }
}

async function runLicenseIpcSmokeTest(email) {
  if (!email) return;

  const testWindow = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  try {
    await testWindow.loadURL('about:blank');
    const emailLiteral = JSON.stringify(email);
    const validation = await testWindow.webContents.executeJavaScript(
      `window.electronAPI.license.validateEmail(${emailLiteral})`,
    );
    logger.info('[LicenseIpcSmokeTest] Validation result', {
      email,
      valid: validation?.data?.valid ?? validation?.valid,
      error: validation?.data?.error ?? validation?.error,
    });

    const registration = await testWindow.webContents.executeJavaScript(
      `window.electronAPI.license.register(${emailLiteral})`,
    );
    logger.info('[LicenseIpcSmokeTest] Registration result', {
      success: registration?.success,
      error: registration?.error,
    });

    const status = await testWindow.webContents.executeJavaScript(
      'window.electronAPI.license.getStatus()',
    );
    logger.info('[LicenseIpcSmokeTest] Status result', {
      registered: status?.data?.registered,
      licenseType: status?.data?.licenseType,
      error: status?.error,
    });
  } catch (error) {
    logger.error('[LicenseIpcSmokeTest] Failed', { error: error.message });
  } finally {
    if (!testWindow.isDestroyed()) {
      testWindow.destroy();
    }
  }
}

const telemetryState = {
  enabled: false,
  initialized: false,
  sentry: null,
};

process.env.CRASH_REPORTS_ENABLED = 'false';
wireTelemetryMetricsReporter();

function emitTelemetryMetric(bucket, payload = {}) {
  if (!telemetryState.enabled || !telemetryState.initialized) {
    return;
  }
  if (!telemetryState.sentry?.captureMessage) {
    return;
  }

  telemetryState.sentry.captureMessage('analytics-metric', {
    level: 'info',
    tags: {
      bucket,
      component: 'analytics',
    },
    extra: {
      bucket,
      ...payload,
    },
  });
}

function wireTelemetryMetricsReporter() {
  if (analyticsMetricsStore?.setMetricReporter) {
    analyticsMetricsStore.setMetricReporter((bucket, sample) => {
      try {
        emitTelemetryMetric(bucket, sample);
      } catch (error) {
        logger.warn('Failed to forward analytics metric to telemetry', { error: error.message });
      }
    });
  }
}

function getEnvKeyRemovalInstructions() {
  if (process.platform === 'win32') {
    return `

HOW TO FIX:
1. Press Win+R, type "sysdm.cpl" and press Enter
2. Click "Environment Variables" button
3. In BOTH "User variables" and "System variables" sections:
   - Find SHEKELSYNC_ENCRYPTION_KEY
   - Select it and click "Delete"
4. Click OK to close all dialogs
5. Restart ShekelSync

WHY: This variable was likely set during development. In production,
ShekelSync securely stores encryption keys in Windows Credential Manager.`;
  } else if (process.platform === 'darwin') {
    return `

HOW TO FIX:
1. Open Terminal
2. Run: launchctl unsetenv SHEKELSYNC_ENCRYPTION_KEY
3. Remove from ~/.zshrc or ~/.bash_profile if present
4. Restart ShekelSync

WHY: In production, ShekelSync stores encryption keys in macOS Keychain.`;
  }
  return '';
}

async function ensureEncryptionKey(config) {
  // If key exists but was set by US (not at script start), we're done
  if (process.env.SHEKELSYNC_ENCRYPTION_KEY && !hadKeyAtStart) {
    return;
  }

  // Check if key was injected externally (existed before our script started)
  if (process.env.SHEKELSYNC_ENCRYPTION_KEY && hadKeyAtStart) {
    const envKeyAllowed = allowInsecureEnvKey || isLinux;
    if (!envKeyAllowed) {
      const keyValue = process.env.SHEKELSYNC_ENCRYPTION_KEY;
      const keyPreview = keyValue.length > 8
        ? `${keyValue.substring(0, 4)}...${keyValue.substring(keyValue.length - 4)}`
        : '(short key)';

      const instructions = getEnvKeyRemovalInstructions();
      const platformName = process.platform === 'win32' ? 'Windows' : 'macOS';

      const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: 'Security Configuration Required',
        message: 'Environment encryption key detected',
        detail: `For security, ShekelSync cannot use encryption keys from environment variables on ${platformName}.

DETECTED KEY INFO:
• Length: ${keyValue.length} characters
• Preview: ${keyPreview}

Click "Clear and Continue" to remove this key from the current session and use ${process.platform === 'win32' ? 'Windows Credential Manager' : 'macOS Keychain'} instead (recommended).

Click "Exit" to close the app and manually remove the variable.${instructions}`,
        buttons: ['Clear and Continue (Recommended)', 'Exit'],
        defaultId: 0,
        cancelId: 1,
      });

      if (response === 0) {
        // User chose to clear and continue
        logger.info('User chose to clear environment key and use Credential Manager');
        delete process.env.SHEKELSYNC_ENCRYPTION_KEY;
        // Fall through to keychain initialization below
      } else {
        // User chose to exit
        app.quit();
        throw new Error('User chose to exit to remove environment key.');
      }
    } else {
      // Env key is allowed (Linux or test mode)
      if (allowInsecureEnvKey) {
        logger.warn('Using encryption key from environment variable (ALLOW_INSECURE_ENV_KEY=true)');
      } else if (isLinux) {
        logger.warn('Using encryption key from environment variable on Linux');
      }
      return;
    }
  }

  if (keytarDisabledByEnv && !allowInsecureEnvKey && !isLinux) {
    abortForSecurity(
      'OS keychain access is disabled by environment. Remove KEYTAR_DISABLE/DBUS_SESSION_BUS_ADDRESS overrides and restart. ' +
      'On Linux, install libsecret and ensure a running secret service.',
    );
    throw new Error('Keychain disabled by environment.');
  }

  if (!secureKeyManager.keytarAvailable && !allowInsecureEnvKey && !isLinux) {
    abortForSecurity(
      'OS keychain storage is required. Install and enable the system keychain (Credential Manager/Keychain/libsecret) and restart.',
    );
    throw new Error('Keychain unavailable.');
  }

  // Use secure key manager to get or generate key from OS keychain
  try {
    const masterKey = await secureKeyManager.getKey();
    process.env.SHEKELSYNC_ENCRYPTION_KEY = masterKey;
    logger.info('Encryption key loaded from secure storage');

    // SECURITY: Remove any old keys from config file if they exist
    if (config?.encryption?.key) {
      logger.warn('Removing legacy encryption key from config file for security');
      delete config.encryption.key;
      try {
        await configManager.updateConfig({ encryption: {} });
      } catch (error) {
        logger.warn('Failed to remove legacy encryption key from config', { error: error.message });
      }
    }
  } catch (error) {
    logger.error('CRITICAL: Failed to initialize encryption key', { error: error.message });
    if (isPackaged) {
      abortForSecurity(
        `Cannot initialize encryption key. ${error.message}`,
      );
    }
    throw new Error(`Cannot initialize encryption: ${error.message}`);
  }
}

function initializeTelemetry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // DSN not configured, skip initialization silently
    return false;
  }

  try {
    crashReporter.start({
      submitURL: '',
      productName: app.getName(),
      companyName: 'ShekelSync',
      uploadToServer: false,
      ignoreSystemCrashHandler: true,
    });

    const sentryModule = (isDev
      ? requireFromApp('@sentry/electron/main')
      : require('@sentry/electron/main'));
    sentryModule.init({
      dsn,
      release: app.getVersion(),
      environment: process.env.NODE_ENV || 'production',
      debug: process.env.SENTRY_DEBUG === 'true',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0'),
      beforeSend(event) {
        return telemetryState.enabled ? event : null;
      },
    });

    telemetryState.sentry = sentryModule;
    logger.info('Crash reporting initialized (events will only be sent if user enables telemetry)');
    return true;
  } catch (error) {
    logger.warn('Failed to initialize crash reporting', { error: error.message });
    return false;
  }
}

// Initialize Sentry early (before app.ready) if DSN is configured
// The beforeSend hook will prevent events from being sent unless user enables telemetry
if (process.env.SENTRY_DSN) {
  telemetryState.initialized = initializeTelemetry();
}

async function applyTelemetryPreference(settings = {}) {
  const nextEnabled = Boolean(settings?.telemetry?.crashReportsEnabled);
  telemetryState.enabled = nextEnabled;
  process.env.CRASH_REPORTS_ENABLED = nextEnabled ? 'true' : 'false';

  // If telemetry is now enabled and Sentry hasn't been initialized yet, try to initialize it
  if (nextEnabled && !telemetryState.initialized) {
    telemetryState.initialized = initializeTelemetry();
  }

  // Note: We don't close Sentry when disabled anymore since we initialize early
  // The beforeSend hook will filter out events when telemetryState.enabled is false
}

function applySettingsDefaults(settings = {}) {
  const normalizedBackground = normalizeBackgroundSettings(settings?.backgroundSync || {});
  return {
    ...settings,
    backgroundSync: normalizedBackground,
  };
}

async function loadInitialSettings() {
  try {
    const initialSettings = applySettingsDefaults(await sessionStore.getSettings());
    appSettingsCache = initialSettings;
    await applyTelemetryPreference(initialSettings);
  } catch (error) {
    logger.warn('Failed to load user settings', { error: error.message });
  }
}

async function getAppSettings() {
  const settings = applySettingsDefaults(await sessionStore.getSettings());
  appSettingsCache = settings;
  return settings;
}

async function updateAppSettings(patch = {}) {
  const current = await sessionStore.getSettings();
  const merged = {
    ...current,
    ...patch,
    telemetry: {
      ...(current?.telemetry || {}),
      ...(patch?.telemetry || {}),
    },
    backgroundSync: {
      ...(current?.backgroundSync || {}),
      ...(patch?.backgroundSync || {}),
    },
  };
  const updated = await sessionStore.updateSettings(merged);
  const normalized = applySettingsDefaults(updated);
  appSettingsCache = normalized;
  await applyTelemetryPreference(normalized);
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('settings:changed', normalized);
  });
  if (syncScheduler) {
    syncScheduler.updateSettings(normalized);
  }
  return normalized;
}

function shouldKeepRunningInTray() {
  if (process.platform === 'darwin') {
    return false;
  }
  const keepRunning = appSettingsCache?.backgroundSync?.keepRunningInTray;
  return keepRunning !== false;
}

function getTelemetryDiagnostics() {
  return describeTelemetryState({
    enabled: telemetryState.enabled,
    initialized: telemetryState.initialized,
  });
}

function reportException(error) {
  if (telemetryState.initialized && telemetryState.sentry?.captureException) {
    try {
      telemetryState.sentry.captureException(error);
    } catch (captureError) {
      logger.warn('Failed to forward exception to telemetry client', { error: captureError.message });
    }
  }
}

// Lazy-loaded services (to avoid loading better-sqlite3 in dev mode)
let healthService = null;
let scrapingService = null;
let setupAPIServer = null;

async function initializeBackendServices({ skipEmbeddedApi = false, skipDbInit } = {}) {
  const shouldSkipDbInit = typeof skipDbInit === 'boolean' ? skipDbInit : skipEmbeddedApi;
  try {
    console.log('Initializing application configuration...');
    logger.info('Initializing configuration');
    await ensureEncryptionKey();
    const config = await configManager.initializeConfig();
    logger.info('Configuration initialised', {
      databaseMode: config?.database?.mode,
    });
    await ensureEncryptionKey(config);

    if (!config.database) {
      config.database = {};
    }
    const requestedMode = (config.database.mode || '').toLowerCase();
    config.database.mode = requestedMode === 'postgres' ? 'postgres' : 'sqlite';

    if (config.database.mode === 'postgres') {
      process.env.USE_SQLITE = 'false';
      delete process.env.SQLITE_DB_PATH;

      process.env.CLARIFY_DB_USER = config.database.user;
      process.env.CLARIFY_DB_HOST = config.database.host;
      process.env.CLARIFY_DB_NAME = config.database.database;
      process.env.CLARIFY_DB_PASSWORD = config.database.password;
      process.env.CLARIFY_DB_PORT = String(config.database.port ?? 5432);
    } else {
      process.env.USE_SQLITE = 'true';
      const defaultSqlitePath = resolveDefaultUserDataSqlitePath();
      const basePath = process.env.SQLITE_DB_PATH || config.database.path || defaultSqlitePath;
      process.env.SQLITE_DB_PATH = basePath;
      config.database.path = basePath;
    }

    // Ensure dbManager mode matches the resolved config (constructor runs before env is set)
    dbManager.mode = config.database.mode;

    if (!skipEmbeddedApi && !setupAPIServer) {
      try {
        setupAPIServer = require('./server').setupAPIServer;
      } catch (error) {
        console.log('API server module not available, running in basic mode:', error.message);
        setupAPIServer = null;
      }
    }

    let dbResult = { success: true };
    if (shouldSkipDbInit) {
      console.log('Skipping main-process database initialization (SKIP_DB_INIT=true).');
    } else {
      console.log('Initializing database connection...');
      logger.info('Connecting to database', { mode: config.database.mode });
      dbResult = await dbManager.initialize(config.database);

      if (!dbResult.success) {
        console.error('Database initialization failed:', dbResult.message);
        logger.error('Database initialization failed', {
          error: dbResult.message,
          mode: config.database.mode,
        });
        dialog.showErrorBox(
          'Database Connection Error',
          `Failed to connect to database: ${dbResult.message}\n\nThe app will run in limited mode.`
        );
      }
    }

    if (!skipEmbeddedApi && setupAPIServer) {
      try {
        const serverResult = await setupAPIServer(mainWindow);
        apiServer = serverResult.server;
        apiPort = serverResult.port;
        apiToken = serverResult.apiToken; // Store API token
        console.log(`API server started on port ${apiPort}`);
        logger.info('Embedded API server started', { port: apiPort });
      } catch (error) {
        console.error('Failed to start API server:', error);
        logger.error('Failed to start embedded API server', { error: error.message });
        console.log('Running without internal API server - using external Next.js dev server');
      }
    } else if (skipEmbeddedApi) {
      console.log('Embedded API server disabled via SKIP_EMBEDDED_API flag.');
    } else {
      console.log('Running without internal API server - relying on external dev renderer');
    }

    getSyncScheduler().start();
  } catch (error) {
    console.error('Initialization error:', error);
    logger.error('Fatal initialization error', { error: error.message });
    dialog.showErrorBox(
      'Initialization Error',
      `Failed to initialize application: ${error.message}`
    );
  }
}

// Helper to lazy-load services only when needed (and not in SQLite dev mode)
function getHealthService() {
  if (!healthService) {
    healthService = require(resolveAppPath('server', 'services', 'health.js'));
  }
  return healthService;
}

function getScrapingService() {
  if (!scrapingService) {
    scrapingService = require(resolveAppPath('server', 'services', 'scraping', 'run.js'));
  }
  return scrapingService;
}

// Keep a global reference of the window object
let mainWindow;
let apiServer;
let apiPort;
let apiToken; // API authentication token for internal API
let appTray;
let syncScheduler;
let appSettingsCache = null;
let isQuitting = false;

// Development mode logging
if (isDev) {
  console.log('Running in development mode');
}
logger.info('Booting ShekelSync Electron shell', {
  environment: process.env.NODE_ENV || 'development',
  isDev,
});

function sanitizeSession(session) {
  if (!session) {
    return null;
  }

  const { refreshToken, ...rest } = session;
  return {
    ...rest,
  };
}

function sendScrapeProgress(payload) {
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('scrape:progress', payload);
  }
}

function getSyncScheduler() {
  if (!syncScheduler) {
    syncScheduler = createSyncScheduler({
      getSettings: getAppSettings,
      updateSettings: async (patch) => updateAppSettings(patch),
      emitProgress: sendScrapeProgress,
      logger,
    });
  }
  return syncScheduler;
}

function emitSessionChanged(session) {
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('auth:session-changed', sanitizeSession(session));
  }
}

function createScrapeLogger(vendor) {
  const prefix = vendor ? `[Scrape:${vendor}]` : '[Scrape]';
  return {
    log: (...args) => console.log(prefix, ...args),
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}

function formatDiagnosticsFilename() {
  return `shekelsync-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
}

async function handleOpenLogFolderRequest() {
  const result = await openDiagnosticsLogDirectory();
  if (!result.success) {
    dialog.showErrorBox('Open Log Folder Failed', result.error || 'Unable to open log folder.');
  }
}

async function handleDiagnosticsExportRequest() {
  const browserWindow = mainWindow || BrowserWindow.getFocusedWindow() || undefined;
  const saveResult = await dialog.showSaveDialog(browserWindow, {
    defaultPath: formatDiagnosticsFilename(),
    filters: [{ name: 'Diagnostics Bundle', extensions: ['json'] }],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { success: false, canceled: true };
  }

  const exportResult = await exportDiagnosticsToFile(saveResult.filePath, {
    appVersion: app.getVersion(),
  });

  if (!exportResult.success) {
    dialog.showErrorBox('Diagnostics Export Failed', exportResult.error || 'Unable to export diagnostics bundle.');
  }

  return exportResult;
}

function getTrayIconPath() {
  const iconDir = path.join(__dirname, '..', 'build-resources');
  if (process.platform === 'win32') {
    const winIcon = path.join(iconDir, 'logo.ico');
    if (fs.existsSync(winIcon)) {
      return winIcon;
    }
  }
  if (process.platform === 'darwin') {
    const templateIcon = path.join(iconDir, 'trayTemplate.png');
    if (fs.existsSync(templateIcon)) {
      return templateIcon;
    }
  }
  const pngIcon = path.join(iconDir, 'logo.png');
  if (fs.existsSync(pngIcon)) {
    return pngIcon;
  }
  return path.join(iconDir, 'logo.png');
}

function setupTray() {
  if (appTray) {
    return;
  }
  const trayIconPath = getTrayIconPath();
  const icon = nativeImage.createFromPath(trayIconPath);
  appTray = new Tray(icon);
  appTray.setToolTip('ShekelSync');
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show ShekelSync',
      click: () => {
        if (mainWindow) {
          if (!mainWindow.isVisible()) {
            mainWindow.show();
          }
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Open Log Folder',
      click: () => {
        handleOpenLogFolderRequest();
      },
    },
    {
      label: 'Export Diagnostics…',
      click: () => {
        handleDiagnosticsExportRequest();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);
  appTray.setContextMenu(contextMenu);
  appTray.on('click', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
    }
  });
}

async function createWindow() {
  const skipEmbeddedApi = process.env.SKIP_EMBEDDED_API === 'true';
  const devRendererUrl = process.env.RENDERER_DEV_URL || 'http://localhost:5173';

  if (isDev) {
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
  }

  // Apply a conservative Content Security Policy in production.
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'self'",
      ].join('; ');

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
        },
      });
    });
  }

  // Determine icon path based on platform and environment
  const getIconPath = () => {
    const iconDir = path.join(__dirname, '..', 'build-resources');

    if (process.platform === 'win32') {
      return path.join(iconDir, 'logo.ico');
    } else if (process.platform === 'darwin') {
      // For macOS, use .icns if available, fallback to .png
      const icnsPath = path.join(iconDir, 'logo.icns');
      return fs.existsSync(icnsPath) ? icnsPath : path.join(iconDir, 'logo.png');
    } else {
      // Linux and others use PNG
      return path.join(iconDir, 'logo.png');
    }
  };

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'ShekelSync - Personal Finance Tracker',
    backgroundColor: '#00000000', // Transparent for rounded corners
    frame: false, // Frameless on all platforms
    titleBarStyle: 'hidden', // Custom title bar handling
    titleBarOverlay: isMac, // Only needed for macOS traffic lights
    transparent: true, // Enable transparency for rounded corners on all platforms
    roundedCorners: true, // Enable rounded corners
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false, // Security: disable node integration
      contextIsolation: true, // Security: enable context isolation
      enableRemoteModule: false, // Security: disable remote module
      sandbox: true, // Security: enable sandbox mode
      preload: path.join(__dirname, 'preload.js'), // Load preload script
      webSecurity: true,
      // Performance optimizations
      experimentalFeatures: false,
      spellcheck: false,
      backgroundThrottling: false,
      allowRunningInsecureContent: false
    },
    icon: getIconPath(),
    show: false, // Don't show until ready
  });

  let windowShown = false;
  const ensureWindowVisible = () => {
    if (!mainWindow || windowShown || mainWindow.isDestroyed()) {
      return;
    }
    windowShown = true;
    console.log('Electron main window ready, displaying now...');
    mainWindow.center(); // Ensure window appears on primary display
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    if (!mainWindow.isFocused()) {
      mainWindow.focus();
    }
    if (isDev && !mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.openDevTools();
    }
  };

  mainWindow.once('ready-to-show', () => {
    console.log('BrowserWindow emitted ready-to-show');
    ensureWindowVisible();
  });
  mainWindow.webContents.once('did-finish-load', () => {
    console.log('WebContents finished load');
    ensureWindowVisible();
  });
  setTimeout(() => {
    console.log('Fallback timer triggering ensureWindowVisible');
    ensureWindowVisible();
  }, 1500);

  // Send window state changes to renderer
  const emitWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:state-changed', { maximized: mainWindow.isMaximized() });
  };

  mainWindow.on('maximize', emitWindowState);
  mainWindow.on('unmaximize', emitWindowState);

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return;
    }
    if (shouldKeepRunningInTray()) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Kick off heavy initialization in the background so the window can appear sooner
  setImmediate(() => {
    initializeBackendServices({ skipEmbeddedApi }).catch((error) => {
      console.error('Background initialization failed:', error);
    });
  });

  // Start renderer server in development
  // Load the app
  if (isDev) {
    console.log(`Loading renderer from ${devRendererUrl}`);
    await mainWindow.loadURL(devRendererUrl);
  } else {
    const viteDist = resolveRendererPath('dist', 'index.html');
    if (fs.existsSync(viteDist)) {
      console.log('Loading Vite renderer bundle');
      await mainWindow.loadFile(viteDist);
    } else {
      console.error('Vite renderer build not found. Expected at', viteDist);
      logger.error('Missing Vite renderer bundle', { path: viteDist });
      app.quit();
      return;
    }
  }

  ensureWindowVisible();
  emitWindowState();

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Prevent navigation to external websites
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    const allowedOrigins = new Set([
      'file://',
      'http://localhost:3000',
      'http://localhost:5173',
    ]);
    if (!allowedOrigins.has(parsedUrl.origin)) {
      event.preventDefault();
    }
  });
}

// App event handlers
app.whenReady().then(async () => {
  await loadInitialSettings();

  // Touch ID authentication on macOS
  if (isMac) {
    try {
      const biometricAuthManager = require('./auth/biometric-auth');
      const isAvailable = await biometricAuthManager.isAvailable();

      if (isAvailable) {
        logger.info('[Main] Touch ID is available, prompting for authentication...');
        try {
          const result = await biometricAuthManager.authenticate('Authenticate to open ShekelSync');
          if (result.success) {
            logger.info('[Main] Touch ID authentication successful');
          } else {
            logger.warn('[Main] Touch ID authentication failed, proceeding anyway');
          }
        } catch (error) {
          // If authentication fails or is cancelled, log it but don't block app launch
          logger.warn('[Main] Touch ID authentication error:', error.message);
          console.warn('Touch ID authentication failed:', error.message);
        }
      } else {
        logger.info('[Main] Touch ID not available on this system');
      }
    } catch (error) {
      logger.error('[Main] Error initializing Touch ID:', error.message);
      console.error('Error initializing Touch ID:', error);
    }
  }

  const isIpcSmokeTest = process.env.LICENSE_IPC_SMOKE_TEST === 'true';
  if (isIpcSmokeTest) {
    try {
      await initializeBackendServices({ skipEmbeddedApi: true, skipDbInit: false });
      await runLicenseIpcSmokeTest(process.env.LICENSE_SMOKE_TEST_EMAIL);
    } finally {
      app.quit();
    }
    return;
  }

  await createWindow();
  setupTray();

  if (process.env.LICENSE_SMOKE_TEST_EMAIL) {
    setTimeout(() => {
      runLicenseSmokeTest(process.env.LICENSE_SMOKE_TEST_EMAIL);
    }, 2000);
  }

  // Auto-updater setup (production only)
  if (shouldEnableAutoUpdate()) {
    console.log('Auto-updater enabled, checking for updates...');
    logger.info('Auto-updater enabled, checking for updates');
    
    // Start checking for updates
    autoUpdater.checkForUpdatesAndNotify();

    autoUpdater.on('checking-for-update', () => {
      console.log('Checking for update...');
      if (mainWindow?.webContents) {
        mainWindow.webContents.send('updater:checking-for-update');
      }
    });

    autoUpdater.on('update-available', (info) => {
      console.log('Update available:', info);
      if (mainWindow?.webContents) {
        mainWindow.webContents.send('updater:update-available', {
          version: info.version,
          releaseDate: info.releaseDate,
          releaseNotes: info.releaseNotes,
        });
      }
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('Update not available:', info);
      if (mainWindow?.webContents) {
        mainWindow.webContents.send('updater:update-not-available', {
          version: info.version,
        });
      }
    });

    autoUpdater.on('error', (error) => {
      console.error('Auto-updater error:', error);
      logger.error('Auto-updater error', { error: error.message });
      if (mainWindow?.webContents) {
        mainWindow.webContents.send('updater:error', {
          message: error.message,
        });
      }
    });

    autoUpdater.on('download-progress', (progressObj) => {
      const logMessage = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
      console.log(logMessage);
      if (mainWindow?.webContents) {
        mainWindow.webContents.send('updater:download-progress', {
          percent: Math.round(progressObj.percent),
          bytesPerSecond: progressObj.bytesPerSecond,
          transferred: progressObj.transferred,
          total: progressObj.total,
        });
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('Update downloaded:', info);
      if (dbManager.mode === 'sqlite' && info?.version && info.version !== lastUpdateBackupVersion) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(app.getPath('userData'), 'backups');
        const backupPath = path.join(backupDir, `clarify-update-${info.version}-${timestamp}.sqlite`);
        backupSqliteDatabase(backupPath, { reason: 'auto-update' }).then((result) => {
          if (result.success) {
            lastUpdateBackupVersion = info.version;
          }
        });
      }
      if (mainWindow?.webContents) {
        mainWindow.webContents.send('updater:update-downloaded', {
          version: info.version,
          releaseDate: info.releaseDate,
        });
      }
    });

  } else if (!isDev && autoUpdater) {
    logger.info(`Auto-updater disabled; set ${AUTO_UPDATE_ENV_FLAG}=true to enable.`);
  }
});

app.on('window-all-closed', async () => {
  // Close API server
  if (apiServer) {
    apiServer.close();
  }

  // Close database connection
  try {
    await dbManager.close();
  } catch (error) {
    console.error('Error closing database:', error);
  }

  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  if (appTray) {
    appTray.destroy();
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});


// IPC Handlers

ipcMain.on('log:report', (event, payload) => {
  try {
    recordRendererLog({
      ...payload,
      webContentsId: event.sender.id,
    });
  } catch (error) {
    logger.warn('Failed to record renderer log', { error: error.message });
  }
});

ipcMain.handle('diagnostics:getInfo', async () => {
  return getDiagnosticsInfo({
    appVersion: app.getVersion(),
    telemetry: getTelemetryDiagnostics(),
  });
});

ipcMain.handle('diagnostics:openLogDirectory', async () => {
  return openDiagnosticsLogDirectory();
});

ipcMain.handle('diagnostics:export', async (event, outputPath) => {
  if (!requireTrustedIpcSender(event, 'diagnostics:export')) {
    return { success: false, error: 'Untrusted IPC sender' };
  }
  if (!outputPath) {
    return { success: false, error: 'No destination selected' };
  }
  if (!consumeApprovedFileWrite(outputPath)) {
    return { success: false, error: 'File write not approved. Please choose a destination again.' };
  }
  return exportDiagnosticsToFile(outputPath, {
    appVersion: app.getVersion(),
    telemetry: getTelemetryDiagnostics(),
  });
});

ipcMain.handle('diagnostics:copy', async (event) => {
  if (!requireTrustedIpcSender(event, 'diagnostics:copy')) {
    return { success: false, error: 'Untrusted IPC sender' };
  }
  try {
    const payload = await buildDiagnosticsPayload({
      appVersion: app.getVersion(),
      telemetry: getTelemetryDiagnostics(),
    });
    clipboard.writeText(JSON.stringify(payload, null, 2));
    return { success: true };
  } catch (error) {
    console.error('Diagnostics copy failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('database:backup', async (event, targetPath) => {
  if (!requireTrustedIpcSender(event, 'database:backup')) {
    return { success: false, error: 'Untrusted IPC sender' };
  }
  if (!targetPath) {
    return { success: false, error: 'No destination selected' };
  }
  if (!consumeApprovedFileWrite(targetPath)) {
    return { success: false, error: 'File write not approved. Please choose a destination again.' };
  }
  return backupSqliteDatabase(targetPath, { reason: 'manual' });
});

ipcMain.handle('database:restore', async (event, sourcePath) => {
  if (!requireTrustedIpcSender(event, 'database:restore')) {
    return { success: false, error: 'Untrusted IPC sender' };
  }
  return restoreSqliteDatabase(sourcePath);
});

// Biometric authentication
ipcMain.handle('biometric:isAvailable', async () => {
  try {
    const biometricAuthManager = require('./auth/biometric-auth');
    const availability = await biometricAuthManager.getAvailabilityDetails();
    return {
      success: true,
      available: availability.available,
      type: availability.type,
      reason: availability.reason,
    };
  } catch (error) {
    console.error('[IPC] Biometric availability check failed:', error);
    return { success: false, available: false, error: error.message };
  }
});

ipcMain.handle('biometric:authenticate', async (_event, reason) => {
  try {
    const biometricAuthManager = require('./auth/biometric-auth');
    const result = await biometricAuthManager.authenticate(reason);
    return result;
  } catch (error) {
    console.error('[IPC] Biometric authentication failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('biometric:getStatus', async () => {
  try {
    const biometricAuthManager = require('./auth/biometric-auth');
    const status = await biometricAuthManager.getStatus();
    return { success: true, data: status };
  } catch (error) {
    console.error('[IPC] Biometric status check failed:', error);
    return { success: false, error: error.message };
  }
});

// Database operations
ipcMain.handle('db:query', async (event, sql, params = []) => {
  if (!requireTrustedIpcSender(event, 'db:query')) {
    return { success: false, error: 'Untrusted IPC sender' };
  }
  if (!allowUnsafeIpc) {
    return { success: false, error: 'Database query IPC is disabled.' };
  }
  try {
    const result = await dbManager.query(sql, params);
    return { success: true, data: result.rows, rowCount: result.rowCount };
  } catch (error) {
    console.error('IPC Database query error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db:test', async (event) => {
  if (!requireTrustedIpcSender(event, 'db:test')) {
    return { success: false, error: 'Untrusted IPC sender' };
  }
  if (!allowUnsafeIpc) {
    return { success: false, error: 'Database IPC is disabled.' };
  }
  try {
    const result = await dbManager.testConnection();
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db:stats', async (event) => {
  if (!requireTrustedIpcSender(event, 'db:stats')) {
    return { success: false, error: 'Untrusted IPC sender' };
  }
  if (!allowUnsafeIpc) {
    return { success: false, error: 'Database IPC is disabled.' };
  }
  try {
    const stats = await dbManager.getStats();
    return { success: true, stats };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Core API operations
ipcMain.handle('api:ping', async () => {
  try {
    const startTime = Date.now();
    const health = await getHealthService().ping();
    const dbTest = await dbManager.testConnection();
    const responseTime = Date.now() - startTime;

    if (!health.ok) {
      return {
        success: false,
        error: health.error,
        data: {
          status: health.status,
          database: 'disconnected',
          environment: process.env.NODE_ENV || 'development',
          version: '0.1.0'
        }
      };
    }

    return {
      success: true,
      data: {
        status: 'ok',
        message: 'ShekelSync Electron API is running',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
        database: dbTest.success ? 'connected' : 'disconnected',
        environment: process.env.NODE_ENV || 'development',
        version: '0.1.0'
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('api:credentials', async () => {
  try {
    const query = `
      SELECT
        id,
        vendor,
        nickname,
        credential_type,
        created_at,
        updated_at,
        is_active
      FROM vendor_credentials
      WHERE is_active = true
      ORDER BY created_at DESC
    `;

    const result = await dbManager.query(query);
    return {
      success: true,
      data: {
        credentials: result.rows,
        count: result.rows.length
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('api:categories', async () => {
  try {
    const query = `
      SELECT
        COALESCE(parent.id, cd.id) AS category_definition_id,
        COALESCE(parent.name, cd.name) AS category,
        parent.name AS parent_category,
        COUNT(*) as transaction_count,
        SUM(CASE WHEN t.price < 0 THEN ABS(t.price) ELSE 0 END) as total_spent
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
      WHERE t.category_definition_id IS NOT NULL
      GROUP BY
        COALESCE(parent.id, cd.id),
        COALESCE(parent.name, cd.name),
        parent.name
      ORDER BY total_spent DESC
    `;

    const result = await dbManager.query(query);
    const categories = result.rows.map(row => ({
      ...row,
      total_spent: parseFloat(row.total_spent) || 0,
      transaction_count: parseInt(row.transaction_count) || 0
    }));

    return {
      success: true,
      data: {
        categories: categories,
        count: categories.length
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Scraping handlers
ipcMain.handle('scrape:start', async (event, options, credentials) => {
  const vendor = options?.companyId;

  try {
    if (!vendor || !options?.startDate || !credentials) {
      throw new Error('Missing required fields: companyId, startDate, or credentials');
    }

    sendScrapeProgress({
      vendor,
      status: 'starting',
      progress: 5,
      message: 'Preparing scraper...',
    });

    const logger = createScrapeLogger(vendor);
    const result = await getScrapingService().runScrape({
      options,
      credentials,
      logger,
    });

    const transactionCount = Array.isArray(result.accounts)
      ? result.accounts.reduce(
          (sum, account) => sum + (Array.isArray(account.txns) ? account.txns.length : 0),
          0,
        )
      : 0;

    sendScrapeProgress({
      vendor,
      status: 'completed',
      progress: 100,
      message: `Scraping completed (${transactionCount} transactions)`,
      transactions: transactionCount,
    });

    return { success: true, data: { ...result, transactionCount } };
  } catch (error) {
    console.error('Scrape operation failed:', error);

    if (vendor) {
      sendScrapeProgress({
        vendor,
        status: 'failed',
        progress: 100,
        message: error?.message || 'Scraping failed',
        error: error?.message,
      });
    }

    return { success: false, error: error?.message || 'Scraping failed' };
  }
});

ipcMain.handle('scrape:events', async (event, limit = 100) => {
  try {
    const result = await dbManager.query(
      `SELECT id, triggered_by, vendor, start_date, status, message, created_at
       FROM scrape_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [Math.min(parseInt(limit), 500)]
    );

    return { success: true, data: result.rows };
  } catch (error) {
    console.error('Failed to fetch scrape events:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('scrape:test', async (event, companyId) => {
  try {
    const path = require('path');
    let CompanyTypes;
    try {
      const scraperModule = requireFromApp('israeli-bank-scrapers');
      CompanyTypes = scraperModule.CompanyTypes;
    } catch (error) {
      const scraperModule = require('israeli-bank-scrapers');
      CompanyTypes = scraperModule.CompanyTypes;
    }
    const companyType = CompanyTypes[companyId];

    if (!companyType) {
      return { success: false, error: `Invalid company ID: ${companyId}` };
    }

    return {
      success: true,
      data: {
        companyId,
        companyType,
        isSupported: true
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Window controls
ipcMain.handle('window:minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return false;

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }

  return mainWindow.isMaximized();
});

ipcMain.handle('window:close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// Zoom controls
ipcMain.handle('window:zoomIn', () => {
  if (!mainWindow) return;
  const currentZoom = mainWindow.webContents.getZoomLevel();
  mainWindow.webContents.setZoomLevel(currentZoom + 0.5);
  return mainWindow.webContents.getZoomLevel();
});

ipcMain.handle('window:zoomOut', () => {
  if (!mainWindow) return;
  const currentZoom = mainWindow.webContents.getZoomLevel();
  mainWindow.webContents.setZoomLevel(currentZoom - 0.5);
  return mainWindow.webContents.getZoomLevel();
});

ipcMain.handle('window:zoomReset', () => {
  if (!mainWindow) return;
  mainWindow.webContents.setZoomLevel(0);
  return 0;
});

ipcMain.handle('window:getZoomLevel', () => {
  return mainWindow ? mainWindow.webContents.getZoomLevel() : 0;
});

// Get API token (for authenticated requests)
ipcMain.handle('api:getToken', () => {
  if (!apiToken) {
    return { success: false, error: 'API token not available' };
  }
  return { success: true, token: apiToken };
});

// API proxy handler
ipcMain.handle('api:request', async (event, { method, endpoint, data, headers = {} }) => {
  try {
    // Use internal API server if available, otherwise hit the embedded Next renderer (dev only)
    const baseUrl = apiPort ? `http://localhost:${apiPort}` : 'http://localhost:3000';
    const url = `${baseUrl}${endpoint}`;

    const fetchOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    // Add authentication token if API server is running
    if (apiToken) {
      fetchOptions.headers['Authorization'] = `Bearer ${apiToken}`;
    }

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      fetchOptions.body = JSON.stringify(data);
    }

    const response = await fetch(url, fetchOptions);
    const responseData = await response.text();

    let parsedData;
    try {
      parsedData = JSON.parse(responseData);
    } catch {
      parsedData = responseData;
    }

    return {
      status: response.status,
      statusText: response.statusText,
      data: parsedData,
      ok: response.ok
    };
  } catch (error) {
    console.error('API request failed:', error);
    return {
      status: 500,
      statusText: 'Internal Server Error',
      data: { error: error.message },
      ok: false
    };
  }
});

ipcMain.handle('settings:get', async () => {
  try {
    const settings = await getAppSettings();
    return { success: true, settings };
  } catch (error) {
    logger.error('Failed to load application settings', { error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('settings:update', async (event, patch = {}) => {
  try {
    const updated = await updateAppSettings(patch);
    return { success: true, settings: updated };
  } catch (error) {
    logger.error('Failed to update application settings', { error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('telemetry:getConfig', () => ({
  dsn: process.env.SENTRY_DSN || null,
  environment: process.env.NODE_ENV || 'production',
  release: app.getVersion(),
  debug: process.env.SENTRY_DEBUG === 'true',
  enabled: telemetryState.enabled,
}));

ipcMain.handle('telemetry:triggerMainSmoke', async () => {
  if (!telemetryState.sentry || !telemetryState.initialized) {
    return { success: false, error: 'Crash reporting is disabled.' };
  }
  try {
    reportException(new Error(`Telemetry smoke test (main process) @ ${new Date().toISOString()}`));
    return { success: true };
  } catch (error) {
    logger.warn('Telemetry smoke test failed', { error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:getSession', async () => {
  try {
    const session = await sessionStore.load();
    return { success: true, session: sanitizeSession(session) };
  } catch (error) {
    console.error('Failed to load auth session:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:setSession', async (event, session) => {
  try {
    if (session && typeof session !== 'object') {
      throw new Error('Session payload must be an object or null');
    }
    const saved = await sessionStore.save(session || null);
    emitSessionChanged(saved);
    return { success: true, session: sanitizeSession(saved) };
  } catch (error) {
    console.error('Failed to persist auth session:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:clearSession', async () => {
  try {
    await sessionStore.clear();
    emitSessionChanged(null);
    return { success: true };
  } catch (error) {
    console.error('Failed to clear auth session:', error);
    return { success: false, error: error.message };
  }
});

// License operations
ipcMain.handle('license:getStatus', async () => {
  try {
    const status = await licenseService.checkLicenseStatus();
    return { success: true, data: status };
  } catch (error) {
    console.error('Failed to get license status:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('license:register', async (event, email) => {
  try {
    const result = await licenseService.registerLicense(email);
    return result;
  } catch (error) {
    console.error('Failed to register license:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('license:validateEmail', async (event, email) => {
  try {
    const result = licenseService.validateEmail(email);
    return { success: true, data: result };
  } catch (error) {
    console.error('Failed to validate email:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('license:activatePro', async (event, paymentRef) => {
  try {
    const result = await licenseService.activateProLicense(paymentRef);
    return result;
  } catch (error) {
    console.error('Failed to activate Pro license:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('license:canWrite', async () => {
  try {
    const canWrite = await licenseService.isWriteOperationAllowed();
    return { success: true, canWrite };
  } catch (error) {
    console.error('Failed to check write permission:', error);
    return { success: true, canWrite: true }; // Fail-open to not block users
  }
});

ipcMain.handle('license:validateOnline', async () => {
  try {
    const result = await licenseService.validateOnline();
    return result;
  } catch (error) {
    console.error('Failed to validate license online:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('license:getInfo', async () => {
  try {
    const info = await licenseService.getLicenseInfo();
    return { success: true, data: info };
  } catch (error) {
    console.error('Failed to get license info:', error);
    return { success: false, error: error.message };
  }
});

// File system operations
ipcMain.handle('file:showSaveDialog', async (event, options) => {
  try {
    if (!requireTrustedIpcSender(event, 'file:showSaveDialog')) {
      return { canceled: true };
    }
    const result = await dialog.showSaveDialog(mainWindow, options);
    if (result && result.filePath) {
      approveFileWrite(result.filePath);
    }
    return result;
  } catch (error) {
    console.error('Save dialog error:', error);
    return { canceled: true };
  }
});

ipcMain.handle('file:showOpenDialog', async (event, options) => {
  try {
    if (!requireTrustedIpcSender(event, 'file:showOpenDialog')) {
      return { canceled: true };
    }
    const result = await dialog.showOpenDialog(mainWindow, options);
    if (result && Array.isArray(result.filePaths)) {
      result.filePaths.forEach((filePath) => approveFileRead(filePath));
    }
    return result;
  } catch (error) {
    console.error('Open dialog error:', error);
    return { canceled: true };
  }
});

ipcMain.handle('file:write', async (event, filePath, data, options = {}) => {
  try {
    if (!requireTrustedIpcSender(event, 'file:write')) {
      return { success: false, error: 'Untrusted IPC sender' };
    }
    if (!filePath) {
      throw new Error('No file path provided');
    }
    if (!consumeApprovedFileWrite(filePath)) {
      return { success: false, error: 'File write not approved. Use the save dialog first.' };
    }
    const encoding = options.encoding ?? 'utf8';
    await fs.promises.writeFile(filePath, data, encoding);
    return { success: true };
  } catch (error) {
    console.error('File write error:', error);
    return { success: false, error: error.message };
  }
});

// App info
ipcMain.handle('app:getVersion', () => {
  return app.getVersion();
});

ipcMain.handle('app:getName', () => {
  return app.getName();
});

ipcMain.handle('app:isPackaged', () => {
  return app.isPackaged;
});

ipcMain.handle('app:relaunch', (event) => {
  try {
    if (!requireTrustedIpcSender(event, 'app:relaunch')) {
      return { success: false, error: 'Untrusted IPC sender' };
    }
    app.relaunch();
    app.exit(0);
    return { success: true };
  } catch (error) {
    console.error('App relaunch failed:', error);
    return { success: false, error: error.message };
  }
});

// Update-related handlers
ipcMain.handle('updater:checkForUpdates', async () => {
  if (!shouldEnableAutoUpdate() || !autoUpdater) {
    return { success: false, error: 'Auto-updater not available' };
  }
  
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo || null };
  } catch (error) {
    console.error('Manual update check failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('updater:downloadUpdate', async () => {
  if (!shouldEnableAutoUpdate() || !autoUpdater) {
    return { success: false, error: 'Auto-updater not available' };
  }
  
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (error) {
    console.error('Manual update download failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('updater:quitAndInstall', async () => {
  if (!shouldEnableAutoUpdate() || !autoUpdater) {
    return { success: false, error: 'Auto-updater not available' };
  }
  
  try {
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  } catch (error) {
    console.error('Manual update install failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('updater:getUpdateInfo', async () => {
  return {
    autoUpdateEnabled: shouldEnableAutoUpdate(),
    currentVersion: app.getVersion(),
    platform: process.platform,
  };
});

// Development helpers
if (isDev) {
  ipcMain.handle('dev:reload', () => {
    if (mainWindow) {
      mainWindow.reload();
    }
  });

  ipcMain.handle('dev:toggleDevTools', () => {
    if (mainWindow) {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  reportException(error);
  dialog.showErrorBox('Unexpected Error', `An unexpected error occurred: ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  logger.error('Unhandled rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  if (reason instanceof Error) {
    reportException(reason);
  } else {
    reportException(new Error(String(reason)));
  }
  dialog.showErrorBox('Unexpected Error', `An unexpected error occurred: ${reason}`);
});

module.exports = { mainWindow };
