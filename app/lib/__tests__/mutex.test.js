const Mutex = require('../mutex.js');

describe('Mutex', () => {
  it('serializes async operations', async () => {
    const mutex = new Mutex();
    const results = [];

    // Start three operations concurrently
    const promises = [
      mutex.runExclusive(async () => {
        results.push('start-1');
        await new Promise((resolve) => setTimeout(resolve, 50));
        results.push('end-1');
        return 'result-1';
      }),
      mutex.runExclusive(async () => {
        results.push('start-2');
        await new Promise((resolve) => setTimeout(resolve, 30));
        results.push('end-2');
        return 'result-2';
      }),
      mutex.runExclusive(async () => {
        results.push('start-3');
        await new Promise((resolve) => setTimeout(resolve, 20));
        results.push('end-3');
        return 'result-3';
      }),
    ];

    const values = await Promise.all(promises);

    // Operations should complete in order (serialized)
    expect(results).toEqual([
      'start-1',
      'end-1',
      'start-2',
      'end-2',
      'start-3',
      'end-3',
    ]);

    // But all promises should return their values
    expect(values).toEqual(['result-1', 'result-2', 'result-3']);
  });

  it('handles errors without blocking subsequent operations', async () => {
    const mutex = new Mutex();
    const results = [];

    const promise1 = mutex.runExclusive(async () => {
      results.push('start-1');
      throw new Error('Operation 1 failed');
    });

    const promise2 = mutex.runExclusive(async () => {
      results.push('start-2');
      results.push('end-2');
      return 'success-2';
    });

    // First promise should reject
    await expect(promise1).rejects.toThrow('Operation 1 failed');

    // Second promise should succeed
    await expect(promise2).resolves.toBe('success-2');

    // Both operations should have executed
    expect(results).toEqual([
      'start-1',
      'start-2',
      'end-2',
    ]);
  });

  it('tracks lock state correctly', async () => {
    const mutex = new Mutex();

    expect(mutex.isLocked()).toBe(false);
    expect(mutex.getQueueLength()).toBe(0);

    const promise1 = mutex.runExclusive(async () => {
      expect(mutex.isLocked()).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Give it a moment to start
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mutex.isLocked()).toBe(true);

    const promise2 = mutex.runExclusive(async () => {
      expect(mutex.isLocked()).toBe(true);
    });

    // Second operation should be queued
    expect(mutex.getQueueLength()).toBe(1);

    await Promise.all([promise1, promise2]);

    expect(mutex.isLocked()).toBe(false);
    expect(mutex.getQueueLength()).toBe(0);
  });

  it('returns the result of the operation', async () => {
    const mutex = new Mutex();

    const result = await mutex.runExclusive(async () => {
      return { success: true, value: 42 };
    });

    expect(result).toEqual({ success: true, value: 42 });
  });

  it('handles synchronous operations', async () => {
    const mutex = new Mutex();
    const results = [];

    await Promise.all([
      mutex.runExclusive(() => {
        results.push(1);
        return 'one';
      }),
      mutex.runExclusive(() => {
        results.push(2);
        return 'two';
      }),
    ]);

    expect(results).toEqual([1, 2]);
  });
});
