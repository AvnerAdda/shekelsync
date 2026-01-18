const DEFAULT_MAX_ENTRIES = 50;
const DEFAULT_TTL_MS = 60 * 1000;

function createTtlCache({ maxEntries = DEFAULT_MAX_ENTRIES, defaultTtlMs = DEFAULT_TTL_MS } = {}) {
  const store = new Map();

  const pruneExpired = () => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (!entry || entry.expiresAt <= now) {
        store.delete(key);
      }
    }
  };

  const get = (key) => {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  };

  const set = (key, value, ttlMs = defaultTtlMs) => {
    const ttl = Number.isFinite(ttlMs) ? Math.max(0, ttlMs) : defaultTtlMs;
    store.set(key, { value, expiresAt: Date.now() + ttl });
    if (store.size > maxEntries) {
      const oldestKey = store.keys().next().value;
      if (oldestKey !== undefined) {
        store.delete(oldestKey);
      }
    }
  };

  const clear = () => {
    store.clear();
  };

  const size = () => store.size;

  return {
    get,
    set,
    clear,
    size,
    pruneExpired,
  };
}

module.exports = {
  createTtlCache,
};
module.exports.default = module.exports;
