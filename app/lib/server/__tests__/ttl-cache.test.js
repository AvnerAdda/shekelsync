import { afterEach, describe, expect, it, vi } from 'vitest';

const { createTtlCache } = require('../ttl-cache.js');

describe('ttl-cache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves cache values', () => {
    const cache = createTtlCache();
    cache.set('key', { value: 1 });

    expect(cache.get('key')).toEqual({ value: 1 });
    expect(cache.size()).toBe(1);
  });

  it('expires entries based on ttl', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    const cache = createTtlCache({ defaultTtlMs: 1000 });
    cache.set('k', 'v');

    vi.advanceTimersByTime(999);
    expect(cache.get('k')).toBe('v');

    vi.advanceTimersByTime(2);
    expect(cache.get('k')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('prunes expired entries in bulk', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    const cache = createTtlCache({ defaultTtlMs: 1000 });
    cache.set('expired', 'x', 10);
    cache.set('alive', 'y', 1000);

    vi.advanceTimersByTime(20);
    cache.pruneExpired();

    expect(cache.get('expired')).toBeUndefined();
    expect(cache.get('alive')).toBe('y');
    expect(cache.size()).toBe(1);
  });

  it('evicts the oldest entry when max size is exceeded', () => {
    const cache = createTtlCache({ maxEntries: 2, defaultTtlMs: 10_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size()).toBe(2);
  });

  it('falls back to default ttl for non-finite values and clamps negatives to immediate expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    const cache = createTtlCache({ defaultTtlMs: 50 });
    cache.set('defaulted', 'v', Number.NaN);

    vi.advanceTimersByTime(49);
    expect(cache.get('defaulted')).toBe('v');
    vi.advanceTimersByTime(2);
    expect(cache.get('defaulted')).toBeUndefined();

    cache.set('negative', 'n', -100);
    expect(cache.get('negative')).toBeUndefined();
  });

  it('clears all entries', () => {
    const cache = createTtlCache();
    cache.set('a', 1);
    cache.set('b', 2);

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });
});
