import { describe, expect, it, vi } from 'vitest';

import lifecycleModule from '../app-lifecycle.js';

const { createAppLifecycleController } = lifecycleModule;

describe('application lifecycle', () => {
  it('keeps process-lifetime backend services alive when the last macOS window closes', () => {
    const app = { quit: vi.fn() };
    const shutdownBackend = vi.fn();
    const lifecycle = createAppLifecycleController({
      app,
      platform: 'darwin',
      shutdownBackend,
    });

    lifecycle.handleWindowAllClosed();

    expect(app.quit).not.toHaveBeenCalled();
    expect(shutdownBackend).not.toHaveBeenCalled();
  });

  it('requests a real application quit on Windows without tearing down early', () => {
    const app = { quit: vi.fn() };
    const shutdownBackend = vi.fn();
    const lifecycle = createAppLifecycleController({
      app,
      platform: 'win32',
      shutdownBackend,
    });

    lifecycle.handleWindowAllClosed();

    expect(app.quit).toHaveBeenCalledOnce();
    expect(shutdownBackend).not.toHaveBeenCalled();
  });

  it('waits for backend shutdown before allowing Electron to quit', async () => {
    let finishShutdown;
    const shutdownFinished = new Promise((resolve) => {
      finishShutdown = resolve;
    });
    const event = { preventDefault: vi.fn() };
    const app = { quit: vi.fn() };
    const prepareForQuit = vi.fn();
    const shutdownBackend = vi.fn(() => shutdownFinished);
    const lifecycle = createAppLifecycleController({
      app,
      prepareForQuit,
      shutdownBackend,
    });

    lifecycle.handleBeforeQuit(event);
    lifecycle.handleBeforeQuit(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(prepareForQuit).toHaveBeenCalledOnce();
    expect(shutdownBackend).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();

    finishShutdown();
    await shutdownFinished;
    await Promise.resolve();

    expect(app.quit).toHaveBeenCalledOnce();

    const resumedEvent = { preventDefault: vi.fn() };
    lifecycle.handleBeforeQuit(resumedEvent);
    expect(resumedEvent.preventDefault).not.toHaveBeenCalled();
    expect(shutdownBackend).toHaveBeenCalledOnce();
  });

  it('does not block quitting forever when backend shutdown rejects', async () => {
    const event = { preventDefault: vi.fn() };
    const app = { quit: vi.fn() };
    const logger = { error: vi.fn() };
    const lifecycle = createAppLifecycleController({
      app,
      logger,
      shutdownBackend: vi.fn().mockRejectedValue(new Error('close failed')),
    });

    lifecycle.handleBeforeQuit(event);
    await Promise.resolve();
    await Promise.resolve();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(app.quit).toHaveBeenCalledOnce();
  });

  it('continues quitting after the shutdown deadline', async () => {
    vi.useFakeTimers();
    try {
      const event = { preventDefault: vi.fn() };
      const app = { quit: vi.fn() };
      const logger = { warn: vi.fn(), error: vi.fn() };
      const lifecycle = createAppLifecycleController({
        app,
        logger,
        shutdownBackend: vi.fn(() => new Promise(() => {})),
        shutdownTimeoutMs: 25,
      });

      lifecycle.handleBeforeQuit(event);
      await vi.advanceTimersByTimeAsync(25);

      expect(logger.warn).toHaveBeenCalledWith(
        'Backend shutdown timed out; continuing application quit',
        { timeoutMs: 25 },
      );
      expect(app.quit).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
