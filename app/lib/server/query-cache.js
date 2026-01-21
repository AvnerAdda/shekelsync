/**
 * Simple query result caching layer for database queries
 * Implements LRU (Least Recently Used) cache with TTL (Time To Live)
 */

class QueryCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 100; // Maximum number of cached queries
    this.defaultTTL = options.defaultTTL || 5 * 60 * 1000; // 5 minutes default TTL
    this.cache = new Map();
    this.enabled = options.enabled !== false;
  }

  /**
   * Generate cache key from query and parameters
   */
  generateKey(query, params = []) {
    const paramStr = JSON.stringify(params);
    return `${query}::${paramStr}`;
  }

  /**
   * Get cached query result
   */
  get(query, params) {
    if (!this.enabled) return null;

    const key = this.generateKey(query, params);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if expired
    if (Date.now() > cached.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Update access time (LRU)
    cached.lastAccess = Date.now();
    this.cache.delete(key);
    this.cache.set(key, cached);

    return cached.data;
  }

  /**
   * Set query result in cache
   */
  set(query, params, data, ttl = this.defaultTTL) {
    if (!this.enabled) return;

    const key = this.generateKey(query, params);

    // Evict oldest entry if cache is full
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
      lastAccess: Date.now(),
    });
  }

  /**
   * Invalidate cache entries by query pattern or all
   */
  invalidate(queryPattern) {
    if (!queryPattern) {
      // Clear all
      this.cache.clear();
      return;
    }

    // Invalidate matching queries
    for (const key of this.cache.keys()) {
      if (key.includes(queryPattern)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalidate cache entries by table name
   */
  invalidateTable(tableName) {
    this.invalidate(tableName);
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      enabled: this.enabled,
    };
  }

  /**
   * Enable/disable cache
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
  }
}

// Singleton instance
let cacheInstance = null;

/**
 * Get or create cache instance
 */
function getQueryCache(options) {
  if (!cacheInstance) {
    cacheInstance = new QueryCache(options);
  }
  return cacheInstance;
}

/**
 * Decorator function to cache database query results
 */
function withCache(fn, options = {}) {
  const cache = getQueryCache();
  const ttl = options.ttl || cache.defaultTTL;

  return function cachedQuery(...args) {
    // First arg is typically the query, second is params
    const [query, params = []] = args;

    // Try to get from cache
    const cached = cache.get(query, params);
    if (cached) {
      return cached;
    }

    // Execute query
    const result = fn.apply(this, args);

    // Cache the result
    cache.set(query, params, result, ttl);

    return result;
  };
}

/**
 * Middleware to invalidate cache after mutations
 */
function createInvalidationMiddleware(tableNames = []) {
  return function invalidateCache() {
    const cache = getQueryCache();
    tableNames.forEach((table) => cache.invalidateTable(table));
  };
}

module.exports = {
  QueryCache,
  getQueryCache,
  withCache,
  createInvalidationMiddleware,
};
