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

  it('returns installed:true when bridge is already marked as installed', () => {
    const target = {
      __electronLogBridgeInstalled: true,
      console: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        log: vi.fn(),
      },
      electronAPI: {
        log: {
          error: vi.fn(),
          warn: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
        },
      },
    } as any;

    const result = installElectronLoggerBridge(target);
    expect(result).toEqual({ installed: true });
  });

  it('handles circular console args and skips non-function bridge levels', () => {
    const errorBridge = vi.fn();
    const warnConsole = vi.fn();
    const target = {
      console: {
        error: vi.fn(),
        warn: warnConsole,
        info: vi.fn(),
        debug: vi.fn(),
        log: vi.fn(),
      },
      electronAPI: {
        log: {
          error: errorBridge,
          warn: 'not-a-function',
          info: undefined,
          debug: null,
        },
      },
    } as any;

    const { installed, restore } = installElectronLoggerBridge(target);
    expect(installed).toBe(true);

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    target.console.error('circular', circular);
    expect(errorBridge).toHaveBeenCalledWith(
      'circular [object Object]',
      expect.objectContaining({ args: expect.any(Array) }),
    );

    target.console.warn('keep original');
    expect(warnConsole).toHaveBeenCalledWith('keep original');

    restore?.();
  });
});
