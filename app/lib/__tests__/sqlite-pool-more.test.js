import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const fs = require('fs');
const createSqlitePool = require('../sqlite-pool.js');

describe('sqlite-pool additional coverage', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes booleans and rewrites positional placeholders for SELECT', async () => {
    const captured = { sql: '', params: [] };
    const pool = createSqlitePool({
      databasePath: 'dist/clarify.sqlite',
      databaseCtor: class FakeDb {
        prepare(sql) {
          captured.sql = sql;
          return {
            all(params) {
              captured.params = params;
              return [];
            },
          };
        }
        pragma() {}
      },
    });

    await pool.query('SELECT * FROM t WHERE active=$1 AND flag=$2', [true, false]);

    expect(captured.sql).toBe('SELECT * FROM t WHERE active=? AND flag=?');
    expect(captured.params).toEqual([1, 0]);
  });

  it('returns rowCount from non-select statements using run()', async () => {
    const pool = createSqlitePool({
      databasePath: 'dist/clarify.sqlite',
      databaseCtor: class FakeDb {
        prepare(sql) {
          return {
            run(params) {
              return { changes: params.length };
            },
          };
        }
        pragma() {}
      },
    });

    const result = await pool.query('UPDATE t SET name=$1 WHERE id=$2', ['foo', 123]);
    expect(result.rowCount).toBe(2);
  });

  it('executes transactional statements via exec', async () => {
    const execMock = vi.fn();
    const pool = createSqlitePool({
      databasePath: 'dist/clarify.sqlite',
      databaseCtor: class FakeDb {
        exec(sql) {
          execMock(sql);
        }
        prepare() {
          return {
            run() {
              return { changes: 0 };
            },
          };
        }
        pragma() {}
      },
    });

    const res = await pool.query('BEGIN');
    expect(execMock).toHaveBeenCalledWith('BEGIN');
    expect(res).toEqual({ rows: [], rowCount: 0 });
  });

  it('throws when positional placeholders receive a non-array params object', async () => {
    const pool = createSqlitePool({
      databasePath: 'dist/clarify.sqlite',
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
    });

    await expect(pool.query('SELECT * FROM t WHERE id=$1', { id: 1 })).rejects.toThrow(
      /Positional parameters require an array/,
    );
  });
});
