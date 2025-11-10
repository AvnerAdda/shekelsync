#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const envPaths = require('env-paths');
const { describeTelemetryState } = require('../electron/telemetry-utils');

const pkg = require('../app/package.json');

const DEFAULT_MAX_BYTES = 1024 * 512; // 512KB per log file
const maxBytes = Number(process.env.LOG_SHIP_MAX_BYTES || DEFAULT_MAX_BYTES);

function parseArgs() {
  const args = process.argv.slice(2);
  let output;
  args.forEach((arg, index) => {
    if (arg === '--output' && args[index + 1]) {
      output = args[index + 1];
    } else if (arg.startsWith('--output=')) {
      output = arg.split('=')[1];
    }
  });
  if (!output) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    output = path.resolve(process.cwd(), `shekelsync-logs-${timestamp}.json`);
  } else {
    output = path.resolve(process.cwd(), output);
  }
  return { output };
}

function userDataCandidates() {
  const explicit = process.env.SHEKELSYNC_USER_DATA;
  if (explicit) {
    return [explicit];
  }
  const appNames = ['ShekelSync', 'Electron'];
  const results = [];
  for (const name of appNames) {
    const paths = envPaths(name, { suffix: '' });
    if (process.platform === 'darwin') {
      results.push(paths.data);
    } else if (process.platform === 'win32') {
      results.push(paths.config);
    } else {
      results.push(paths.config, paths.data);
    }
  }
  return Array.from(new Set(results.filter(Boolean)));
}

function resolveUserDataDir() {
  const candidates = userDataCandidates();
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  // Fall back to first candidate even if it doesn't exist yet
  return candidates[0] || path.join(os.homedir(), '.config', 'ShekelSync');
}

async function readLogTail(filePath) {
  try {
    const stat = await fs.promises.stat(filePath);
    const fd = await fs.promises.open(filePath, 'r');
    const length = Math.min(maxBytes, stat.size);
    const buffer = Buffer.alloc(length);
    const start = Math.max(0, stat.size - length);
    await fd.read(buffer, 0, length, start);
    await fd.close();
    return {
      name: path.basename(filePath),
      size: stat.size,
      lastModified: stat.mtime.toISOString(),
      tail: buffer.toString('utf8'),
    };
  } catch (error) {
    return {
      name: path.basename(filePath),
      error: error.message,
    };
  }
}

async function readTelemetryPreference(userDataDir) {
  try {
    const settingsPath = path.join(userDataDir, 'secure-store', 'settings.json');
    const raw = await fs.promises.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Boolean(parsed?.telemetry?.crashReportsEnabled);
  } catch (error) {
    return false;
  }
}

async function main() {
  const { output } = parseArgs();
  const userDataDir = resolveUserDataDir();
  const logDirectory = path.join(userDataDir, 'logs');

  let logs = [];
  try {
    const entries = await fs.promises.readdir(logDirectory);
    logs = await Promise.all(entries.map((entry) => readLogTail(path.join(logDirectory, entry))));
  } catch (error) {
    logs = [{ error: error.message, directory: logDirectory }];
  }

  const telemetryEnabled = await readTelemetryPreference(userDataDir);
  const telemetry = describeTelemetryState({ enabled: telemetryEnabled, initialized: false });

  const bundle = {
    generatedAt: new Date().toISOString(),
    host: os.hostname(),
    platform: process.platform,
    release: os.release(),
    appVersion: pkg.version,
    userDataDir,
    logDirectory,
    telemetry,
    telemetrySummary: telemetry
      ? {
          status: telemetry.enabled ? 'opted-in' : 'opted-out',
          destination: telemetry.dsnHost || null,
          initialized: Boolean(telemetry.initialized),
          debug: Boolean(telemetry.debug),
        }
      : null,
    logs,
  };

  await fs.promises.writeFile(output, JSON.stringify(bundle, null, 2), 'utf8');
  console.log(`Diagnostics bundle written to ${output}`);
}

main().catch((error) => {
  console.error('Failed to collect logs:', error);
  process.exit(1);
});
