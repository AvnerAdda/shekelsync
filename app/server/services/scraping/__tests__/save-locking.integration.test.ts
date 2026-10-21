import path from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

// Run the real SQLite adapter with the Electron ABI used by the desktop app.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const electronBinary = require('electron');

describe('scrape save locking', () => {
  it.each(['concurrent-write', 'rollback'])('%s with a real WAL database', (scenario) => {
    const result = spawnSync(electronBinary, [
      path.join(__dirname, 'save-locking.integration.runner.cjs'), scenario,
    ], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: 30_000,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain(`scrape-save:${scenario}:ok`);
  });
});
