import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = require('../store.js');

function sqliteAdapter(db: DatabaseSync) {
  return {
    async query(sql: string, params: unknown[] = []) {
      const bindings: any[] = [];
      const sqliteSql = sql.replace(/\$(\d+)/g, (_, index) => {
        bindings.push(params[Number(index) - 1] ?? null);
        return '?';
      });
      const statement = db.prepare(sqliteSql);
      if (/^\s*(SELECT|WITH)/i.test(sqliteSql) || /RETURNING/i.test(sqliteSql)) {
        return { rows: statement.all(...bindings) };
      }
      const info = statement.run(...bindings);
      return { rows: [], rowCount: Number(info.changes) };
    },
  };
}

const payload = {
  lender: 'Bank',
  approvedAmount: 2047500,
  options: { brokenPeriodInterest: 'monthly' },
  tracks: [
    {
      type: 'variable_cpi', rate: 2.63, margin: 0.97, rateConvention: 'effective', termMonths: 360,
      firstPaymentDate: '2026-10-10',
      tranches: [{ drawDate: '2026-09-10', amount: 117500 }, { drawDate: '2026-12-10', amount: 58750, status: 'planned' }],
    },
    {
      type: 'prime', margin: -0.75, termMonths: 360, firstPaymentDate: '2026-10-10',
      tranches: [{ drawDate: '2026-09-10', amount: 500000 }],
    },
  ],
  events: [{ type: 'prepay_partial', trackIndex: 1, date: '2027-06-01', amount: 50000, mode: 'reduce_term' }],
};

describe('mortgage store', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE investment_accounts (id INTEGER PRIMARY KEY, account_name TEXT)');
    db.exec("INSERT INTO investment_accounts VALUES (7, 'Apartment')");
    store.__setDatabase(sqliteAdapter(db));
  });

  afterEach(() => {
    store.__resetDatabase();
    db.close();
  });

  it('round-trips a multi-track loan with drawdowns and events', async () => {
    const saved = await store.replaceMortgageForAccount(7, payload);
    expect(saved.accountId).toBe(7);
    expect(saved.tracks).toHaveLength(2);
    expect(saved.tracks[0]).toMatchObject({ type: 'variable_cpi', resetPeriodMonths: 60, rateConvention: 'effective' });
    expect(saved.tracks[0].tranches.map((t: any) => t.status)).toEqual(['drawn', 'planned']);
    expect(saved.events[0]).toMatchObject({ type: 'prepay_partial', trackIndex: 1, mode: 'reduce_term', amount: 50000 });

    const engineInput = store.toEngineInput(saved);
    expect(engineInput.events[0].trackId).toBe(engineInput.tracks[1].id);
  });

  it('replaces the previous structure instead of appending', async () => {
    await store.replaceMortgageForAccount(7, payload);
    await store.replaceMortgageForAccount(7, { ...payload, tracks: [payload.tracks[1]], events: [] });
    const saved = await store.getMortgageForAccount(7);
    expect(saved.tracks).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM mortgage_track_drawdowns').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM mortgage_events').get()).toEqual({ n: 0 });
    await store.deleteMortgageForAccount(7);
    expect(await store.getMortgageForAccount(7)).toBeNull();
  });

  it('validates track requirements', () => {
    const bad = (track: any) => () => store.normalizeMortgagePayload({ tracks: [track] });
    const tranches = [{ drawDate: '2026-01-01', amount: 1000 }];
    expect(bad({ type: 'prime', termMonths: 12, tranches })).toThrow(/margin is required/);
    expect(bad({ type: 'fixed_unlinked', termMonths: 12, tranches })).toThrow(/rate is required/);
    expect(bad({ type: 'fixed_unlinked', rate: 4, termMonths: 12, tranches: [] })).toThrow(/at least one drawdown/);
    expect(bad({ type: 'nope', termMonths: 12, tranches })).toThrow(/supported track type/);
    expect(bad({ type: 'fixed_unlinked', rate: 4, termMonths: 12, tranches, grace: { type: 'partial' } })).toThrow(/grace.endDate/);
    expect(() => store.normalizeMortgagePayload({ approvedAmount: 500, tracks: [{ type: 'fixed_unlinked', rate: 4, termMonths: 12, tranches }] }))
      .toThrow(/exceed the approved/);
    expect(() => store.normalizeMortgagePayload({ tracks: [{ type: 'fixed_unlinked', rate: 4, termMonths: 12, tranches }], events: [{ type: 'prepay_partial', date: '2026-02-01', trackIndex: 3, amount: 1 }] }))
      .toThrow(/does not match a track/);
  });
});
