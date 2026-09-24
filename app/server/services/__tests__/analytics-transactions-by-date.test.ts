// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = require('../database.js');
const { listTransactionsByDate } = require('../analytics/transactions-by-date.js');

describe('transactions by date or inclusive period', () => {
  let sqlite: DatabaseSync;
  let query: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE transactions (
        identifier TEXT, vendor TEXT, price REAL, name TEXT, date TEXT,
        memo TEXT, tags TEXT, category_definition_id INTEGER
      );
      CREATE TABLE category_definitions (
        id INTEGER PRIMARY KEY, name TEXT, icon TEXT, color TEXT,
        parent_id INTEGER, category_type TEXT
      );
      CREATE TABLE transaction_pairing_exclusions (transaction_identifier TEXT, transaction_vendor TEXT);
      INSERT INTO category_definitions VALUES (1, 'Food', NULL, NULL, NULL, 'expense');
      INSERT INTO category_definitions VALUES (2, 'Groceries', 'cart', '#123456', 1, 'expense');
    `);
    query = vi.spyOn(database, 'query').mockImplementation(async (sql: string, values: string[]) => ({
      rows: sqlite.prepare(sql.replace(/\$\d+/g, '?')).all(...values),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    sqlite.close();
  });

  function insert(identifier: string, date: string, vendor = 'max') {
    sqlite.prepare('INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, 2)')
      .run(identifier, vendor, -12.5, identifier, date, 'Weekly groceries', '["food"]');
  }

  it('returns every row in a week, including the full final day, without a pagination cap', async () => {
    insert('before', '2026-09-20T23:59:59.999Z');
    insert('first', '2026-09-21');
    for (let index = 0; index < 125; index += 1) insert(`middle-${index}`, '2026-09-24T10:00:00.000Z');
    insert('last', '2026-09-27T23:59:59.999Z');
    insert('after', '2026-09-28');
    insert('paired', '2026-09-25', 'max');
    insert('paired', '2026-09-25', 'visaCal');
    sqlite.exec("INSERT INTO transaction_pairing_exclusions VALUES ('paired', 'max')");

    const result = await listTransactionsByDate({ startDate: '2026-09-21', endDate: '2026-09-27' });

    expect(result.transactions).toHaveLength(128);
    expect(result.transactions.find((row: { identifier: string }) => row.identifier === 'first')).toEqual({
      identifier: 'first', vendor: 'max', price: -12.5, description: 'first', date: '2026-09-21',
      memo: 'Weekly groceries', tags: ['food'], categoryType: 'expense', category_name: 'Groceries',
      category_icon: 'cart', category_color: '#123456', parent_name: 'Food',
    });
    expect(result.transactions.some((row: { identifier: string }) => row.identifier === 'last')).toBe(true);
    expect(result.transactions.some((row: { identifier: string }) => ['before', 'after'].includes(row.identifier))).toBe(false);
    expect(result.transactions.filter((row: { identifier: string }) => row.identifier === 'paired'))
      .toEqual([expect.objectContaining({ vendor: 'visaCal' })]);
  });

  it('supports monthly ranges across leap day and retains the single-day ISO date interface', async () => {
    insert('january', '2028-01-31');
    insert('february-start', '2028-02-01');
    insert('leap-day', '2028-02-29T23:30:00.000Z');
    insert('march', '2028-03-01');

    const month = await listTransactionsByDate({ startDate: '2028-02-01', endDate: '2028-02-29' });
    expect(month.transactions.map((row: { identifier: string }) => row.identifier)).toEqual(['february-start', 'leap-day']);
    const day = await listTransactionsByDate({ date: '2028-02-29T12:00:00.000Z' });
    expect(day.transactions).toEqual([expect.objectContaining({ identifier: 'leap-day' })]);
  });

  it.each([
    {},
    { startDate: '2026-09-21' },
    { endDate: '2026-09-27' },
    { startDate: '2026-09-28', endDate: '2026-09-21' },
    { startDate: '', endDate: '2026-09-27' },
    { startDate: '2026-02-29', endDate: '2026-03-01' },
    { startDate: '2026-09-21', endDate: '2026-09-31' },
    { startDate: ['2026-09-21'], endDate: '2026-09-27' },
    { date: 'not-a-date' },
    { date: '2026-02-30' },
    { date: '2026-09-21Tinvalid' },
    { date: ['2026-09-21', '2026-09-22'] },
  ])('rejects invalid or incomplete bounds before querying: %j', async params => {
    await expect(listTransactionsByDate(params)).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('caches each range independently and shares the same-day cache with the date interface', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    insert('monday', '2027-09-20');
    insert('tuesday', '2027-09-21');
    const day = await listTransactionsByDate({ date: '2027-09-20' });
    const week = await listTransactionsByDate({ startDate: '2027-09-20', endDate: '2027-09-26' });
    const sameDay = await listTransactionsByDate({ startDate: '2027-09-20', endDate: '2027-09-20' });
    const sameWeek = await listTransactionsByDate({ startDate: '2027-09-20', endDate: '2027-09-26' });

    expect(day.transactions).toHaveLength(1);
    expect(week.transactions).toHaveLength(2);
    expect(sameDay).toEqual(day);
    expect(sameWeek).toEqual(week);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
