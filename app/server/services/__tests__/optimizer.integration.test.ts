import path from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

// better-sqlite3 is rebuilt for Electron in this project, so real database
// integration checks must run under Electron's Node ABI rather than Vitest's.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const electronBinary = require('electron');
const runnerPath = path.join(__dirname, 'optimizer.integration.runner.cjs');

function runScenario(scenario: string) {
  return spawnSync(electronBinary, [runnerPath, scenario], {
    cwd: path.resolve(__dirname, '../../../..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
    timeout: 30_000,
  });
}

describe('optimizer SQLite lifecycle integration', () => {
  it('keeps the last successful plan and retires older linked actions', () => {
    const result = runScenario('lifecycle');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('optimizer-integration:lifecycle:ok');
  });

  it('allows only one in-flight generation', () => {
    const result = runScenario('concurrency');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('optimizer-integration:concurrency:ok');
  });

  it('excludes pending transactions from completed-month facts', () => {
    const result = runScenario('completed-transactions-only');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('optimizer-integration:completed-transactions-only:ok');
  });

  it('upgrades legacy Smart Action history without losing data', () => {
    const result = runScenario('legacy-smart-action-upgrade');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('optimizer-integration:legacy-smart-action-upgrade:ok');
  });

  it('upgrades a near-current schema that rejects generic optimizer actions', () => {
    const result = runScenario('near-current-smart-action-upgrade');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('optimizer-integration:near-current-smart-action-upgrade:ok');
  });
});
