import path from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

// better-sqlite3 is rebuilt for Electron in this project, so real database
// checks must run under Electron's Node ABI rather than Vitest's.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const electronBinary = require('electron');
const runnerPath = path.join(__dirname, 'schema-migrations.runner.cjs');

function runScenario(scenario) {
  return spawnSync(electronBinary, [runnerPath, scenario], {
    cwd: path.resolve(__dirname, '../../..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
    timeout: 30_000,
  });
}

describe('schema migrations (PRAGMA user_version)', () => {
  it('applies pending migrations in order and stamps user_version', () => {
    const result = runScenario('applies-in-order');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('schema-migrations:applies-in-order:ok');
  });

  it('skips migrations that are already applied', () => {
    const result = runScenario('skips-applied');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('schema-migrations:skips-applied:ok');
  });

  it('rolls back the failing migration and keeps the last good version', () => {
    const result = runScenario('rolls-back-on-failure');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('schema-migrations:rolls-back-on-failure:ok');
  });

  it('backs up the database before applying pending migrations', () => {
    const result = runScenario('creates-backup');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('schema-migrations:creates-backup:ok');
  });

  it('rejects out-of-order migration registries', () => {
    const result = runScenario('rejects-bad-registry');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('schema-migrations:rejects-bad-registry:ok');
  });

  it('brings a fresh database to CURRENT_SCHEMA_VERSION with the default registry', () => {
    const result = runScenario('default-registry');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('schema-migrations:default-registry:ok');
  });

  it('migrates legacy assets once, preserves ledger data, and mirrors later updates', () => {
    const result = runScenario('migrates-legacy-investment-assets');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('schema-migrations:migrates-legacy-investment-assets:ok');
  });

  it('preserves legacy duplicate event rows while blocking new duplicate transaction links', () => {
    const result = runScenario('preserves-duplicate-position-event-links');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain(
      'schema-migrations:preserves-duplicate-position-event-links:ok',
    );
  });

  it('upgrades legacy user_version 5 databases with the optimizer v2 schema', () => {
    const result = runScenario('optimizer-v2-from-legacy-v5');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('schema-migrations:optimizer-v2-from-legacy-v5:ok');
  });
});
