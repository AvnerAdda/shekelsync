import path from 'path';
import fs from 'fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const { resolveElectronPath } = require('../resolve-electron-path.js');

const originalResourcesPathDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');

function setResourcesPath(value) {
  Object.defineProperty(process, 'resourcesPath', {
    value,
    writable: true,
    configurable: true,
  });
}

describe('resolve-electron-path', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalResourcesPathDescriptor) {
      Object.defineProperty(process, 'resourcesPath', originalResourcesPathDescriptor);
    } else {
      Object.defineProperty(process, 'resourcesPath', {
        value: undefined,
        writable: true,
        configurable: true,
      });
    }
  });

  it('uses resourcesPath app.asar location when running packaged', () => {
    setResourcesPath('/tmp/resources');

    const result = resolveElectronPath('security', 'security-status.js');

    expect(result).toBe(
      path.join('/tmp/resources', 'app.asar', 'electron', 'security', 'security-status.js'),
    );
  });

  it('falls back to source dev path when packaged candidate does not exist', () => {
    setResourcesPath(undefined);
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const result = resolveElectronPath('logger.js');
    const moduleDir = path.dirname(require.resolve('../resolve-electron-path.js'));

    expect(result).toBe(path.join(moduleDir, '..', '..', '..', 'electron', 'logger.js'));
  });
});
