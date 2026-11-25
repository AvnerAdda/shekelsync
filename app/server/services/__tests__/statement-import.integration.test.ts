import path from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

// Run the real SQLite adapter with the Electron ABI used by the desktop app.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const electronBinary = require('electron');

describe('statement import', () => {
  it('previews, imports and re-imports a statement against a real database', () => {
    const result = spawnSync(electronBinary, [path.join(__dirname, 'statement-import.integration.runner.cjs')], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TZ: 'UTC' },
      timeout: 60_000,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('statement-import:ok');
  });
});
