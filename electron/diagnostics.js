const fs = require('fs');
const os = require('os');
let shell;
try {
  // Electron is not available in unit test environments; fall back to a stub.
  // eslint-disable-next-line global-require
  shell = require('electron').shell;
} catch {
  shell = { openPath: async () => 'electron-unavailable' };
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
  return {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    appVersion,
    versions: process.versions,
    logDirectory: logger.getLogDirectory(),
    logTail: await logger.readRecentLogs(),
    telemetry,
    telemetrySummary: summarizeTelemetry(telemetry),
    analyticsMetrics: getSanitizedMetricsSnapshot(),
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
