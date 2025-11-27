import { describe, expect, it, vi } from 'vitest';

describe('better-sqlite3-wrapper', () => {
  const reload = () => {
    const path = require.resolve('../better-sqlite3-wrapper.js');
    delete require.cache[path];
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require('../better-sqlite3-wrapper.js');
  };

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.BETTER_SQLITE3_STUB;
  });

  it('returns real module when stub not set', () => {
    vi.resetModules();
    vi.doMock('better-sqlite3', () => function RealDb() {}, { virtual: true });
    process.env.BETTER_SQLITE3_STUB = '';

    const wrapper = reload();
    const result = wrapper();
    expect(typeof result).toBe('function');
  });

  it('returns stub when BETTER_SQLITE3_STUB=true', () => {
    process.env.BETTER_SQLITE3_STUB = 'true';
    const wrapper = reload();
    const { default: Db } = wrapper();
    const db = new Db();
    expect(db.prepare().all()).toEqual([]);
    expect(db.prepare().run()).toEqual({ changes: 0 });
    expect(db.closed).toBe(false);
    db.close();
    expect(db.closed).toBe(true);
  });
});
