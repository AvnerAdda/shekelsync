#!/usr/bin/env node
/**
 * Headless IPC smoke test for license registration.
 *
 * Usage:
 *   node scripts/license-ipc-smoke.js [--no-sandbox]
 *
 * Env:
 *   LICENSE_SMOKE_TEST_EMAIL=you@example.com
 *   SQLITE_DB_PATH=/path/to/clarify.sqlite
 */

const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const passthroughArgs = args.filter((arg) => arg !== '--help' && arg !== '-h');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node scripts/license-ipc-smoke.js [--no-sandbox]

Environment:
  LICENSE_SMOKE_TEST_EMAIL  Email to register (default: smoke+test@example.com)
  SQLITE_DB_PATH            Path to SQLite DB (optional)
`);
  process.exit(0);
}

const electronPath = require(path.join(__dirname, '..', 'app', 'node_modules', 'electron'));
const mainPath = path.join(__dirname, '..', 'electron', 'main.js');
const email = process.env.LICENSE_SMOKE_TEST_EMAIL || 'smoke+test@example.com';

const env = { ...process.env };
env.LICENSE_IPC_SMOKE_TEST = 'true';
env.LICENSE_SMOKE_TEST_EMAIL = email;
env.USE_SQLITE = env.USE_SQLITE || 'true';
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [mainPath, ...passthroughArgs], {
  stdio: 'inherit',
  env,
});

child.on('close', (code) => {
  process.exit(code ?? 1);
});
