import { describe, expect, it, beforeEach, afterEach } from 'vitest';

const loadDialect = (useSqliteValue) => {
  const originalEnv = { ...process.env };
  process.env.USE_SQLITE = useSqliteValue ? 'true' : 'false';
  process.env.USE_SQLCIPHER = '';
  process.env.SQLITE_DB_PATH = '';
  process.env.SQLCIPHER_DB_PATH = '';
  process.env.CLARIFY_DB_MODE = useSqliteValue ? 'sqlite' : 'postgres';
  const path = require.resolve('../sql-dialect.js');
  delete require.cache[path];
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const module = require('../sql-dialect.js');
  Object.assign(process.env, originalEnv);
  return module.dialect;
};

describe('sql-dialect', () => {
  let dialect;

  afterEach(() => {
    dialect = undefined;
  });

  it('formats helpers for sqlite', () => {
    dialect = loadDialect(true);

    expect(dialect.dateTrunc('month', 'created_at')).toBe("date(created_at, 'start of month')");
    expect(dialect.dateTrunc('week', 'created_at')).toContain('weekday 0');
    expect(dialect.dateTrunc('unknown', 'created_at')).toBe('date(created_at)');
    expect(dialect.toChar('created_at', 'YYYY-MM-DD HH24:MI')).toBe(
      "strftime('%Y-%m-%d %H:%M', created_at)",
    );
    expect(dialect.extract('dow', 'created_at')).toBe("CAST(strftime('%w', created_at) AS INTEGER)");
    expect(dialect.extract('quarter', 'created_at')).toBe("CAST(strftime('%q', created_at) AS INTEGER)");
    expect(dialect.castNumeric('amount')).toBe('CAST(amount AS REAL)');
    expect(dialect.likeInsensitive('name', "'foo'")).toBe("LOWER(name) LIKE LOWER('foo')");
    expect(dialect.excludePikadon('t')).toBe('(t.is_pikadon_related IS NULL OR t.is_pikadon_related = 0)');
  });

  it('formats helpers for postgres', () => {
    dialect = loadDialect(false);

    expect(dialect.dateTrunc('day', 'created_at')).toBe("DATE_TRUNC('day', created_at)");
    expect(dialect.toChar('created_at', 'YYYY-MM')).toBe("TO_CHAR(created_at, 'YYYY-MM')");
    expect(dialect.extract('year', 'created_at')).toBe('EXTRACT(YEAR FROM created_at)');
    expect(dialect.castNumeric('amount')).toBe('amount::numeric');
  });
});
