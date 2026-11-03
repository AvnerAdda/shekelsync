/**
 * In-process bus for anonymous usage signals (opt-in analytics).
 *
 * Server code emits coarse facts here, such as "a sync for vendor X finished"
 * or "an institution was added". The Electron shell subscribes and decides
 * whether to forward them based on the user's consent. Payloads must never
 * contain amounts, messages, credentials or other user data; the shell also
 * sanitizes everything against a fixed schema before sending.
 *
 * Kept dependency-free so subscribers don't load heavy modules (e.g. scrapers).
 */
const listeners = new Set();

function onUsageEvent(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function hasUsageListeners() {
  return listeners.size > 0;
}

function emitUsageEvent(type, payload = {}) {
  if (typeof type !== 'string' || listeners.size === 0) {
    return;
  }
  const frozen = Object.freeze({ ...payload });
  for (const listener of listeners) {
    try {
      listener(type, frozen);
    } catch {
      // Observers must never affect app behavior.
    }
  }
}

module.exports = {
  onUsageEvent,
  hasUsageListeners,
  emitUsageEvent,
};
