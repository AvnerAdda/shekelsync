import path from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';
const electronBinary = require('electron');

describe('planning service, routes and schema on isolated SQLite', () => {
  it('persists records, safely projects reconciled cash, invalidates confirmations, and upgrades idempotently', () => {
    const result = spawnSync(electronBinary, [path.join(__dirname, 'planning.runner.cjs')], {
      cwd: path.resolve(__dirname, '../../../..'), encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'test' }, timeout: 30000,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('planning:integration:ok');
  });
});
