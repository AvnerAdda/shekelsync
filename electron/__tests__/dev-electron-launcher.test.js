import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { buildElectronDevEnvironment } = require('../../scripts/dev-electron.js');

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
