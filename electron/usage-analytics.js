/**
 * Opt-in, anonymous usage analytics sent to Aptabase (https://aptabase.com).
 *
 * Privacy contract (mirrored in PRIVACY.md):
 * - Nothing is sent unless the user explicitly opted in (settings.usageAnalytics.enabled).
 * - No device or user identifier is stored. Each app run gets a random session id
 *   held in memory only.
 * - Only the events and props declared in EVENT_SCHEMAS are sent. Prop values are
 *   restricted to booleans and short tokens (letters, digits, "_" and "-"), so
 *   amounts, merchant names, account numbers, e-mails or free text cannot pass.
 * - Development runs never send unless SHEKELSYNC_ANALYTICS_DEBUG=true, and those
 *   events are flagged isDebug so they stay out of the production dashboard.
 *
 * We talk to Aptabase's HTTP API directly instead of using @aptabase/electron:
 * that SDK queues events before consent, registers a CSP-bypassing protocol and
 * relies on protocol APIs deprecated in modern Electron.
 */

const crypto = require('crypto');
const os = require('os');

// Public Aptabase app key (safe to ship; it only allows sending events).
// Create one at https://aptabase.com and paste it here, or set
// SHEKELSYNC_APTABASE_APP_KEY at runtime. Empty means analytics is unavailable.
const BUILT_IN_APP_KEY = 'A-EU-4211407366';

const APTABASE_HOSTS = {
  US: 'https://us.aptabase.com',
  EU: 'https://eu.aptabase.com',
};
const SDK_VERSION = 'shekelsync-analytics@1.0.0';
const SESSION_TIMEOUT_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[A-Za-z0-9.]{1,20})?$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const EVENT_SCHEMAS = Object.freeze({
  app_started: {},
  analytics_opted_in: {},
  screen_viewed: { screen: 'token' },
  institution_added: { vendor: 'token' },
  first_sync_succeeded: { vendor: 'token' },
  sync_completed: {
    vendor: 'token',
    success: 'boolean',
    errorType: 'token',
    duration: 'token',
    trigger: 'token',
    scraperVersion: 'version',
  },
  daily_snapshot: {
    institutions: 'token',
    installAge: 'token',
    autoSync: 'boolean',
    telegram: 'boolean',
    aiAssistant: 'boolean',
    property: 'boolean',
    budgets: 'boolean',
    goals: 'boolean',
  },
  startup_failed: { reason: 'token' },
  update_failed: { reason: 'token', mode: 'token' },
  app_error: { area: 'token', errorType: 'token' },
});

// Events the renderer is allowed to send over IPC. Everything else is emitted
// by the main process itself.
const RENDERER_EVENTS = new Set(['screen_viewed', 'app_error']);

// Per-session caps so an error loop can't flood the service.
const SESSION_EVENT_CAPS = Object.freeze({
  app_error: 20,
  update_failed: 5,
  startup_failed: 5,
  screen_viewed: 500,
});

function normalizeUsageAnalyticsSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const decidedAt = typeof source.decidedAt === 'string' && source.decidedAt ? source.decidedAt : null;
  const lastSnapshotDay = typeof source.lastSnapshotDay === 'string' && DAY_PATTERN.test(source.lastSnapshotDay)
    ? source.lastSnapshotDay
    : null;
  return {
    enabled: source.enabled === true,
    decidedAt,
    lastSnapshotDay,
  };
}

function resolveAppKeyConfig(env = process.env, builtInAppKey = BUILT_IN_APP_KEY) {
  const appKey = String(env.SHEKELSYNC_APTABASE_APP_KEY || builtInAppKey || '').trim();
  const parts = appKey.split('-');
  if (parts.length !== 3 || parts[0] !== 'A' || !parts[2]) {
    return null;
  }
  const region = parts[1];
  if (region === 'SH') {
    const host = String(env.SHEKELSYNC_APTABASE_HOST || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\//.test(host)) {
      return null;
    }
    return { appKey, host };
  }
  const host = APTABASE_HOSTS[region];
  return host ? { appKey, host } : null;
}

function sanitizeProps(eventName, props) {
  const schema = EVENT_SCHEMAS[eventName];
  if (!schema) {
    return null;
  }
  const sanitized = {};
  const source = props && typeof props === 'object' ? props : {};
  for (const [key, type] of Object.entries(schema)) {
    const value = source[key];
    if (type === 'boolean' && typeof value === 'boolean') {
      sanitized[key] = value;
    } else if (type === 'token' && typeof value === 'string' && TOKEN_PATTERN.test(value)) {
      sanitized[key] = value;
    } else if (type === 'version' && typeof value === 'string' && VERSION_PATTERN.test(value)) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function bucketDuration(durationMs) {
  const seconds = Number(durationMs) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  if (seconds < 30) return 'lt30s';
  if (seconds < 60) return '30to60s';
  if (seconds < 120) return '1to2m';
  if (seconds < 300) return '2to5m';
  return 'gt5m';
}

function bucketCount(count) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value === 1) return '1';
  if (value <= 3) return '2to3';
  return '4plus';
}

function bucketAgeDays(firstSeenMs, nowMs = Date.now()) {
  const first = Number(firstSeenMs);
  if (!Number.isFinite(first) || first <= 0) return 'unknown';
  const days = (nowMs - first) / (24 * 60 * 60 * 1000);
  if (days < 7) return 'lt7d';
  if (days < 30) return '7to30d';
  if (days < 90) return '30to90d';
  return 'gt90d';
}

/**
 * Map an error to a short reason code. Only fixed codes or Node/HTTP error
 * codes leave the device; messages never do.
 */
function classifyError(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = String(error?.message || error || '').toLowerCase();
  if (/keychain|secret service|libsecret|credential manager|encryption key/.test(message)) return 'keychain';
  if (/code signature|signature|notar|codesign/.test(message)) return 'signature';
  if (/sqlite|database|sqlite_busy|database is locked/.test(message)) return 'database';
  if (/\b404\b|not found/.test(message)) return 'not_found';
  if (/enotfound|econnreset|econnrefused|etimedout|eai_again|net::|network|socket|timeout/.test(message)
    || /^E(NOTFOUND|CONNRESET|CONNREFUSED|TIMEDOUT|AI_AGAIN)$/.test(code)) return 'network';
  if (/eacces|eperm|permission/.test(message) || code === 'EACCES' || code === 'EPERM') return 'permission';
  if (/enospc|no space/.test(message) || code === 'ENOSPC') return 'disk_full';
  return 'other';
}

function describeOperatingSystem(platform = process.platform) {
  const version = typeof process.getSystemVersion === 'function'
    ? process.getSystemVersion()
    : os.release();
  switch (platform) {
    case 'darwin':
      return { osName: 'macOS', osVersion: version };
    case 'win32':
      return { osName: 'Windows', osVersion: version };
    default:
      // Kernel release only; distro names are not needed for these stats.
      return { osName: 'Linux', osVersion: os.release() };
  }
}

// Same shape the official Aptabase SDKs use: epoch seconds + 8 random digits.
function createSessionId(nowMs = Date.now()) {
  const epochSeconds = Math.floor(nowMs / 1000).toString();
  const random = crypto.randomInt(0, 100_000_000).toString().padStart(8, '0');
  return epochSeconds + random;
}

function createUsageAnalytics({
  builtInAppKey = BUILT_IN_APP_KEY,
  appVersion,
  isPackaged,
  getLocale = () => 'en',
  fetchImpl = globalThis.fetch,
  env = process.env,
  platform = process.platform,
  logger = console,
  now = () => Date.now(),
} = {}) {
  const config = resolveAppKeyConfig(env, builtInAppKey);
  const debugSendingAllowed = env.SHEKELSYNC_ANALYTICS_DEBUG === 'true';
  const isDebug = !isPackaged;
  const available = Boolean(config && typeof fetchImpl === 'function' && (isPackaged || debugSendingAllowed));
  const osInfo = describeOperatingSystem(platform);

  let enabled = false;
  let sessionId = createSessionId(now());
  let lastActivityAt = now();
  const sentCounts = new Map();

  function touchSession() {
    const current = now();
    if (current - lastActivityAt > SESSION_TIMEOUT_MS) {
      sessionId = createSessionId(now());
    }
    lastActivityAt = current;
    return sessionId;
  }

  function setEnabled(nextEnabled) {
    const next = nextEnabled === true;
    if (next && !enabled) {
      // Start a fresh session so data from before and after opting in is never linked.
      sessionId = createSessionId(now());
      lastActivityAt = now();
    }
    enabled = next;
  }

  async function track(eventName, props) {
    if (!enabled || !available) {
      return false;
    }
    const sanitizedProps = sanitizeProps(eventName, props);
    if (!sanitizedProps) {
      logger.debug?.('Usage analytics: dropped unknown event', { eventName });
      return false;
    }
    const cap = SESSION_EVENT_CAPS[eventName];
    const sentSoFar = sentCounts.get(eventName) || 0;
    if (cap && sentSoFar >= cap) {
      return false;
    }
    sentCounts.set(eventName, sentSoFar + 1);

    const body = {
      timestamp: new Date(now()).toISOString(),
      sessionId: touchSession(),
      eventName,
      systemProps: {
        isDebug,
        locale: String(getLocale() || 'en'),
        osName: osInfo.osName,
        osVersion: osInfo.osVersion,
        engineName: 'Chromium',
        engineVersion: process.versions.chrome || '',
        appVersion: appVersion || '',
        sdkVersion: SDK_VERSION,
      },
      props: sanitizedProps,
    };

    try {
      const response = await fetchImpl(`${config.host}/api/v0/event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'App-Key': config.appKey,
        },
        body: JSON.stringify(body),
        credentials: 'omit',
        signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined,
      });
      if (!response?.ok) {
        logger.debug?.('Usage analytics: event rejected', { eventName, status: response?.status });
        return false;
      }
      return true;
    } catch (error) {
      logger.debug?.('Usage analytics: event not sent', { eventName, error: error?.message });
      return false;
    }
  }

  function trackFromRenderer(eventName, props) {
    if (!RENDERER_EVENTS.has(eventName)) {
      return Promise.resolve(false);
    }
    return track(eventName, props);
  }

  function getStatus() {
    return { available, enabled };
  }

  return {
    setEnabled,
    track,
    trackFromRenderer,
    getStatus,
  };
}

module.exports = {
  createUsageAnalytics,
  normalizeUsageAnalyticsSettings,
  bucketDuration,
  bucketCount,
  bucketAgeDays,
  classifyError,
  _internal: {
    EVENT_SCHEMAS,
    RENDERER_EVENTS,
    resolveAppKeyConfig,
    sanitizeProps,
    describeOperatingSystem,
  },
};
