const fs = require('fs');
const os = require('os');
const { shell } = require('electron');
const { getLogDirectory, getLogFilePath, readRecentLogs } = require('./logger');

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

function getDiagnosticsInfo({ appVersion, telemetry } = {}) {
  return {
    success: true,
    logDirectory: getLogDirectory(),
    logFile: getLogFilePath(),
    appVersion,
    platform: process.platform,
    telemetry,
    telemetrySummary: summarizeTelemetry(telemetry),
  };
}

async function openDiagnosticsLogDirectory() {
  try {
    const directory = getLogDirectory();
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
    logDirectory: getLogDirectory(),
    logTail: await readRecentLogs(),
    telemetry,
    telemetrySummary: summarizeTelemetry(telemetry),
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
};
