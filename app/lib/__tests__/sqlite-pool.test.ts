import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

type StatementRecord = {
  sql: string;
  allCalls: unknown[][];
  runCalls: unknown[][];
};

let tmpDir: string;
let dbPath: string;
let latestDb: {
  statements: StatementRecord[];
  execCalls: string[];
  pragmaCalls: string[];
  close: () => void;
  path: string;
  options: Record<string, unknown>;
} | null;

class MockDatabase {
  statements: StatementRecord[] = [];
  execCalls: string[] = [];
  pragmaCalls: string[] = [];
  close = vi.fn();
  path: string;
  options: Record<string, unknown>;

  constructor(filename: string, options: Record<string, unknown>) {
    this.path = filename;
    this.options = options;
    latestDb = {
      statements: this.statements,
      execCalls: this.execCalls,
      pragmaCalls: this.pragmaCalls,
      close: this.close,
      path: this.path,
      options: this.options,
    };
  }

  prepare(sql: string) {
    const record: StatementRecord = { sql, allCalls: [], runCalls: [] };
    this.statements.push(record);
    return new MockStatement(record);
  }

  exec(sql: string) {
    this.execCalls.push(sql);
  }

  pragma(value: string) {
    this.pragmaCalls.push(value);
  }
}

class MockStatement {
  private record: StatementRecord;

  constructor(record: StatementRecord) {
    this.record = record;
  }

  all(params: unknown[]) {
    this.record.allCalls.push(params);
    return [{ ok: true }];
  }

  run(params: unknown[]) {
    this.record.runCalls.push(params);
    return { changes: 1 };
  }
}

async function loadPool(overrides: Record<string, unknown> = {}) {
  const mod = await import('../sqlite-pool.js');
  const factory: any = mod.default || mod;
  return factory({ databasePath: dbPath, databaseCtor: MockDatabase as any, ...overrides });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-pool-'));
  dbPath = path.join(tmpDir, 'clarify.sqlite');
  fs.writeFileSync(dbPath, '');
  latestDb = null;
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('sqlite-pool', () => {
  it('opens the provided database path and enables pragmas', async () => {
    await loadPool();
    expect(latestDb?.path).toBe(dbPath);
    expect(latestDb?.options).toEqual({ fileMustExist: true });
    expect(latestDb?.pragmaCalls).toEqual(['foreign_keys = ON', 'journal_mode = WAL']);
  });

  it('converts positional placeholders and normalises params for SELECT', async () => {
    const pool = await loadPool();

    const result = await pool.query('SELECT * FROM foo WHERE id = $1 AND active = $2', [7, true]);

    expect(result.rows).toEqual([{ ok: true }]);
    const stmt = latestDb!.statements.find((record) => record.sql === 'SELECT * FROM foo WHERE id = ? AND active = ?');
    expect(stmt).toBeTruthy();
    expect(stmt!.allCalls[0]).toEqual([7, 1]);
  });

  it('runs non-select statements and returns affected row count', async () => {
    const pool = await loadPool();

    const result = await pool.query('UPDATE foo SET active = $1 WHERE id = $2', [false, 3]);

    expect(result).toEqual({ rows: [], rowCount: 1 });
    const stmt = latestDb!.statements.find((record) => record.sql === 'UPDATE foo SET active = ? WHERE id = ?');
    expect(stmt).toBeTruthy();
    expect(stmt!.runCalls[0]).toEqual([0, 3]);
  });

  it('executes transaction control statements directly', async () => {
    const pool = await loadPool();

    await pool.query('BEGIN');
    await pool.query('COMMIT');

    expect(latestDb!.execCalls.slice(-2)).toEqual(['BEGIN', 'COMMIT']);
  });

  it('throws when not enough positional parameter values are provided', async () => {
    const pool = await loadPool();

    await expect(pool.query('SELECT $1, $2 FROM dual', [1])).rejects.toThrow(RangeError);
  });

  it('builds transactions FTS triggers using row deletes for updates/removals', async () => {
    await loadPool();

    const execSql = (latestDb?.execCalls || []).join('\n');
    expect(execSql).toContain('CREATE TRIGGER IF NOT EXISTS transactions_fts_delete');
    expect(execSql).toContain('DELETE FROM transactions_fts');
    expect(execSql).not.toContain('INSERT INTO transactions_fts(transactions_fts');
  });
});
