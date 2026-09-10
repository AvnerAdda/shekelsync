// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import startupModule from '../main-window-startup.js';

const { createMainWindowStartup } = startupModule;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createHarness() {
  const ready = deferred();
  let window = null;
  let quitting = false;
  const prepare = vi.fn();
  const createWindow = vi.fn(() => {
    window = { isDestroyed: vi.fn(() => false) };
  });
  const ensureWindow = createMainWindowStartup({
    app: { whenReady: () => ready.promise },
    prepare,
    createWindow,
    getWindow: () => window,
    canCreateWindow: () => !quitting,
  });
  return {
    ready, prepare, createWindow, ensureWindow,
    quit: () => { quitting = true; },
  };
}

describe('main window startup', () => {
  it('defers an early activation until Electron and backend preparation are ready', async () => {
    const h = createHarness();
    const preparation = deferred();
    const preparationStarted = deferred();
    h.prepare.mockImplementation(() => {
      preparationStarted.resolve();
      return preparation.promise;
    });

    const activation = h.ensureWindow();
    await Promise.resolve();
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.createWindow).not.toHaveBeenCalled();

    h.ready.resolve();
    await preparationStarted.promise;
    expect(h.createWindow).not.toHaveBeenCalled();
    expect(h.ensureWindow()).toBe(activation);

    preparation.resolve();
    expect(await activation).toBeTruthy();
    expect(h.createWindow).toHaveBeenCalledOnce();
  });

  it('coalesces activation, second-instance and normal startup requests', async () => {
    const h = createHarness();
    const requests = [h.ensureWindow(), h.ensureWindow(), h.ensureWindow()];
    h.ready.resolve();
    const windows = await Promise.all(requests);
    expect(windows.every((window) => window === windows[0])).toBe(true);
    expect(h.prepare).toHaveBeenCalledOnce();
    expect(h.createWindow).toHaveBeenCalledOnce();
  });

  it('reuses the live window and recreates a closed window without preparing again', async () => {
    const h = createHarness();
    h.ready.resolve();
    const first = await h.ensureWindow();
    expect(await h.ensureWindow()).toBe(first);
    first.isDestroyed.mockReturnValue(true);
    expect(await h.ensureWindow()).not.toBe(first);
    expect(h.createWindow).toHaveBeenCalledTimes(2);
    expect(h.prepare).toHaveBeenCalledOnce();
  });

  it('does not initialize or create a window if quit arrives before readiness', async () => {
    const h = createHarness();
    const request = h.ensureWindow();
    h.quit();
    h.ready.resolve();
    expect(await request).toBeNull();
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.createWindow).not.toHaveBeenCalled();
  });

  it('does not create a window if quit arrives during preparation', async () => {
    const h = createHarness();
    h.ready.resolve();
    h.prepare.mockImplementation(h.quit);
    expect(await h.ensureWindow()).toBeNull();
    expect(h.createWindow).not.toHaveBeenCalled();
  });

  it('returns immediately when a new request arrives during shutdown', async () => {
    const h = createHarness();
    h.quit();
    expect(await h.ensureWindow()).toBeNull();
    expect(h.prepare).not.toHaveBeenCalled();
  });

  it('allows a retry after preparation fails', async () => {
    const h = createHarness();
    h.ready.resolve();
    h.prepare.mockRejectedValueOnce(new Error('preparation failed'));
    await expect(h.ensureWindow()).rejects.toThrow('preparation failed');
    expect(h.createWindow).not.toHaveBeenCalled();
    expect(await h.ensureWindow()).toBeTruthy();
    expect(h.prepare).toHaveBeenCalledTimes(2);
  });

  it('releases the pending request when window creation fails', async () => {
    const h = createHarness();
    h.ready.resolve();
    h.createWindow.mockImplementationOnce(() => { throw new Error('window failed'); });
    await expect(h.ensureWindow()).rejects.toThrow('window failed');
    expect(await h.ensureWindow()).toBeTruthy();
    expect(h.prepare).toHaveBeenCalledOnce();
    expect(h.createWindow).toHaveBeenCalledTimes(2);
  });
});
