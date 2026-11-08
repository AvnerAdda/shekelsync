/**
 * App lock: keeps ShekelSync locked at launch until the user authenticates,
 * and asks again before sensitive actions (bank credential changes and
 * user-started syncs).
 *
 * - macOS: Touch ID when the sensor is usable, otherwise the Mac password.
 * - Windows: Windows Hello (which offers its own PIN fallback).
 * - Anywhere no method is available, the app stays unlocked; it never
 *   locks the user out of their own data.
 *
 * Enforcement lives in the main process (the renderer lock screen is only the
 * UI), so a locked window cannot read data through the API proxy.
 */

const REAUTH_GRACE_MS = 60 * 1000;

const PROTECTED_ACTIONS = Object.freeze([
  {
    action: 'sync',
    methods: new Set(['POST']),
    pattern: /^\/api\/scrape(?:\/bulk)?\/?$/i,
  },
  {
    action: 'credentials',
    methods: new Set(['POST', 'PUT', 'PATCH', 'DELETE']),
    pattern: /^\/api\/credentials(?:\/[^/]+)?\/?$/i,
  },
]);

const PROMPT_REASONS = Object.freeze({
  unlock: 'unlock your financial data',
  sync: 'sync your bank accounts',
  credentials: 'change your bank account credentials',
});

function normalizeEndpointPath(endpoint) {
  const raw = String(endpoint || '');
  const withoutQuery = raw.split(/[?#]/)[0];
  try {
    // Resolve dot segments, percent-encoding and repeated slashes so
    // "/api/./scrape", "/api/%73crape" or "/api//scrape" cannot slip past the
    // protected-route match (Express routes also match case-insensitively).
    const resolved = new URL(withoutQuery, 'http://localhost').pathname;
    return decodeURIComponent(resolved).replace(/\/{2,}/g, '/');
  } catch {
    return withoutQuery.replace(/\/{2,}/g, '/');
  }
}

function getProtectedAction(method, endpoint) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const pathName = normalizeEndpointPath(endpoint);
  const match = PROTECTED_ACTIONS.find(
    (entry) => entry.methods.has(normalizedMethod) && entry.pattern.test(pathName),
  );
  return match ? match.action : null;
}

/**
 * @param {object} deps
 * @param {() => Promise<string|null>} deps.resolveMethod - the auth method
 *   usable right now ('touchid' | 'password' | 'windows-hello'), or null.
 * @param {(method: string, reason: string) => Promise<{success: boolean, cancelled?: boolean, error?: string}>} deps.prompt
 */
function createAppLock({
  resolveMethod,
  prompt,
  enabled = true,
  logger = console,
  now = () => Date.now(),
  graceMs = REAUTH_GRACE_MS,
} = {}) {
  let initPromise = null;
  let method = null;
  let locked = true;
  let lastAuthenticatedAt = null;
  let inFlightPrompt = null;

  function initialize() {
    if (!initPromise) {
      initPromise = (async () => {
        if (!enabled) {
          locked = false;
          logger.info?.('[AppLock] Disabled for this run');
          return;
        }
        try {
          method = await resolveMethod();
        } catch (error) {
          method = null;
          logger.warn?.('[AppLock] Could not determine an authentication method', { error: error?.message });
        }
        locked = Boolean(method);
        logger.info?.('[AppLock] Initialized', { locked, method: method || 'none' });
      })();
    }
    return initPromise;
  }

  async function getState() {
    await initialize();
    return { locked, method };
  }

  async function isLocked() {
    await initialize();
    return locked;
  }

  // One system prompt at a time: concurrent callers share its outcome.
  function runPrompt(reasonKey) {
    if (!inFlightPrompt) {
      inFlightPrompt = (async () => {
        let currentMethod = method;
        try {
          currentMethod = (await resolveMethod()) || method;
        } catch {
          // Keep the method chosen at startup.
        }
        if (!currentMethod) {
          return { success: false, error: 'No authentication method is available' };
        }
        const result = await prompt(currentMethod, PROMPT_REASONS[reasonKey] || PROMPT_REASONS.unlock);
        if (result?.success) {
          lastAuthenticatedAt = now();
          return { success: true, method: currentMethod };
        }
        return {
          success: false,
          method: currentMethod,
          cancelled: result?.cancelled === true,
          error: result?.error || 'Authentication failed',
        };
      })().finally(() => {
        inFlightPrompt = null;
      });
    }
    return inFlightPrompt;
  }

  async function unlock() {
    await initialize();
    if (!locked) {
      return { success: true, locked: false };
    }
    const result = await runPrompt('unlock');
    if (result.success) {
      locked = false;
      logger.info?.('[AppLock] Unlocked', { method: result.method });
    } else {
      logger.warn?.('[AppLock] Unlock failed', { method: result.method, cancelled: result.cancelled === true });
    }
    return { ...result, locked };
  }

  function hasRecentAuthentication() {
    return lastAuthenticatedAt !== null && now() - lastAuthenticatedAt <= graceMs;
  }

  /**
   * Confirm the user is present before a sensitive action. Authentication in
   * the last minute (including the unlock) counts, so adding an account and
   * its first sync only prompt once.
   */
  async function authorizeAction(action) {
    await initialize();
    if (locked) {
      return { success: false, error: 'ShekelSync is locked' };
    }
    if (!method || hasRecentAuthentication()) {
      return { success: true };
    }
    const result = await runPrompt(action);
    if (!result.success) {
      logger.warn?.('[AppLock] Re-authentication failed', { action, cancelled: result.cancelled === true });
    }
    return result;
  }

  return {
    initialize,
    getState,
    isLocked,
    unlock,
    authorizeAction,
  };
}

module.exports = {
  createAppLock,
  getProtectedAction,
  REAUTH_GRACE_MS,
  _internal: { normalizeEndpointPath, PROMPT_REASONS },
};
