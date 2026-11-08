import { describe, test, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createAppLock, getProtectedAction, REAUTH_GRACE_MS } = require('../auth/app-lock.js');
const { createMacDeviceOwnerAuth } = require('../auth/mac-device-owner-auth.js');

const silentLogger = { info: vi.fn(), warn: vi.fn() };

function createLock({ method = 'touchid', promptResults = [{ success: true }], enabled = true } = {}) {
  let clock = 1_000_000;
  const results = [...promptResults];
  const prompt = vi.fn(async () => results.shift() ?? { success: true });
  const resolveMethod = vi.fn(async () => method);
  const lock = createAppLock({
    enabled,
    resolveMethod,
    prompt,
    logger: silentLogger,
    now: () => clock,
  });
  return {
    lock,
    prompt,
    resolveMethod,
    advance: (ms) => {
      clock += ms;
    },
  };
}

describe('getProtectedAction', () => {
  test.each([
    ['POST', '/api/scrape', 'sync'],
    ['POST', '/api/scrape/bulk', 'sync'],
    ['post', '/API/Scrape/', 'sync'],
    ['POST', '/api/./scrape?force=1', 'sync'],
    ['POST', '/api/%73crape', 'sync'],
    ['POST', '/api//scrape/bulk', 'sync'],
    ['POST', '/api/credentials', 'credentials'],
    ['PUT', '/api/credentials/12', 'credentials'],
    ['PATCH', '/api/credentials', 'credentials'],
    ['DELETE', '/api/credentials/12', 'credentials'],
    ['POST', '/api/x/../credentials', 'credentials'],
  ])('%s %s requires re-authentication (%s)', (method, endpoint, expected) => {
    expect(getProtectedAction(method, endpoint)).toBe(expected);
  });

  test.each([
    ['GET', '/api/credentials'],
    ['GET', '/api/scrape_events'],
    ['GET', '/api/scrape/status/4'],
    ['POST', '/api/scrape/test'],
    ['GET', '/api/scrape'],
    ['POST', '/api/credentials/12/extra'],
  ])('%s %s is not protected', (method, endpoint) => {
    expect(getProtectedAction(method, endpoint)).toBeNull();
  });
});

describe('createAppLock', () => {
  test('starts locked when an authentication method is available', async () => {
    const { lock } = createLock({ method: 'touchid' });
    await expect(lock.getState()).resolves.toEqual({ locked: true, method: 'touchid' });
    await expect(lock.isLocked()).resolves.toBe(true);
  });

  test('stays unlocked when no method is available, so the user is never locked out', async () => {
    const { lock, prompt } = createLock({ method: null });
    await expect(lock.getState()).resolves.toEqual({ locked: false, method: null });
    await expect(lock.authorizeAction('sync')).resolves.toEqual({ success: true });
    expect(prompt).not.toHaveBeenCalled();
  });

  test('stays unlocked when disabled for a development run', async () => {
    const { lock, resolveMethod } = createLock({ enabled: false });
    await expect(lock.isLocked()).resolves.toBe(false);
    expect(resolveMethod).not.toHaveBeenCalled();
  });

  test('treats a failing method check as no method', async () => {
    const lock = createAppLock({
      resolveMethod: vi.fn().mockRejectedValue(new Error('boom')),
      prompt: vi.fn(),
      logger: silentLogger,
    });
    await expect(lock.isLocked()).resolves.toBe(false);
  });

  test('unlocks only after a successful prompt', async () => {
    const { lock, prompt } = createLock({
      promptResults: [{ success: false, cancelled: true, error: 'Canceled' }, { success: true }],
    });

    const cancelled = await lock.unlock();
    expect(cancelled).toMatchObject({ success: false, cancelled: true, locked: true });
    await expect(lock.isLocked()).resolves.toBe(true);

    const unlocked = await lock.unlock();
    expect(unlocked).toMatchObject({ success: true, locked: false, method: 'touchid' });
    await expect(lock.isLocked()).resolves.toBe(false);
    expect(prompt).toHaveBeenCalledWith('touchid', 'unlock your financial data');
  });

  test('shares one system prompt between concurrent unlock requests', async () => {
    let resolvePrompt;
    const prompt = vi.fn(() => new Promise((resolve) => {
      resolvePrompt = resolve;
    }));
    const lock = createAppLock({ resolveMethod: async () => 'touchid', prompt, logger: silentLogger });

    const first = lock.unlock();
    const second = lock.unlock();
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    resolvePrompt({ success: true });

    await expect(first).resolves.toMatchObject({ success: true, locked: false });
    await expect(second).resolves.toMatchObject({ success: true, locked: false });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  test('refuses protected actions while locked without prompting', async () => {
    const { lock, prompt } = createLock();
    await expect(lock.authorizeAction('sync')).resolves.toMatchObject({ success: false });
    expect(prompt).not.toHaveBeenCalled();
  });

  test('accepts protected actions within the grace period after authenticating', async () => {
    const { lock, prompt, advance } = createLock();
    await lock.unlock();
    advance(REAUTH_GRACE_MS - 1);

    await expect(lock.authorizeAction('credentials')).resolves.toEqual({ success: true });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  test('asks again for protected actions after the grace period', async () => {
    const { lock, prompt, advance } = createLock({
      promptResults: [{ success: true }, { success: true }, { success: false, cancelled: true }],
    });
    await lock.unlock();
    advance(REAUTH_GRACE_MS + 1);

    await expect(lock.authorizeAction('sync')).resolves.toMatchObject({ success: true });
    expect(prompt).toHaveBeenLastCalledWith('touchid', 'sync your bank accounts');

    advance(REAUTH_GRACE_MS + 1);
    await expect(lock.authorizeAction('credentials')).resolves.toMatchObject({ success: false, cancelled: true });
    expect(prompt).toHaveBeenLastCalledWith('touchid', 'change your bank account credentials');
    await expect(lock.isLocked()).resolves.toBe(false);
  });

  test('uses the method available at prompt time (e.g. password with the lid closed)', async () => {
    const methods = ['touchid', 'password'];
    const prompt = vi.fn(async () => ({ success: true }));
    const lock = createAppLock({
      resolveMethod: async () => methods.shift() ?? 'password',
      prompt,
      logger: silentLogger,
    });

    await expect(lock.unlock()).resolves.toMatchObject({ success: true, method: 'password' });
    expect(prompt).toHaveBeenCalledWith('password', 'unlock your financial data');
  });
});

describe('createMacDeviceOwnerAuth', () => {
  function fakeExecFile(output, error = null) {
    return vi.fn((_file, _args, _options, callback) => callback(error, output));
  }

  test('passes the reason as an argument instead of embedding it in the script', async () => {
    const execFileImpl = fakeExecFile(JSON.stringify({ success: true }));
    const auth = createMacDeviceOwnerAuth({ execFileImpl });
    const reason = "unlock'); doShellScript('rm -rf ~"; // must stay inert data

    await expect(auth.authenticate(reason)).resolves.toEqual({ success: true, method: 'password' });
    const [file, args] = execFileImpl.mock.calls[0];
    expect(file).toBe('/usr/bin/osascript');
    expect(args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e']);
    expect(args[3]).not.toContain(reason);
    expect(args[4]).toBe(reason);
  });

  test('reports user cancellation', async () => {
    const auth = createMacDeviceOwnerAuth({
      execFileImpl: fakeExecFile(JSON.stringify({ success: false, code: -2, message: 'Canceled by user.' })),
    });
    await expect(auth.authenticate('x')).resolves.toMatchObject({ success: false, cancelled: true });
  });

  test('fails closed on script errors or unexpected output', async () => {
    const failing = createMacDeviceOwnerAuth({ execFileImpl: fakeExecFile('', new Error('osascript failed')) });
    await expect(failing.authenticate('x')).resolves.toMatchObject({ success: false });
    await expect(failing.isAvailable()).resolves.toBe(false);

    const garbled = createMacDeviceOwnerAuth({ execFileImpl: fakeExecFile('not json') });
    await expect(garbled.authenticate('x')).resolves.toMatchObject({ success: false });
  });

  test('reports availability from LocalAuthentication', async () => {
    const auth = createMacDeviceOwnerAuth({ execFileImpl: fakeExecFile(JSON.stringify({ available: true })) });
    await expect(auth.isAvailable()).resolves.toBe(true);
  });
});
