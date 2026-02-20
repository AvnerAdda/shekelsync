const fs = require('fs');
const os = require('os');
const path = require('path');
let shell;
try {
  // Electron is not available in unit test environments; fall back to a stub.
  // eslint-disable-next-line global-require
  shell = require('electron').shell;
} catch {
  shell = { openPath: async () => 'electron-unavailable' };
}
let app;
try {
  ({ app } = require('electron'));
} catch {
  app = null;
}
const { resolveAppPath } = require('./paths');
let logger = {
  getLogDirectory: () => '',
  getLogFilePath: () => '',
  readRecentLogs: async () => [],
};
try {
  // eslint-disable-next-line global-require
  logger = require('./logger');
} catch {
  // Keep stubbed logger when Electron is unavailable (unit tests/CI).
}
let analyticsMetricsStore = require(resolveAppPath('server', 'services', 'analytics', 'metrics-store.js'));

function summarizeTelemetry(telemetry = null) {
  if (!telemetry) {
    return null;
  }
  return {
    status: telemetry.enabled ? 'opted-in' : 'opted-out',
    destination: telemetry.dsnHost || null,
    initialized: Boolean(telemetry.initialized),
    debug: Boolean(telemetry.debug),
  };
}

function getSanitizedMetricsSnapshot() {
  if (!analyticsMetricsStore?.getMetricsSnapshot) {
    return null;
  }
  const raw = analyticsMetricsStore.getMetricsSnapshot() || {};
  const sanitize =
    typeof analyticsMetricsStore.sanitizeMetricSample === 'function'
      ? analyticsMetricsStore.sanitizeMetricSample
      : (sample) => (typeof sample === 'object' ? { ...sample } : {});

  return Object.fromEntries(
    Object.entries(raw).map(([bucket, samples]) => {
      const list = Array.isArray(samples) ? samples : [];
      return [
        bucket,
        list.map((sample) => ({
          ...sanitize(sample),
          recordedAt: sample?.recordedAt || null,
        })),
      ];
    }),
  );
}

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET_REGEX = /(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?([A-Za-z0-9._-]{8,})['"]?/gi;

function redactSensitiveText(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }
  return value
    .replace(EMAIL_REGEX, '[redacted-email]')
    .replace(SECRET_REGEX, (_match, key) => `${key}=[redacted]`);
}

function redactLogPayload(logPayload) {
  if (!logPayload) {
    return logPayload;
  }
  if (typeof logPayload === 'string') {
    return redactSensitiveText(logPayload);
  }
  if (Array.isArray(logPayload)) {
    return logPayload.map((entry) => {
      if (typeof entry === 'string') {
        return redactSensitiveText(entry);
      }
      if (entry && typeof entry === 'object') {
        const next = { ...entry };
        if (typeof next.tail === 'string') {
          next.tail = redactSensitiveText(next.tail);
        }
        if (typeof next.message === 'string') {
          next.message = redactSensitiveText(next.message);
        }
        return next;
      }
      return entry;
    });
  }
  return logPayload;
}

function resolveSqlitePath() {
  if (process.env.SQLITE_DB_PATH) {
    return process.env.SQLITE_DB_PATH;
  }
  if (app?.getPath) {
    return path.join(app.getPath('userData'), 'clarify.sqlite');
  }
  return null;
}

function getConfigHealthSummary() {
  const warnings = [];
  const explicitSqlite =
    process.env.USE_SQLITE === 'true' || Boolean(process.env.SQLITE_DB_PATH);
  const dbMode = explicitSqlite ? 'sqlite' : (process.env.CLARIFY_DB_MODE || 'postgres');

  const sqlitePath = dbMode === 'sqlite' ? resolveSqlitePath() : null;
  let sqliteExists = null;
  if (sqlitePath) {
    sqliteExists = fs.existsSync(sqlitePath);
    if (!sqliteExists) {
      warnings.push({
        code: 'database.sqliteMissing',
        severity: 'warning',
        message: `SQLite database not found at ${sqlitePath}.`,
      });
    } else {
      try {
        fs.accessSync(sqlitePath, fs.constants.R_OK);
      } catch {
        warnings.push({
          code: 'database.sqliteUnreadable',
          severity: 'error',
          message: `SQLite database at ${sqlitePath} is not readable.`,
        });
      }
      try {
        fs.accessSync(path.dirname(sqlitePath), fs.constants.W_OK);
      } catch {
        warnings.push({
          code: 'database.sqliteNotWritable',
          severity: 'warning',
          message: `SQLite database directory is not writable: ${path.dirname(sqlitePath)}.`,
        });
      }
    }
  }

  if (dbMode === 'postgres') {
    const required = ['CLARIFY_DB_USER', 'CLARIFY_DB_HOST', 'CLARIFY_DB_NAME', 'CLARIFY_DB_PASSWORD'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      warnings.push({
        code: 'database.postgresMissing',
        severity: 'warning',
        message: `Missing PostgreSQL settings: ${missing.join(', ')}`,
      });
    }
  }

  const envKey = process.env.SHEKELSYNC_ENCRYPTION_KEY;
  if (envKey && !/^[0-9a-f]{64}$/i.test(envKey)) {
    warnings.push({
      code: 'encryption.invalidEnvKey',
      severity: 'error',
      message: 'SHEKELSYNC_ENCRYPTION_KEY must be a 64-character hex string.',
    });
  }

  if (process.env.ALLOW_DEV_NO_ENCRYPTION === 'true') {
    warnings.push({
      code: 'encryption.allowDevNoEncryption',
      severity: 'error',
      message: 'ALLOW_DEV_NO_ENCRYPTION is enabled. Disable this for production use.',
    });
  }

  const sandboxDisabled =
    process.env.ELECTRON_DISABLE_SANDBOX === '1' || process.env.ELECTRON_DISABLE_SANDBOX === 'true';
  if (sandboxDisabled) {
    warnings.push({
      code: 'security.sandboxDisabled',
      severity: 'warning',
      message: 'Electron sandbox is disabled via ELECTRON_DISABLE_SANDBOX.',
    });
  }

  const autoUpdateEnabled = process.env.ENABLE_AUTO_UPDATE === 'true';
  if (app?.isPackaged && !autoUpdateEnabled) {
    warnings.push({
      code: 'updates.disabled',
      severity: 'info',
      message: 'Auto-updates are disabled (ENABLE_AUTO_UPDATE=false).',
    });
  }

  return {
    database: {
      mode: dbMode,
      sqlitePath,
      sqliteExists,
    },
    autoUpdateEnabled,
    warnings,
  };
}

function getDiagnosticsInfo({ appVersion, telemetry } = {}) {
  return {
    success: true,
    logDirectory: logger.getLogDirectory(),
    logFile: logger.getLogFilePath(),
    appVersion,
    platform: process.platform,
    telemetry,
    telemetrySummary: summarizeTelemetry(telemetry),
    analyticsMetrics: getSanitizedMetricsSnapshot(),
    configHealth: getConfigHealthSummary(),
  };
}

async function openDiagnosticsLogDirectory() {
  try {
    const directory = logger.getLogDirectory();
    await fs.promises.mkdir(directory, { recursive: true });
    const errorMessage = await shell.openPath(directory);
    if (errorMessage) {
      return { success: false, error: errorMessage };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function buildDiagnosticsPayload({ appVersion, telemetry } = {}) {
  const rawLogTail = await logger.readRecentLogs();
  return {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    appVersion,
    versions: process.versions,
    logDirectory: logger.getLogDirectory(),
    logTail: redactLogPayload(rawLogTail),
    telemetry,
    telemetrySummary: summarizeTelemetry(telemetry),
    analyticsMetrics: getSanitizedMetricsSnapshot(),
    configHealth: getConfigHealthSummary(),
  };
}

async function exportDiagnosticsToFile(filePath, options = {}) {
  if (!filePath) {
    return { success: false, error: 'No destination provided' };
  }

  const payload = await buildDiagnosticsPayload(options);
  try {
    await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  getDiagnosticsInfo,
  openDiagnosticsLogDirectory,
  exportDiagnosticsToFile,
  buildDiagnosticsPayload,
  // Test hook
  __setAnalyticsMetricsStore(mock) {
    analyticsMetricsStore = mock || require(resolveAppPath('server', 'services', 'analytics', 'metrics-store.js'));
  },
  __resetAnalyticsMetricsStore() {
    analyticsMetricsStore = require(resolveAppPath(
      'server',
      'services',
      'analytics',
      'metrics-store.js',
    ));
  },
  __setLogger(mock) {
    if (mock) {
      logger = mock;
    }
  },
};
