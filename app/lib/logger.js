/**
 * Centralized logging utility for the backend (main/renderer process)
 * Uses electron-log for proper file logging and console output
 */

const isDevelopment = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

// Simple console logger for test environment or when electron-log is not available
class SimpleLogger {
  debug(message, ...args) {
    if (isDevelopment && !isTest) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message, ...args) {
    if (!isTest) {
      console.info(`[INFO] ${message}`, ...args);
    }
  }

  warn(message, ...args) {
    console.warn(`[WARN] ${message}`, ...args);
  }

  error(message, ...args) {
    console.error(`[ERROR] ${message}`, ...args);
  }

  log(message, ...args) {
    if (!isTest) {
      console.log(message, ...args);
    }
  }
}

// Try to use electron-log if available, otherwise fall back to simple logger
let logger;

try {
  // Attempt to load electron-log
  const electronLog = require('electron-log');

  // Configure electron-log
  if (electronLog && typeof electronLog.transports === 'object') {
    electronLog.transports.console.level = isDevelopment ? 'debug' : 'info';
    electronLog.transports.file.level = 'info';
    logger = electronLog;
  } else {
    logger = new SimpleLogger();
  }
} catch (error) {
  // electron-log not available (tests, standalone scripts, etc.)
  logger = new SimpleLogger();
}

module.exports = logger;
