import { describe, test, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { onUsageEvent, emitUsageEvent, hasUsageListeners } = require('../usage-events.js');

describe('usage events bus', () => {
  test('delivers events to listeners and supports unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = onUsageEvent(listener);
    expect(hasUsageListeners()).toBe(true);

    emitUsageEvent('institution_added', { vendor: 'max' });
    expect(listener).toHaveBeenCalledWith('institution_added', { vendor: 'max' });

    unsubscribe();
    emitUsageEvent('institution_added', { vendor: 'max' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(hasUsageListeners()).toBe(false);
  });

  test('a throwing listener does not affect others or the emitter', () => {
    const removeBad = onUsageEvent(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const removeGood = onUsageEvent(good);

    expect(() => emitUsageEvent('scrape_outcome', { vendor: 'hapoalim', success: false })).not.toThrow();
    expect(good).toHaveBeenCalledWith('scrape_outcome', { vendor: 'hapoalim', success: false });

    removeBad();
    removeGood();
  });
});
