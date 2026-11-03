import { describe, test, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  createUsageAnalytics,
  normalizeUsageAnalyticsSettings,
  bucketDuration,
  bucketCount,
  bucketAgeDays,
  classifyError,
  _internal: { resolveAppKeyConfig, sanitizeProps },
} = require('../usage-analytics.js');

const silentLogger = { debug: vi.fn(), warn: vi.fn() };

function createClient(overrides = {}) {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  const analytics = createUsageAnalytics({
    builtInAppKey: '',
    appVersion: '0.2.3',
    isPackaged: true,
    getLocale: () => 'he',
    fetchImpl,
    env: { SHEKELSYNC_APTABASE_APP_KEY: 'A-EU-1234567890' }, // gitleaks:allow -- synthetic Aptabase app key fixture
    platform: 'darwin',
    logger: silentLogger,
    ...overrides,
  });
  return { analytics, fetchImpl };
}

function sentBody(fetchImpl, call = 0) {
  return JSON.parse(fetchImpl.mock.calls[call][1].body);
}

describe('usage analytics', () => {
  test('sends nothing until the user opts in', async () => {
    const { analytics, fetchImpl } = createClient();

    expect(await analytics.track('app_started')).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();

    analytics.setEnabled(true);
    expect(await analytics.track('app_started')).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    analytics.setEnabled(false);
    expect(await analytics.track('app_started')).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('posts the Aptabase event shape to the regional host', async () => {
    const { analytics, fetchImpl } = createClient();
    analytics.setEnabled(true);
    await analytics.track('sync_completed', {
      vendor: 'hapoalim',
      success: false,
      errorType: 'INVALID_PASSWORD',
      duration: 'lt30s',
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://eu.aptabase.com/api/v0/event');
    expect(init.method).toBe('POST');
    expect(init.headers['App-Key']).toBe('A-EU-1234567890');
    const body = sentBody(fetchImpl);
    expect(body.eventName).toBe('sync_completed');
    expect(body.sessionId).toMatch(/^\d{18}$/);
    expect(body.systemProps).toMatchObject({
      isDebug: false,
      locale: 'he',
      osName: 'macOS',
      appVersion: '0.2.3',
    });
    expect(body.props).toEqual({
      vendor: 'hapoalim',
      success: false,
      errorType: 'INVALID_PASSWORD',
      duration: 'lt30s',
    });
  });

  test('drops undeclared props and free-text values', async () => {
    const { analytics, fetchImpl } = createClient();
    analytics.setEnabled(true);
    await analytics.track('sync_completed', {
      vendor: 'max',
      success: true,
      errorType: 'Login failed for user 123456789 with password hunter2',
      amount: 1234,
      accountNumber: '0162490242',
    });

    expect(sentBody(fetchImpl).props).toEqual({ vendor: 'max', success: true });
  });

  test('rejects unknown events', async () => {
    const { analytics, fetchImpl } = createClient();
    analytics.setEnabled(true);
    expect(await analytics.track('transaction_added', { amount: 50 })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('renderer may only send screen views and error types', async () => {
    const { analytics, fetchImpl } = createClient();
    analytics.setEnabled(true);

    expect(await analytics.trackFromRenderer('sync_completed', { vendor: 'max', success: true })).toBe(false);
    expect(await analytics.trackFromRenderer('daily_snapshot', { autoSync: true })).toBe(false);
    expect(await analytics.trackFromRenderer('screen_viewed', { screen: 'plan' })).toBe(true);
    expect(await analytics.trackFromRenderer('app_error', { area: 'plan', errorType: 'TypeError' })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sentBody(fetchImpl).props).toEqual({ screen: 'plan' });
  });

  test('sync events carry trigger and scraper version, rejecting malformed versions', async () => {
    const { analytics, fetchImpl } = createClient();
    analytics.setEnabled(true);
    await analytics.track('sync_completed', {
      vendor: 'max', success: true, trigger: 'scheduled', scraperVersion: '6.12.2',
    });
    await analytics.track('sync_completed', {
      vendor: 'max', success: true, trigger: 'manual', scraperVersion: '6.12.2; rm -rf /',
    });
    expect(sentBody(fetchImpl, 0).props).toEqual({
      vendor: 'max', success: true, trigger: 'scheduled', scraperVersion: '6.12.2',
    });
    expect(sentBody(fetchImpl, 1).props).toEqual({ vendor: 'max', success: true, trigger: 'manual' });
  });

  test('daily snapshot only carries flags and buckets', async () => {
    const { analytics, fetchImpl } = createClient();
    analytics.setEnabled(true);
    await analytics.track('daily_snapshot', {
      institutions: '2to3',
      installAge: '30to90d',
      autoSync: true,
      telegram: false,
      aiAssistant: false,
      property: true,
      budgets: true,
      goals: false,
      institutionList: 'hapoalim,max',
      balance: 12345,
    });
    expect(sentBody(fetchImpl).props).toEqual({
      institutions: '2to3',
      installAge: '30to90d',
      autoSync: true,
      telegram: false,
      aiAssistant: false,
      property: true,
      budgets: true,
      goals: false,
    });
  });

  test('caps noisy events per session', async () => {
    const { analytics, fetchImpl } = createClient();
    analytics.setEnabled(true);
    for (let i = 0; i < 30; i += 1) {
      await analytics.track('app_error', { area: 'main', errorType: 'TypeError' });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(20);
  });

  test('is unavailable without a valid app key', async () => {
    const { analytics, fetchImpl } = createClient({ env: {} });
    analytics.setEnabled(true);
    expect(analytics.getStatus()).toEqual({ available: false, enabled: true });
    expect(await analytics.track('app_started')).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('development builds only send with the debug flag, marked isDebug', async () => {
    const quiet = createClient({ isPackaged: false });
    quiet.analytics.setEnabled(true);
    expect(quiet.analytics.getStatus().available).toBe(false);
    expect(await quiet.analytics.track('app_started')).toBe(false);

    const debug = createClient({
      isPackaged: false,
      env: { SHEKELSYNC_APTABASE_APP_KEY: 'A-US-42', SHEKELSYNC_ANALYTICS_DEBUG: 'true' },
    });
    debug.analytics.setEnabled(true);
    await debug.analytics.track('app_started');
    expect(debug.fetchImpl.mock.calls[0][0]).toBe('https://us.aptabase.com/api/v0/event');
    expect(sentBody(debug.fetchImpl).systemProps.isDebug).toBe(true);
  });

  test('network failures never throw', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const { analytics } = createClient({ fetchImpl });
    analytics.setEnabled(true);
    await expect(analytics.track('app_started')).resolves.toBe(false);
  });

  test('opting in starts a new session; sessions rotate after an hour idle', async () => {
    let clock = 1_700_000_000_000;
    const { analytics, fetchImpl } = createClient({ now: () => clock });
    analytics.setEnabled(true);
    await analytics.track('app_started');
    clock += 5 * 60 * 1000;
    await analytics.track('screen_viewed', { screen: 'home' });
    clock += 2 * 60 * 60 * 1000;
    await analytics.track('screen_viewed', { screen: 'plan' });

    const [first, second, third] = [0, 1, 2].map((call) => sentBody(fetchImpl, call).sessionId);
    expect(second).toBe(first);
    expect(third).not.toBe(first);
  });
});

describe('usage analytics helpers', () => {
  test('normalizes settings to opted-out by default', () => {
    expect(normalizeUsageAnalyticsSettings(undefined)).toEqual({ enabled: false, decidedAt: null, lastSnapshotDay: null });
    expect(normalizeUsageAnalyticsSettings({ enabled: 'yes' })).toEqual({ enabled: false, decidedAt: null, lastSnapshotDay: null });
    expect(normalizeUsageAnalyticsSettings({ enabled: true, decidedAt: '2026-11-03T10:00:00.000Z' }))
      .toEqual({ enabled: true, decidedAt: '2026-11-03T10:00:00.000Z', lastSnapshotDay: null });
  });

  test('resolves app keys per region and requires https for self-hosted', () => {
    expect(resolveAppKeyConfig({}, '')).toBeNull();
    expect(resolveAppKeyConfig({}, 'A-EU-99')?.appKey).toBe('A-EU-99');
    expect(resolveAppKeyConfig({ SHEKELSYNC_APTABASE_APP_KEY: 'A-EU-1' })?.host).toBe('https://eu.aptabase.com');
    expect(resolveAppKeyConfig({ SHEKELSYNC_APTABASE_APP_KEY: 'A-XX-1' })).toBeNull();
    expect(resolveAppKeyConfig({ SHEKELSYNC_APTABASE_APP_KEY: 'A-SH-1' })).toBeNull();
    expect(resolveAppKeyConfig({
      SHEKELSYNC_APTABASE_APP_KEY: 'A-SH-1',
      SHEKELSYNC_APTABASE_HOST: 'http://insecure.example',
    })).toBeNull();
    expect(resolveAppKeyConfig({
      SHEKELSYNC_APTABASE_APP_KEY: 'A-SH-1',
      SHEKELSYNC_APTABASE_HOST: 'https://stats.example.com/',
    })?.host).toBe('https://stats.example.com');
  });

  test('buckets sync durations', () => {
    expect(bucketDuration(10_000)).toBe('lt30s');
    expect(bucketDuration(45_000)).toBe('30to60s');
    expect(bucketDuration(90_000)).toBe('1to2m');
    expect(bucketDuration(200_000)).toBe('2to5m');
    expect(bucketDuration(600_000)).toBe('gt5m');
    expect(bucketDuration(Number.NaN)).toBeUndefined();
  });

  test('buckets counts and install age', () => {
    expect([0, 1, 2, 3, 4, 12].map(bucketCount)).toEqual(['0', '1', '2to3', '2to3', '4plus', '4plus']);
    const day = 24 * 60 * 60 * 1000;
    const now = 1_800_000_000_000;
    expect(bucketAgeDays(now - 2 * day, now)).toBe('lt7d');
    expect(bucketAgeDays(now - 10 * day, now)).toBe('7to30d');
    expect(bucketAgeDays(now - 40 * day, now)).toBe('30to90d');
    expect(bucketAgeDays(now - 400 * day, now)).toBe('gt90d');
    expect(bucketAgeDays(null, now)).toBe('unknown');
  });

  test('classifies errors into fixed reason codes without leaking messages', () => {
    expect(classifyError(new Error('Keychain access denied'))).toBe('keychain');
    expect(classifyError(new Error('Could not get code signature for running application'))).toBe('signature');
    expect(classifyError(Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' }))).toBe('network');
    expect(classifyError(new Error('HttpError: 404 Not Found'))).toBe('not_found');
    expect(classifyError(new Error('SQLITE_BUSY: database is locked'))).toBe('database');
    expect(classifyError(new Error('User someone@example.com failed'))).toBe('other');
  });

  test('normalization keeps the last snapshot day only when well-formed', () => {
    expect(normalizeUsageAnalyticsSettings({ lastSnapshotDay: '2026-11-03' }).lastSnapshotDay).toBe('2026-11-03');
    expect(normalizeUsageAnalyticsSettings({ lastSnapshotDay: 'yesterday' }).lastSnapshotDay).toBeNull();
  });

  test('sanitizeProps returns null for unknown events', () => {
    expect(sanitizeProps('nope', {})).toBeNull();
  });
});
