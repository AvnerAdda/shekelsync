import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const income = require('../income.js');

describe('detectMonthlyIncome', () => {
  let db: DatabaseSync;
  afterEach(() => {
    income.__resetDatabase();
    db?.close();
  });

  it('takes the median of complete months, excluding capital returns and the current month', async () => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE category_definitions (id INTEGER PRIMARY KEY, name TEXT, name_en TEXT, category_type TEXT, is_counted_as_income INTEGER);
      CREATE TABLE transactions (identifier TEXT, date TEXT, price REAL, category_definition_id INTEGER, category_type TEXT);
      INSERT INTO category_definitions VALUES (1, 'משכורת', 'Salary', 'income', 1), (2, 'החזר קרן', 'Capital Returns', 'income', 1), (3, 'סופר', 'Groceries', 'expense', NULL);
      INSERT INTO transactions VALUES
        ('a', '2026-08-01T00:00:00.000Z', 20000, 1, NULL),
        ('b', '2026-09-01T00:00:00.000Z', 22000, 1, NULL),
        ('c', '2026-09-15T00:00:00.000Z', 50000, 2, NULL),
        ('d', '2026-10-01T00:00:00.000Z', 40000, 1, NULL),
        ('e', '2026-10-05T00:00:00.000Z', -300, 3, NULL),
        ('f', '2026-11-01T00:00:00.000Z', 99999, 1, NULL);
    `);
    income.__setDatabase({
      async query(sql: string, params: unknown[] = []) {
        const bindings: any[] = [];
        const text = sql.replace(/\$(\d+)/g, (_, index) => { bindings.push(params[Number(index) - 1]); return '?'; });
        return { rows: db.prepare(text).all(...bindings) };
      },
    });
    const result = await income.detectMonthlyIncome({ months: 6, now: new Date('2026-11-10T12:00:00Z') });
    expect(result.months).toHaveLength(6);
    expect(result.monthsWithIncome).toBe(3);
    expect(result.monthly).toBe(22000);
    expect(result.average).toBe(27333);
  });
});
