import { describe, expect, it, vi } from 'vitest';
import { installElectronLoggerBridge } from '../install-electron-logger';

function createFakeWindow() {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const debug = vi.fn();

  return {
    electronAPI: {
      log: {
        info,
        warn,
        error,
        debug,
      },
    },
    console: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      log: vi.fn(),
    },
  } as unknown as Window & typeof globalThis;
}

describe('installElectronLoggerBridge', () => {
  it('skips installation when electron bridge is missing', () => {
    const result = installElectronLoggerBridge({ console } as Window & typeof globalThis);
    expect(result.installed).toBe(false);
  });

  it('forwards console calls to the electron log bridge', () => {
    const fakeWindow = createFakeWindow();
    const installResult = installElectronLoggerBridge(fakeWindow);

    expect(installResult.installed).toBe(true);

    fakeWindow.console.info('hello', { foo: 'bar' });

    const infoSpy = fakeWindow.electronAPI?.log?.info as ReturnType<typeof vi.fn>;
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('hello'), {
      args: expect.arrayContaining([expect.objectContaining({ foo: 'bar' })]),
    });

    installResult.restore?.();
  });

  it('does not double-wrap consoles when already installed', () => {
    const fakeWindow = createFakeWindow();
    const first = installElectronLoggerBridge(fakeWindow);
    expect(first.installed).toBe(true);

    const second = installElectronLoggerBridge(fakeWindow);
    expect(second.installed).toBe(true);

    fakeWindow.console.error('boom');
    const errorSpy = fakeWindow.electronAPI?.log?.error as ReturnType<typeof vi.fn>;
    expect(errorSpy).toHaveBeenCalledTimes(1);

    first.restore?.();
  });
});
