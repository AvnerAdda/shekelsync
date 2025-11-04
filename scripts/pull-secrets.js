#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipOp = args.includes('--no-op');
const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(__dirname, 'secrets-map.json');

if (!fs.existsSync(configPath)) {
  console.error('[pull-secrets] Missing configuration file at scripts/secrets-map.json');
  console.error('Populate it using the template in docs/secrets-vault.md before running this script.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const envConfig = Array.isArray(config.env) ? config.env : [];
const fileConfig = Array.isArray(config.files) ? config.files : [];

const envOutput = {};
const generatedFiles = [];
const errors = [];
const warnings = [];

let opChecked = false;
let opAvailable = false;

function logInfo(message) {
  console.log(`[pull-secrets] ${message}`);
}

function maskValue(value) {
  if (!value) {
    return '';
  }
  const str = String(value);
  if (str.length <= 6) {
    return '*'.repeat(str.length);
  }
  return `${str.slice(0, 3)}***${str.slice(-2)}`;
}

function ensureDirectory(targetDir) {
  if (dryRun) {
    return;
  }
  fs.mkdirSync(targetDir, { recursive: true });
}

function getConfigHome() {
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function getSigningDirectory() {
  return path.join(getConfigHome(), 'shekelsync', 'signing');
}

function ensureOpCli() {
  if (skipOp) {
    return;
  }
  if (opChecked) {
    return;
  }
  opChecked = true;
  const result = spawnSync('op', ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    warnings.push('1Password CLI (op) is not available; falling back to environment variables where provided.');
    opAvailable = false;
  } else {
    opAvailable = true;
  }
}

function readFromOp(opPath) {
  ensureOpCli();
  if (!opAvailable) {
    return null;
  }

  const result = spawnSync('op', ['read', opPath], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    const message = (result.stderr || '').trim() || `Unable to read secret at ${opPath}`;
    return { error: message };
  }

  return { value: result.stdout.trim() };
}

function resolveEnvSecret(entry) {
  const existing = process.env[entry.key];
  if (existing) {
    return existing;
  }
  if (!entry.op) {
    if (entry.required) {
      errors.push(`Secret ${entry.key} is required but has no configured op path or environment variable.`);
    } else {
      warnings.push(`Secret ${entry.key} not provided and no op path defined; skipping.`);
    }
    return null;
  }

  const result = readFromOp(entry.op);
  if (result && result.error) {
    if (entry.required) {
      errors.push(`${entry.key}: ${result.error}`);
    } else {
      warnings.push(`${entry.key}: ${result.error}`);
    }
    return null;
  }

  return result ? result.value : null;
}

function decodeFileContent(rawValue, encoding) {
  if (rawValue == null) {
    return null;
  }
  if (!encoding || encoding === 'plain' || encoding === 'utf8') {
    return Buffer.from(rawValue, 'utf8');
  }
  if (encoding === 'base64') {
    return Buffer.from(rawValue, 'base64');
  }
  warnings.push(`Unknown encoding "${encoding}" encountered; treating value as utf8.`);
  return Buffer.from(rawValue, 'utf8');
}

function resolveFileSecret(entry, signingDir) {
  const envValue = entry.envVar ? process.env[entry.envVar] : null;
  let rawValue = envValue;

  if (!rawValue && entry.op) {
    const result = readFromOp(entry.op);
    if (result && result.error) {
      if (entry.required) {
        errors.push(`${entry.name}: ${result.error}`);
      } else {
        warnings.push(`${entry.name}: ${result.error}`);
      }
      return null;
    }
    rawValue = result ? result.value : null;
  }

  if (!rawValue) {
    if (entry.required) {
      errors.push(`Secret ${entry.name} is required but not available.`);
    } else {
      warnings.push(`Secret ${entry.name} missing; skipping file generation.`);
    }
    return null;
  }

  const buffer = decodeFileContent(rawValue, entry.encoding);
  if (!buffer) {
    errors.push(`Secret ${entry.name} could not be decoded.`);
    return null;
  }

  const targetPath = path.join(signingDir, entry.name);
  if (!dryRun) {
    ensureDirectory(path.dirname(targetPath));
    fs.writeFileSync(targetPath, buffer);
  }
  generatedFiles.push(targetPath);
  return targetPath;
}

function loadExistingEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const content = fs.readFileSync(envPath, 'utf8');
  return content.split(/\r?\n/).reduce((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return acc;
    }
    const idx = trimmed.indexOf('=');
    if (idx === -1) {
      return acc;
    }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^"|"$/g, '');
    if (key) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function writeEnvFile(envPath, values) {
  const existing = loadExistingEnv(envPath);
  const merged = { ...existing, ...values };
  const lines = [
    '# Auto-generated by scripts/pull-secrets.js',
    `# Timestamp: ${new Date().toISOString()}`,
    '',
  ];

  Object.keys(merged)
    .sort()
    .forEach((key) => {
      const value = merged[key];
      if (value === undefined || value === null || value === '') {
        return;
      }
      lines.push(`${key}=${value}`);
    });

  const content = `${lines.join('\n')}\n`;
  if (!dryRun) {
    const backupPath = `${envPath}.bak`;
    if (fs.existsSync(envPath)) {
      fs.copyFileSync(envPath, backupPath);
      logInfo(`Existing ${path.relative(rootDir, envPath)} backed up to ${path.relative(rootDir, backupPath)}`);
    }
    fs.writeFileSync(envPath, content);
  }
  return Object.keys(values);
}

function main() {
  const signingDir = getSigningDirectory();
  const envPath = path.join(rootDir, 'app', '.env.local');
  const collectedEnv = {};

  envConfig.forEach((entry) => {
    const value = resolveEnvSecret(entry);
    if (value) {
      collectedEnv[entry.key] = value;
    }
  });

  const filePaths = {};
  fileConfig.forEach((entry) => {
    const filePath = resolveFileSecret(entry, signingDir);
    if (filePath) {
      filePaths[entry.name] = filePath;
    }
  });

  if (errors.length > 0) {
    errors.forEach((message) => console.error(`[pull-secrets] ERROR: ${message}`));
    process.exit(1);
  }

  if (collectedEnv.MACOS_CERT_PASSWORD && filePaths['macos-cert.p12']) {
    collectedEnv.CSC_LINK = filePaths['macos-cert.p12'];
    collectedEnv.CSC_KEY_PASSWORD = collectedEnv.MACOS_CERT_PASSWORD;
  }

  if (collectedEnv.WINDOWS_CERT_PASSWORD && filePaths['windows-cert.pfx']) {
    collectedEnv.WIN_CSC_LINK = filePaths['windows-cert.pfx'];
    collectedEnv.WIN_CSC_KEY_PASSWORD = collectedEnv.WINDOWS_CERT_PASSWORD;
  }

  if (collectedEnv.LINUX_GPG_PASSPHRASE && filePaths['linux-gpg.key']) {
    collectedEnv.LINUX_GPG_KEY_PATH = filePaths['linux-gpg.key'];
    if (!collectedEnv.CSC_LINK && !collectedEnv.CSC_KEY_PASSWORD) {
      collectedEnv.CSC_LINK = filePaths['linux-gpg.key'];
      collectedEnv.CSC_KEY_PASSWORD = collectedEnv.LINUX_GPG_PASSPHRASE;
    }
  }

  const updatedKeys = writeEnvFile(envPath, collectedEnv);

  if (warnings.length > 0) {
    warnings.forEach((message) => console.warn(`[pull-secrets] WARN: ${message}`));
  }

  logInfo(dryRun ? 'Dry run complete.' : 'Secrets pulled successfully.');
  if (updatedKeys.length > 0) {
    logInfo(`Updated ${path.relative(rootDir, envPath)} keys: ${updatedKeys.join(', ')}`);
  } else {
    logInfo('No environment entries were updated.');
  }

  if (generatedFiles.length > 0) {
    generatedFiles.forEach((file) => {
      logInfo(`Materialised signing asset: ${file}`);
    });
  }

  Object.keys(collectedEnv).forEach((key) => {
    logInfo(`Captured ${key}=${maskValue(collectedEnv[key])}`);
  });
}

try {
  main();
} catch (error) {
  console.error(`[pull-secrets] Unexpected failure: ${error.message}`);
  process.exit(1);
}
