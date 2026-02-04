const fs = require('fs');
const path = require('path');
const { requireFromApp } = require('./paths');

let app;
try {
  ({ app } = require('electron'));
} catch {
  app = { getPath: () => process.cwd() };
}

let electronLog;
try {
  electronLog = requireFromApp('electron-log/main');
} catch {
  try {
    electronLog = require('electron-log/main');
  } catch {
    const fallback = (level) => (message) => console[level]?.(message);
    electronLog = {
      initialize: () => {},
      transports: { file: {}, console: {} },
      info: fallback('info'),
      warn: fallback('warn'),
      error: fallback('error'),
      debug: fallback('debug'),
    };
  }
}

electronLog.initialize();

function getLogDirectory() {
  return path.join(app.getPath('userData'), 'logs');
}

function getLogFilePath() {
  return path.join(getLogDirectory(), 'main.log');
}

function ensureLogDirectory() {
  const logDir = getLogDirectory();
  electronLog.transports.file.resolvePath = () => path.join(logDir, 'main.log');
}

ensureLogDirectory();

electronLog.transports.file.level = 'info';
electronLog.transports.file.format = '{text}\n';
electronLog.transports.console.format = '{text}';

function toPayload(level, message, meta = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  });
}

function log(level, message, meta) {
  const entry = toPayload(level, message, meta);
  const target = electronLog[level] || electronLog.info;
  target(entry);
}

const logger = {
  info: (message, meta) => log('info', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  error: (message, meta) => log('error', message, meta),
  debug: (message, meta) => log('debug', message, meta),
};

function recordRendererLog(payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const { level = 'info', message = '', data } = payload;
  const handler = logger[level] || logger.info;
  handler(`renderer:${message}`, { scope: 'renderer', data });
}

async function readRecentLogs(limitBytes = 250_000) {
  try {
    const logFile = getLogFilePath();
    const stat = await fs.promises.stat(logFile);
    const start = Math.max(0, stat.size - limitBytes);
    const fileHandle = await fs.promises.open(logFile, 'r');
    const buffer = Buffer.alloc(stat.size - start);
    await fileHandle.read(buffer, 0, buffer.length, start);
    await fileHandle.close();
    return buffer.toString('utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn('Failed to read recent logs', { error: error.message });
    }
    return null;
  }
}

module.exports = {
  logger,
  recordRendererLog,
  getLogDirectory,
  getLogFilePath,
  readRecentLogs,
};
