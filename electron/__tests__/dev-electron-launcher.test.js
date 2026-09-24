import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { assertSqliteInstallation, buildElectronDevEnvironment } = require('../../scripts/dev-electron.js');

describe('Electron SQLite installation check', () => {
  let appPath;
  afterEach(() => {
    if (appPath) fs.rmSync(appPath, { recursive: true, force: true });
  });

  function createInstallation(version) {
    appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-launcher-'));
    fs.writeFileSync(path.join(appPath, 'package-lock.json'), JSON.stringify({
      packages: { 'node_modules/better-sqlite3': { version: '13.0.3' } },
    }));
    if (version) {
      const packagePath = path.join(appPath, 'node_modules', 'better-sqlite3');
      fs.mkdirSync(packagePath, { recursive: true });
      fs.writeFileSync(path.join(packagePath, 'package.json'), JSON.stringify({ version }));
    }
    return appPath;
  }

  test('accepts the locked native dependency without loading it into the launcher runtime', () => {
    expect(() => assertSqliteInstallation(createInstallation('13.0.3'))).not.toThrow();
  });

  test('rejects an obsolete native module with a repair command', () => {
    expect(() => assertSqliteInstallation(createInstallation('12.11.1')))
      .toThrow(/installed: 12\.11\.1, locked: 13\.0\.3.*npm --prefix app ci/);
  });

  test('rejects a missing installation before Electron starts', () => {
    expect(() => assertSqliteInstallation(createInstallation(null)))
      .toThrow(/installed: missing.*npm --prefix app ci/);
  });
});

describe('Linux Electron development launcher', () => {
  test('disables keytar when it injects the fallback after an unavailable-keychain probe', () => {
    const sourceEnv = {
      ELECTRON_RUN_AS_NODE: '1',
      PATH: '/usr/bin',
    };
    const injectedKey = 'a'.repeat(64);

    const childEnv = buildElectronDevEnvironment({
      injectedKey,
      keytarUnavailable: true,
      sourceEnv,
      runningAsRoot: false,
    });

    expect(childEnv.SHEKELSYNC_ENCRYPTION_KEY).toBe(injectedKey);
    expect(childEnv.KEYTAR_DISABLE).toBe('true');
    expect(childEnv.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(sourceEnv).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      PATH: '/usr/bin',
    });
  });

  test('does not disable keytar when the availability probe succeeded', () => {
    const childEnv = buildElectronDevEnvironment({
      injectedKey: null,
      keytarUnavailable: false,
      sourceEnv: { PATH: '/usr/bin' },
      runningAsRoot: false,
    });

    expect(childEnv.KEYTAR_DISABLE).toBeUndefined();
    expect(childEnv.SHEKELSYNC_ENCRYPTION_KEY).toBeUndefined();
  });
});
