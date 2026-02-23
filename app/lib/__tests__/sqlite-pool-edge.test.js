import { afterEach, describe, expect, it, vi } from 'vitest';

const createSqlitePool = require('../sqlite-pool.js');
const fs = require('fs');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sqlite-pool edge cases', () => {
  it('throws when placeholders exceed provided params', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const pool = createSqlitePool({
      databaseCtor: class FakeDb {
        prepare() {
          return {
            all() {
              return [];
            },
          };
        }
        pragma() {}
      },
      databasePath: 'dist/shekelsync.sqlite',
    });

    await expect(pool.query('SELECT * FROM t WHERE id=$1 AND name=$2', [1])).rejects.toThrow(
      /Too few parameter values/,
    );
  });

  it('allows RETURNING statements to run with .query path', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const prepareMock = vi.fn(() => ({
      all: () => [{ id: 1 }],
    }));

    const pool = createSqlitePool({
      databaseCtor: class FakeDb {
        prepare(sql) {
          return prepareMock(sql);
        }
        pragma() {}
      },
      databasePath: 'dist/shekelsync.sqlite',
    });

    const result = await pool.query('UPDATE t SET name=$1 WHERE id=$2 RETURNING id', ['x', 1]);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]).toEqual({ id: 1 });
  });
  it('throws when database file does not exist', () => {
    expect(() =>
      createSqlitePool({
        databasePath: '/tmp/non-existent-shekelsync.sqlite',
        databaseCtor: class FakeDb {
          prepare() {
            return { all: () => [] };
          }
          pragma() {}
        },
      }),
    ).toThrow(/SQLite database not found/);
  });
});
