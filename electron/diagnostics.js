const fs = require('fs');
const os = require('os');
const { shell } = require('electron');
const { getLogDirectory, getLogFilePath, readRecentLogs } = require('./logger');

function getDiagnosticsInfo({ appVersion }) {
  return {
    success: true,
    logDirectory: getLogDirectory(),
    logFile: getLogFilePath(),
    appVersion,
    platform: process.platform,
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

async function buildDiagnosticsPayload({ appVersion } = {}) {
  return {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    appVersion,
    versions: process.versions,
    logDirectory: getLogDirectory(),
    logTail: await readRecentLogs(),
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
