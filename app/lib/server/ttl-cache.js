const DEFAULT_MAX_ENTRIES = 50;
const DEFAULT_TTL_MS = 60 * 1000;
const cacheStores = new Set();

// Analytics services share this factory. Clear their cached snapshots after a
// transaction changes, without importing every analytics service into writers.
function clearAllTtlCaches() {
  for (const reference of cacheStores) {
    const store = reference.deref();
    if (store) store.clear();
    else cacheStores.delete(reference);
  }
}

function createTtlCache({ maxEntries = DEFAULT_MAX_ENTRIES, defaultTtlMs = DEFAULT_TTL_MS } = {}) {
  const store = new Map();
  cacheStores.add(new WeakRef(store));

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
  clearAllTtlCaches,
};
module.exports.default = module.exports;
