import { describe, expect, it, vi } from 'vitest';
import installElectronLoggerBridge from '../install-electron-logger';

describe('install-electron-logger', () => {
  it('returns installed:false when bridge missing', () => {
    const result = installElectronLoggerBridge({} as any);
    expect(result.installed).toBe(false);
  });

  it('attaches logger and forwards messages, swallowing bridge errors', () => {
    const logSpy = vi.fn().mockImplementation(() => {
      throw new Error('log failure');
    });
    const consoleSpy = vi.fn();
    const target = {
      console: {
        error: consoleSpy,
        warn: consoleSpy,
        info: consoleSpy,
        debug: consoleSpy,
        log: consoleSpy,
      },
      electronAPI: {
        log: {
          error: logSpy,
          warn: logSpy,
          info: logSpy,
          debug: logSpy,
        },
      },
    } as any;

    const { installed, restore } = installElectronLoggerBridge(target);
    expect(installed).toBe(true);

    target.console.error('oops', new Error('boom'));
    expect(consoleSpy).toHaveBeenCalledWith('oops', expect.any(Error));
    // bridge called even though it throws
    expect(logSpy).toHaveBeenCalled();

    restore?.();
    target.console.error('after restore');
    expect(logSpy).toHaveBeenCalledTimes(1); // no bridge call after restore
  });
});
