/** Separate, opt-in installation counts. Never attach this identity to Aptabase events. */
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const builtInConfig = require('./installation-activity-config.json');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RETRY_DELAY_MS = 60_000;

function isActiveForegroundWindow(window, idleSeconds) {
  return Boolean(window && !window.isDestroyed() && window.isVisible() && window.isFocused()
    && !window.isMinimized() && Number.isFinite(idleSeconds) && idleSeconds >= 0 && idleSeconds < 300);
}

function normalizeInstallationActivitySettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: source.enabled === true,
    excluded: source.excluded === true,
    consentedAt: typeof source.consentedAt === 'string' && Number.isFinite(Date.parse(source.consentedAt))
      ? source.consentedAt : null,
  };
}

function resolveInstallationActivityConfig(env, defaults) {
  const overridden = env.SHEKELSYNC_USAGE_METRICS_URL !== undefined || env.SHEKELSYNC_USAGE_METRICS_KEY !== undefined;
  const source = overridden ? {
    supabaseUrl: env.SHEKELSYNC_USAGE_METRICS_URL,
    publishableKey: env.SHEKELSYNC_USAGE_METRICS_KEY,
  } : defaults;
  try {
    const url = new URL(source.supabaseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    const key = source.publishableKey;
    // Only a public client key is permitted. Never accept a service-role key.
    const publishable = typeof key === 'string' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
    const anon = typeof key === 'string' && key.split('.').length === 3
      && JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')).role === 'anon';
    return publishable || anon ? { url: url.origin, key } : null;
  } catch {
    return null;
  }
}

function createInstallationActivity({
  userDataPath,
  isPackaged,
  fetchImpl = globalThis.fetch,
  env = process.env,
  defaults = builtInConfig,
  now = () => Date.now(),
  logger = console,
} = {}) {
  const config = resolveInstallationActivityConfig(env, defaults);
  // Development and test builds never contribute, even with analytics debugging enabled.
  const available = Boolean(config && isPackaged && typeof fetchImpl === 'function');
  const excludedByEnvironment = env.SHEKELSYNC_ANALYTICS_EXCLUDE === 'true';
  const filePath = path.join(userDataPath, 'usage', 'installation-activity.json');
  let settings = normalizeInstallationActivitySettings();
  let allowed = false;
  let state;
  let queue = Promise.resolve();
  let nextAttemptAt = 0;
  let activeReportController;

  async function loadState() {
    if (state !== undefined) return state;
    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (!UUID_PATTERN.test(data.id) || !TOKEN_PATTERN.test(data.token)
        || typeof data.retired !== 'boolean'
        || (data.lastReportedDay !== null && !DAY_PATTERN.test(data.lastReportedDay))) {
        throw new Error('Invalid installation activity state');
      }
      state = data;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = null;
    }
    return state;
  }

  async function saveState(data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
      await fs.rename(temporaryPath, filePath);
      state = data;
    } finally {
      await fs.unlink(temporaryPath).catch(() => {});
    }
  }

  async function request(functionName, identity, report = false) {
    const controller = new AbortController();
    if (report) activeReportController = controller;
    const timer = setTimeout(() => controller.abort(), 10_000);
    timer.unref?.();
    try {
      const response = await fetchImpl(`${config.url}/rest/v1/rpc/${functionName}`, {
        method: 'POST',
        headers: { apikey: config.key, 'Content-Type': 'application/json',
          ...(!config.key.startsWith('sb_publishable_') ? { Authorization: `Bearer ${config.key}` } : {}),
        },
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
        body: JSON.stringify({ p_installation_id: identity.id, p_token: identity.token }),
      });
      if (!response.ok) throw new Error('Installation activity request rejected');
      return report ? response.json() : null;
    } finally {
      clearTimeout(timer);
      if (activeReportController === controller) activeReportController = null;
    }
  }

  function enqueue(operation) {
    const result = queue.then(operation).catch(() => {
      // Never log identities, tokens, request bodies, or service responses.
      logger.debug?.('Installation activity could not be updated; will retry later.');
      nextAttemptAt = now() + RETRY_DELAY_MS;
      return false;
    });
    queue = result;
    return result;
  }

  async function forgetRetiredState() {
    const identity = await loadState();
    if (!identity?.retired) return true;
    if (!available) return false;
    await request('forget_installation_activity', identity);
    await fs.unlink(filePath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    state = null;
    nextAttemptAt = 0;
    return true;
  }

  function setSettings(raw) {
    settings = normalizeInstallationActivitySettings(raw);
    const retire = !settings.enabled || !settings.consentedAt || settings.excluded || excludedByEnvironment;
    allowed = available && !retire;
    if (!allowed) activeReportController?.abort();
    return enqueue(async () => {
      const identity = await loadState();
      // Record revocation durably before attempting network deletion. If offline,
      // the next launch retries deletion before a new identity can be created.
      if (retire && identity && !identity.retired) await saveState({ ...identity, retired: true });
      return forgetRetiredState();
    });
  }

  function recordActivity() {
    if (!allowed) return Promise.resolve(false);
    return enqueue(async () => {
      if (!allowed || now() < nextAttemptAt) return false;
      if (!await forgetRetiredState()) return false;
      if (!allowed) return false;
      let identity = await loadState();
      const today = new Date(now()).toISOString().slice(0, 10);
      if (identity?.lastReportedDay === today) return true;
      if (!identity) {
        identity = { id: crypto.randomUUID(), token: crypto.randomBytes(32).toString('hex'), retired: false, lastReportedDay: null };
        // Save before sending, so restarts and app updates reuse the same ID.
        await saveState(identity);
      }
      if (!allowed) return false;
      const day = await request('record_installation_activity', identity, true);
      if (typeof day !== 'string' || !DAY_PATTERN.test(day)) throw new Error('Invalid activity response');
      await saveState({ ...identity, lastReportedDay: day });
      nextAttemptAt = 0;
      return true;
    });
  }

  function getStatus() {
    return { available, enabled: allowed, excluded: settings.excluded || excludedByEnvironment, excludedByEnvironment };
  }

  return { setSettings, recordActivity, getStatus };
}

module.exports = { createInstallationActivity, normalizeInstallationActivitySettings, resolveInstallationActivityConfig, isActiveForegroundWindow };
