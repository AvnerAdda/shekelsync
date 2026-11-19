import { afterEach, describe, expect, test, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createInstallationActivity, normalizeInstallationActivitySettings, resolveInstallationActivityConfig, isActiveForegroundWindow } = require('../installation-activity.js');
const defaults = { supabaseUrl: 'https://metrics.example.com', publishableKey: 'sb_publishable_fixture' };
const consent = { enabled: true, consentedAt: '2026-11-19T10:00:00.000Z' };
const directories = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

async function createClient(overrides = {}) {
  const userDataPath = overrides.userDataPath || await fs.mkdtemp(path.join(os.tmpdir(), 'shekelsync-activity-'));
  if (!overrides.userDataPath) directories.push(userDataPath);
  let clock = Date.parse('2026-11-19T10:00:00.000Z');
  const fetchImpl = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => new Date(clock).toISOString().slice(0, 10) }));
  const logger = { debug: vi.fn() };
  const reporter = createInstallationActivity({ userDataPath, isPackaged: true, env: {}, defaults, fetchImpl, logger, now: () => clock, ...overrides });
  return { reporter, fetchImpl, logger, userDataPath,
    filePath: path.join(userDataPath, 'usage', 'installation-activity.json'),
    advance: (milliseconds) => { clock += milliseconds; } };
}

const body = (fetchImpl, index = 0) => JSON.parse(fetchImpl.mock.calls[index][1].body);

describe('opt-in installation activity', () => {
  test('does not create an identity or send before separate, explicit consent', async () => {
    const client = await createClient();
    expect(await client.reporter.recordActivity()).toBe(false);
    await client.reporter.setSettings({ enabled: true });
    expect(await client.reporter.recordActivity()).toBe(false);
    await client.reporter.setSettings({ enabled: true, consentedAt: 'invalid' });
    expect(await client.reporter.recordActivity()).toBe(false);
    await expect(fs.access(client.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(client.fetchImpl).not.toHaveBeenCalled();
    await client.reporter.setSettings(consent);
    await expect(fs.access(client.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('sends only a random installation ID and revocation token after foreground activity', async () => {
    const client = await createClient();
    await client.reporter.setSettings(consent);
    expect(await client.reporter.recordActivity()).toBe(true);
    const [url, init] = client.fetchImpl.mock.calls[0];
    expect(url).toBe('https://metrics.example.com/rest/v1/rpc/record_installation_activity');
    expect(init.headers).toEqual({ apikey: defaults.publishableKey, 'Content-Type': 'application/json' });
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
    expect(body(client.fetchImpl)).toEqual({ p_installation_id: expect.stringMatching(/^[0-9a-f-]{36}$/), p_token: expect.stringMatching(/^[0-9a-f]{64}$/) });
    if (process.platform !== 'win32') expect((await fs.stat(client.filePath)).mode & 0o777).toBe(0o600);
  });

  test('deduplicates concurrent activity reports on the same UTC day', async () => {
    const client = await createClient();
    await client.reporter.setSettings(consent);
    expect(await Promise.all(Array.from({ length: 10 }, () => client.reporter.recordActivity()))).toEqual(Array(10).fill(true));
    expect(client.fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('reuses the identity across restarts and app updates but reports a new UTC day', async () => {
    const first = await createClient();
    await first.reporter.setSettings(consent);
    await first.reporter.recordActivity();
    const second = await createClient({ userDataPath: first.userDataPath });
    await second.reporter.setSettings(consent);
    await second.reporter.recordActivity();
    expect(second.fetchImpl).not.toHaveBeenCalled();
    second.advance(24 * 60 * 60 * 1000);
    expect(await second.reporter.recordActivity()).toBe(true);
    expect(body(second.fetchImpl)).toEqual(body(first.fetchImpl));
  });

  test('separate installations have different identities', async () => {
    const first = await createClient();
    const second = await createClient();
    await Promise.all([first.reporter.setSettings(consent), second.reporter.setSettings(consent)]);
    await Promise.all([first.reporter.recordActivity(), second.reporter.recordActivity()]);
    expect(body(first.fetchImpl).p_installation_id).not.toBe(body(second.fetchImpl).p_installation_id);
  });

  test('development builds never count even when analytics debug sending is enabled', async () => {
    const client = await createClient({ isPackaged: false, env: { SHEKELSYNC_ANALYTICS_DEBUG: 'true' } });
    await client.reporter.setSettings(consent);
    expect(client.reporter.getStatus().available).toBe(false);
    expect(await client.reporter.recordActivity()).toBe(false);
    expect(client.fetchImpl).not.toHaveBeenCalled();
    await expect(fs.access(client.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('owner exclusion prevents reporting and erases counting history', async () => {
    const client = await createClient();
    await client.reporter.setSettings(consent);
    await client.reporter.recordActivity();
    await client.reporter.setSettings({ ...consent, excluded: true });
    expect(client.fetchImpl.mock.calls[1][0]).toBe('https://metrics.example.com/rest/v1/rpc/forget_installation_activity');
    expect(body(client.fetchImpl, 1)).toEqual(body(client.fetchImpl, 0));
    expect(await client.reporter.recordActivity()).toBe(false);
    await expect(fs.access(client.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('environment exclusion overrides consent in packaged builds', async () => {
    const client = await createClient({ env: { SHEKELSYNC_ANALYTICS_EXCLUDE: 'true' } });
    await client.reporter.setSettings(consent);
    expect(client.reporter.getStatus()).toMatchObject({ enabled: false, excluded: true, excludedByEnvironment: true });
    expect(await client.reporter.recordActivity()).toBe(false);
    expect(client.fetchImpl).not.toHaveBeenCalled();
  });

  test('opting out forgets the old ID and later explicit consent starts a new identity', async () => {
    const client = await createClient();
    await client.reporter.setSettings(consent);
    await client.reporter.recordActivity();
    await client.reporter.setSettings({ enabled: false });
    expect(await client.reporter.recordActivity()).toBe(false);
    await client.reporter.setSettings(consent);
    await client.reporter.recordActivity();
    expect(body(client.fetchImpl, 2).p_installation_id).not.toBe(body(client.fetchImpl, 0).p_installation_id);
  });

  test('persists pending deletion offline and retries it after restart without reporting activity', async () => {
    const client = await createClient();
    await client.reporter.setSettings(consent);
    await client.reporter.recordActivity();
    client.fetchImpl.mockRejectedValue(new Error('offline'));
    expect(await client.reporter.setSettings({ enabled: false })).toBe(false);
    expect(JSON.parse(await fs.readFile(client.filePath, 'utf8')).retired).toBe(true);
    const restarted = await createClient({ userDataPath: client.userDataPath });
    expect(await restarted.reporter.setSettings({ enabled: false })).toBe(true);
    expect(restarted.fetchImpl).toHaveBeenCalledTimes(1);
    expect(restarted.fetchImpl.mock.calls[0][0]).toContain('/forget_installation_activity');
    expect(await restarted.reporter.recordActivity()).toBe(false);
    await expect(fs.access(client.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('cannot reuse or replace an identity while its deletion is pending', async () => {
    const client = await createClient();
    await client.reporter.setSettings(consent);
    await client.reporter.recordActivity();
    const oldIdentity = body(client.fetchImpl);
    client.fetchImpl.mockRejectedValue(new Error('offline'));
    await client.reporter.setSettings({ enabled: false });
    await client.reporter.setSettings(consent);
    expect(await client.reporter.recordActivity()).toBe(false);
    expect(JSON.parse(await fs.readFile(client.filePath, 'utf8')).id).toBe(oldIdentity.p_installation_id);
    client.fetchImpl.mockImplementation(async () => ({ ok: true, json: async () => '2026-11-19' }));
    client.advance(60_000);
    expect(await client.reporter.recordActivity()).toBe(true);
    expect(client.fetchImpl.mock.calls.at(-2)[0]).toContain('/forget_installation_activity');
    expect(body(client.fetchImpl, client.fetchImpl.mock.calls.length - 1).p_installation_id).not.toBe(oldIdentity.p_installation_id);
  });

  test('serializes revocation with in-flight reports', async () => {
    const client = await createClient();
    client.fetchImpl.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    await client.reporter.setSettings(consent);
    const pendingReport = client.reporter.recordActivity();
    await vi.waitFor(() => expect(client.fetchImpl).toHaveBeenCalledTimes(1));
    const revocation = client.reporter.setSettings({ enabled: false });
    expect(await pendingReport).toBe(false);
    expect(await revocation).toBe(true);
    expect(client.fetchImpl.mock.calls[1][0]).toContain('/forget_installation_activity');
    await expect(fs.access(client.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('retries failed reports without creating a second identity or logging credentials', async () => {
    const client = await createClient();
    client.fetchImpl.mockRejectedValueOnce(new Error('private token and response must never be logged'));
    await client.reporter.setSettings(consent);
    expect(await client.reporter.recordActivity()).toBe(false);
    expect(await client.reporter.recordActivity()).toBe(false);
    expect(client.fetchImpl).toHaveBeenCalledTimes(1);
    client.advance(60_000);
    expect(await client.reporter.recordActivity()).toBe(true);
    expect(body(client.fetchImpl, 1)).toEqual(body(client.fetchImpl, 0));
    expect(JSON.stringify(client.logger.debug.mock.calls)).not.toContain('private token');
    expect(JSON.stringify(client.logger.debug.mock.calls)).not.toContain(body(client.fetchImpl).p_token);
  });

  test('does not silently replace corrupt local identities or send without saving them', async () => {
    const client = await createClient();
    await fs.mkdir(path.dirname(client.filePath), { recursive: true });
    await fs.writeFile(client.filePath, 'invalid JSON');
    await client.reporter.setSettings(consent);
    expect(await client.reporter.recordActivity()).toBe(false);
    expect(client.fetchImpl).not.toHaveBeenCalled();
    const blocked = await createClient();
    await fs.writeFile(path.join(blocked.userDataPath, 'usage'), 'not a directory');
    await blocked.reporter.setSettings(consent);
    expect(await blocked.reporter.recordActivity()).toBe(false);
    expect(blocked.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('installation counting configuration', () => {
  test('only a focused, visible, non-idle app window constitutes activity', () => {
    const window = { isDestroyed: () => false, isVisible: () => true, isFocused: () => true, isMinimized: () => false };
    expect(isActiveForegroundWindow(window, 0)).toBe(true);
    expect(isActiveForegroundWindow(window, 299)).toBe(true);
    expect(isActiveForegroundWindow(window, 300)).toBe(false);
    expect(isActiveForegroundWindow(window, Number.NaN)).toBe(false);
    expect(isActiveForegroundWindow(null, 0)).toBe(false);
    expect(isActiveForegroundWindow({ ...window, isDestroyed: () => true }, 0)).toBe(false);
    expect(isActiveForegroundWindow({ ...window, isVisible: () => false }, 0)).toBe(false);
    expect(isActiveForegroundWindow({ ...window, isFocused: () => false }, 0)).toBe(false);
    expect(isActiveForegroundWindow({ ...window, isMinimized: () => true }, 0)).toBe(false);
  });

  test('is opt-in and not authorized by existing anonymous analytics choices', () => {
    expect(normalizeInstallationActivitySettings()).toEqual({ enabled: false, excluded: false, consentedAt: null });
    expect(normalizeInstallationActivitySettings(null)).toEqual({ enabled: false, excluded: false, consentedAt: null });
  });

  test('requires HTTPS and a public key, never service-role credentials', () => {
    expect(resolveInstallationActivityConfig({}, defaults)).toEqual({ url: 'https://metrics.example.com', key: defaults.publishableKey });
    expect(resolveInstallationActivityConfig({}, { ...defaults, supabaseUrl: 'http://metrics.example.com' })).toBeNull();
    expect(resolveInstallationActivityConfig({}, { ...defaults, publishableKey: 'sb_secret_fixture' })).toBeNull();
    const jwt = (role) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
    expect(resolveInstallationActivityConfig({}, { ...defaults, publishableKey: jwt('service_role') })).toBeNull();
    expect(resolveInstallationActivityConfig({}, { ...defaults, publishableKey: jwt('anon') })).not.toBeNull();
    expect(resolveInstallationActivityConfig({ SHEKELSYNC_USAGE_METRICS_URL: defaults.supabaseUrl }, defaults)).toBeNull();
    expect(resolveInstallationActivityConfig({}, { ...defaults, supabaseUrl: 'https://user:password@metrics.example.com' })).toBeNull();
  });
});
