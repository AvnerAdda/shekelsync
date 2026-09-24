import { DatabaseSync } from 'node:sqlite';
import { addDays, subDays } from 'date-fns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = require('../database.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');
const { getHealthScoreHistory } = require('../analytics/health-score-history.js');
const {
  computeEnhancedHealthScore,
  prepareEnhancedHealthScoreHistory,
} = require('../analytics/health-score-enhanced.js');

type Transaction = {
  identifier: string;
  vendor: string;
  date: string;
  price: number;
  categoryId: number | null;
};

const categories = [
  { id: 1, name: 'Salary', type: 'income', parentId: null, counted: 1 },
  { id: 2, name: 'Capital', type: 'income', parentId: null, counted: 0 },
  { id: 3, name: 'Food', type: 'expense', parentId: null, counted: null },
  { id: 4, name: 'Groceries', type: 'expense', parentId: 3, counted: null },
  { id: 5, name: 'Travel', type: 'expense', parentId: null, counted: 1 },
  { id: 6, name: 'Bus', type: 'expense', parentId: 5, counted: null },
  { id: 7, name: 'Housing', type: 'expense', parentId: null, counted: 1 },
  { id: 8, name: 'Rent', type: 'expense', parentId: 7, counted: 1 },
  { id: 9, name: BANK_CATEGORY_NAME, type: 'expense', parentId: null, counted: 0 },
  { id: 10, name: 'Bank child', type: 'expense', parentId: 9, counted: 1 },
  { id: 11, name: 'Investments', type: 'investment', parentId: null, counted: 1 },
  { id: 12, name: 'Unknown type', type: null, parentId: null, counted: 0 },
  { id: 13, name: 'Default-counted income', type: 'income', parentId: null, counted: null },
];

const iso = (date: Date) => date.toISOString().slice(0, 10);
let db: DatabaseSync;
let transactions: Transaction[];
let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

function insert(date: string, price: number, categoryId: number | null, identifier?: string, vendor = 'card') {
  const transaction = { date, price, categoryId, identifier: identifier || `txn-${transactions.length}`, vendor };
  transactions.push(transaction);
  db.prepare('INSERT INTO transactions VALUES (?, ?, ?, ?, ?)')
    .run(transaction.identifier, vendor, date, price, categoryId);
}

function balanceFlow(transaction: Transaction) {
  // Historical balances deliberately use the original history rules: pairing
  // exclusions and the income-counting flag affect scores, not these balances.
  const category = categories.find((candidate) => candidate.id === transaction.categoryId);
  const parent = categories.find((candidate) => candidate.id === category?.parentId);
  if (transaction.price > 0 && (!category?.type || category.type === 'income')) {
    return transaction.price;
  }
  if (transaction.price < 0 && (!category?.type || category.type === 'expense') &&
    category?.name !== BANK_CATEGORY_NAME && parent?.name !== BANK_CATEGORY_NAME) {
    return transaction.price;
  }
  return 0;
}

function seedHistory(endDate: Date) {
  // Enough warm-up data for the largest permitted history and scoring windows.
  for (let index = -260; index <= 1; index += 1) {
    const date = iso(addDays(endDate, index));
    if (index % 30 === 0) insert(date, 4_100.13, 1);
    if (index % 9 === 0) continue; // Empty days must still produce history points.
    insert(date, -(17 + Math.abs(index) % 10 + 0.19), 4);
    insert(date, -(55 + Math.abs(index) % 17 + 0.37), 6);
    if (index % 7 === 0) insert(date, -433.71, 8);
    if (index % 17 === 0) insert(date, -11.21, null);
  }

  const middle = iso(subDays(endDate, 20));
  insert(middle, 8_000, 2); // Non-counted income still contributes to balance.
  insert(middle, 700, 9); // Positive Bank amounts count as score income.
  insert(middle, -9_000, 9);
  insert(middle, -8_000, 10);
  insert(middle, -7_000, 11);
  insert(middle, 120, 4); // Expense refund is neither income nor an expense.
  insert(middle, -130, 1); // Negative income does not count as an expense.
  insert(middle, 240, 12);
  insert(middle, -25.13, 12);
  insert(middle, 135, 13);
  insert(middle, 123, null);
  insert(middle, -321, 999); // Missing category definition.
  insert(middle, -5_000, 4, 'excluded');
  insert(middle, 3_000, 1, 'excluded-income');
  insert(middle, -40.37, 6, 'excluded', 'other-card');
  db.exec(`INSERT INTO transaction_pairing_exclusions VALUES
    ('excluded', 'card'), ('excluded', 'card'), ('excluded-income', 'card')`);

  // Raw SQL TEXT date comparisons must be retained, including the upper bound
  // excluding timestamps later on its date and SQLite's month normalization.
  insert(`${iso(endDate)}T00:00:00Z`, -99_999, 4);
  insert(`${middle}T23:50:00+02:00`, -127.31, 8);
  insert('2024-03-01T00:15:00+02:00', -61.13, 6); // SQLite groups this in February.
  insert('2024-02-29', -83.17, 4);
  insert('2023-12-31', 1_017.19, 1);
}

async function legacyPoints(endDate: Date, historyDays: number, windowDays: number) {
  const start = subDays(endDate, historyDays - 1);
  const startIso = iso(start);
  let balance = transactions.filter((transaction) => transaction.date < startIso)
    .reduce((total, transaction) => total + balanceFlow(transaction), 0);
  const points = [];
  for (let index = 0; index < historyDays; index += 1) {
    const pointDate = addDays(start, index);
    const pointIso = iso(pointDate);
    balance += transactions.filter((transaction) => transaction.date === pointIso)
      .reduce((total, transaction) => total + balanceFlow(transaction), 0);
    const score = await computeEnhancedHealthScore({
      months: Math.max(1, Math.round(windowDays / 30)),
      startDate: subDays(pointDate, windowDays - 1),
      endDate: pointDate,
      currentBalance: balance,
      client,
    });
    points.push({ date: pointIso, overallHealthScore: score.overallScore, breakdown: score.breakdown });
  }
  return points;
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE category_definitions (
      id INTEGER PRIMARY KEY, name TEXT, category_type TEXT, parent_id INTEGER, is_counted_as_income INTEGER
    );
    CREATE TABLE transactions (
      identifier TEXT, vendor TEXT, date TEXT, price REAL, category_definition_id INTEGER
    );
    CREATE TABLE transaction_pairing_exclusions (transaction_identifier TEXT, transaction_vendor TEXT);
  `);
  const addCategory = db.prepare('INSERT INTO category_definitions VALUES (?, ?, ?, ?, ?)');
  for (const category of categories) {
    addCategory.run(category.id, category.name, category.type, category.parentId, category.counted);
  }
  transactions = [];
  client = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      const parameters: any[] = [];
      const preparedSql = sql.replace(/\$(\d+)/g, (_match, index) => {
        parameters.push(values[Number(index) - 1]);
        return '?';
      });
      return { rows: db.prepare(preparedSql).all(...parameters) };
    }),
    release: vi.fn(),
  };
  vi.spyOn(database, 'getClient').mockResolvedValue(client);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2024-04-05T10:30:00Z'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  db.close();
});

describe('health-score-history bulk calculation', () => {
  it.each([
    [7, 7], [60, 60], [120, 31], [7, 120], [120, 120],
  ])('matches per-day SQL for %i history days and a %i-day window using four queries', async (days, windowDays) => {
    const endDate = new Date();
    seedHistory(endDate);
    const expected = await legacyPoints(endDate, days, windowDays);
    expect(client.query).toHaveBeenCalledTimes(days * 2);
    client.query.mockClear();

    const result = await getHealthScoreHistory({ days, windowDays });

    expect(result.points).toEqual(expected);
    expect(result).toMatchObject({
      historyDays: days, windowDays,
      startDate: iso(subDays(endDate, days - 1)), endDate: iso(endDate),
    });
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(client.release).toHaveBeenCalledOnce();
    expect(result.points[0].date).toBe(result.startDate);
    expect(result.points.at(-1).date).toBe(result.endDate);
  });

  it('retains zero-flow months and exact date boundaries in prepared window scores', async () => {
    insert('2023-12-31', 50_000, 1);
    insert('2024-01-01', 4_000, 1);
    insert('2024-01-31', -100, 4);
    insert('2024-02-10', -50_000, 11); // February exists despite zero cash flow.
    insert('2024-03-01', 4_000, 1);
    insert('2024-03-01T00:15:00+02:00', -30, 6);
    insert('2024-03-05', -900, 8);
    insert('2024-03-31', -200, 4);
    insert('2024-03-31T00:00:00Z', -90_000, 4);
    const scoreWindow = await prepareEnhancedHealthScoreHistory({
      startDate: '2023-12-31', endDate: '2024-04-01', client,
    });
    expect(client.query).toHaveBeenCalledTimes(2);

    // Out-of-order requests also work: the prepared data has no advancing cursor.
    for (const [startDate, endDate] of [
      ['2024-01-01', '2024-03-31'],
      ['2023-12-31', '2024-03-05'],
      ['2024-02-01', '2024-02-29'],
      ['2024-03-01', '2024-03-01'],
      ['2024-03-01', '2024-04-01'],
    ]) {
      const params = { months: 3, startDate, endDate, currentBalance: 3_000 };
      const expected = await computeEnhancedHealthScore({ ...params, client });
      expect(scoreWindow(params)).toEqual(expected);
    }
  });

  it('returns the same empty history and refreshes data on each request', async () => {
    const endDate = new Date();
    const expected = await legacyPoints(endDate, 7, 7);
    const empty = await getHealthScoreHistory({ days: 7, windowDays: 7 });
    expect(empty.points).toEqual(expected);
    expect(empty.trend.direction).toBe('flat');
    insert(iso(endDate), 1_000, 1);
    insert(iso(endDate), -300, 4);
    const updated = await getHealthScoreHistory({ days: 7, windowDays: 7 });
    expect(updated.points).toEqual(await legacyPoints(endDate, 7, 7));
    expect(updated.points.at(-1)).not.toEqual(empty.points.at(-1));
  });

  it('releases the client if a bulk query fails', async () => {
    client.query.mockRejectedValueOnce(new Error('query failed'));
    await expect(getHealthScoreHistory()).rejects.toThrow('query failed');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
