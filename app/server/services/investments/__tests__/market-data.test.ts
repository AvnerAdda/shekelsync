import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const marketData = require('../market-data.js');

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
      statement.run(...bindings);
      return { rows: [] };
    },
  };
}

const BOI_HEADER = 'SERIES_CODE,FREQ,UNIT_MULT,TIME_PERIOD,OBS_VALUE';

function cbsEntry(year: number, month: number, value: number, baseDesc: string, prevBase: any[] = []) {
  return { year, month, currBase: { baseDesc, value }, prevBase };
}

// Two base changes: 2018 → 2022 (coeff 1.2) and 2022 → 2024 (coeff 1.1).
const CBS_TWO_REBASES = JSON.stringify({
  month: [{
    code: 120010,
    date: [
      cbsEntry(2025, 2, 102, '2024', [{ coeff: 1.1, baseDesc: '2022', value: 112.2 }, { coeff: 1.2, baseDesc: '2018', value: 134.64 }]),
      cbsEntry(2025, 1, 101, '2024', [{ coeff: 1.1, baseDesc: '2022', value: 111.1 }, { coeff: 1.2, baseDesc: '2018', value: 133.32 }]),
      cbsEntry(2024, 12, 110, '2022', [{ coeff: 1.2, baseDesc: '2018', value: 132 }]),
      cbsEntry(2023, 1, 100, '2022', [{ coeff: 1.2, baseDesc: '2018', value: 120 }]),
      cbsEntry(2022, 12, 118, '2018', []),
    ],
  }],
});

function response(body: string, { status = 200, contentType = 'application/json' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    text: async () => body,
  };
}

describe('market data parsers', () => {
  it('chains CBS values across two base changes into the newest base', () => {
    const { points, baseLabel } = marketData.parseCbsIndexJson(CBS_TWO_REBASES);
    expect(baseLabel).toBe('2024');
    const byPeriod = Object.fromEntries(points.map((p: any) => [p.period, p.value]));
    expect(byPeriod['2025-02']).toBeCloseTo(102, 6);
    expect(byPeriod['2024-12']).toBeCloseTo(110 / 1.1, 6);
    expect(byPeriod['2022-12']).toBeCloseTo(118 / 1.32, 6);
    // Ratio across both rebases equals the raw ratio adjusted by both coefficients.
    expect(byPeriod['2025-01'] / byPeriod['2022-12']).toBeCloseTo((101 * 1.32) / 118, 6);
  });

  it('rejects non-JSON CBS payloads', () => {
    expect(() => marketData.parseCbsIndexJson('<html>error</html>')).toThrow(/non-JSON/);
  });

  it('keeps only change points of a carried-forward daily series', () => {
    const { points, lastPeriod } = marketData.compressStepSeries([
      { period: '2026-01-03', value: 4 },
      { period: '2026-01-01', value: 4.25 },
      { period: '2026-01-02', value: 4.25 },
      { period: '2026-01-04', value: 4 },
    ]);
    expect(points).toEqual([{ period: '2026-01-01', value: 4.25 }, { period: '2026-01-03', value: 4 }]);
    expect(lastPeriod).toBe('2026-01-04');
  });
});

describe('syncMarketSeries', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    marketData.__setDatabase(sqliteAdapter(db));
  });

  afterEach(() => {
    marketData.__resetDatabase();
    db.close();
  });

  function fakeFetch(handlers: Record<string, () => any>) {
    const calls: string[] = [];
    const fetchImpl = async (url: URL | string) => {
      const href = String(url);
      calls.push(href);
      for (const [needle, handler] of Object.entries(handlers)) {
        if (href.includes(needle)) return handler();
      }
      return response('not found', { status: 404, contentType: 'text/html' });
    };
    return { fetchImpl, calls };
  }

  it('stores the policy rate as change points with the next decision date', async () => {
    const { fetchImpl, calls } = fakeFetch({
      '/BR/1.0/MNT_RIB_BOI_D': () => response([
        BOI_HEADER,
        'MNT_RIB_BOI_D,D,0,2026-09-01,3.5',
        'MNT_RIB_BOI_D,D,0,2026-09-02,3.5',
        'MNT_RIB_BOI_D,D,0,2026-09-03,3.25',
        'MNT_RIB_BOI_D,D,0,2026-09-04,3.25',
      ].join('\n'), { contentType: 'text/csv' }),
      GetInterest: () => response(JSON.stringify({ currentInterest: 3.25, nextInterestDate: '2026-11-23T00:00:00Z' })),
    });
    const result = await marketData.syncMarketSeries({ keys: ['boi.policy_rate'] }, { fetchImpl, now: '2026-11-01T10:00:00Z' });
    expect(result.imported).toEqual({ 'boi.policy_rate': 2 });
    expect(calls[0]).toContain('startPeriod=2000-01-01');
    const snapshot = await marketData.getMarketSnapshot({ now: new Date('2026-11-01T12:00:00Z') });
    expect(snapshot.policyRate).toEqual({ value: 3.25, since: '2026-09-03' });
    expect(snapshot.prime.value).toBeCloseTo(4.75, 6);
    expect(snapshot.nextDecisionDate).toBe('2026-11-23');
    expect(snapshot.series['boi.policy_rate'].stale).toBe(false);
    // After the next decision date the series is stale again.
    const later = await marketData.getMarketSnapshot({ now: new Date('2026-11-24T12:00:00Z') });
    expect(later.series['boi.policy_rate'].stale).toBe(true);
  });

  it('isolates failures: an HTML page from CBS is rejected without touching cached data', async () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS market_series (series_key TEXT PRIMARY KEY, source TEXT NOT NULL, frequency TEXT NOT NULL, unit TEXT, description TEXT, last_synced_at TEXT, last_observation_period TEXT, last_error TEXT, meta_json TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS market_series_points (series_key TEXT NOT NULL, period TEXT NOT NULL, value REAL NOT NULL, raw_value REAL, base_label TEXT, PRIMARY KEY (series_key, period));
      INSERT INTO market_series (series_key, source, frequency, last_synced_at) VALUES ('cbs.cpi', 'cbs', 'M', '2026-01-01T00:00:00Z');
      INSERT INTO market_series_points (series_key, period, value) VALUES ('cbs.cpi', '2025-12', 100);
    `);
    const { fetchImpl } = fakeFetch({
      'id=120010': () => response('<!DOCTYPE html><html>maintenance</html>', { contentType: 'text/html' }),
      'BIR_MRTG_99': () => response([
        BOI_HEADER,
        'BNK_99034_LR_BIR_MRTG_467,M,0,2026-08,4.62',
      ].join('\n'), { contentType: 'text/csv' }),
    });
    const result = await marketData.syncMarketSeries(
      { keys: ['cbs.cpi', 'boi.mrtg.fixed_unlinked'], force: true },
      { fetchImpl, now: '2026-11-01T10:00:00Z' },
    );
    expect(result.imported).toEqual({ 'boi.mrtg.fixed_unlinked': 1 });
    expect(result.failed).toEqual([expect.objectContaining({ key: 'cbs.cpi', status: 502 })]);
    expect(await marketData.getSeriesPoints('cbs.cpi')).toEqual([{ period: '2025-12', value: 100 }]);
    const cpi = await marketData.getSeries('cbs.cpi');
    expect(cpi.lastError).toMatch(/HTML/);
  });

  it('chains CPI, skips fresh series and feeds rate paths', async () => {
    const { fetchImpl, calls } = fakeFetch({
      'id=120010': () => response(CBS_TWO_REBASES),
    });
    let cleared = 0;
    const invalidateCaches = () => { cleared += 1; };
    await marketData.syncMarketSeries({ keys: ['cbs.cpi'] }, { fetchImpl, now: '2026-11-01T10:00:00Z', invalidateCaches });
    // New points change mortgage payments in cached forecasts.
    expect(cleared).toBe(1);
    const second = await marketData.syncMarketSeries({ keys: ['cbs.cpi'] }, { fetchImpl, now: '2026-11-02T10:00:00Z', invalidateCaches });
    expect(second.skipped).toEqual(['cbs.cpi']);
    expect(cleared).toBe(1);
    expect(calls).toHaveLength(1);
    const series = await marketData.loadRatePathSeries();
    expect(series.cpi.at(-1)).toEqual({ period: '2025-02', value: 102 });
    expect(series.policyRate).toEqual([]);
  });

  it('rejects unknown series keys', async () => {
    await expect(marketData.syncMarketSeries({ keys: ['nope'] }, { fetchImpl: async () => response('') }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('only falls back to a short range on HTTP 500 and keeps older cached history', async () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS market_series (series_key TEXT PRIMARY KEY, source TEXT NOT NULL, frequency TEXT NOT NULL, unit TEXT, description TEXT, last_synced_at TEXT, last_observation_period TEXT, last_error TEXT, meta_json TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS market_series_points (series_key TEXT NOT NULL, period TEXT NOT NULL, value REAL NOT NULL, raw_value REAL, base_label TEXT, PRIMARY KEY (series_key, period));
      INSERT INTO market_series (series_key, source, frequency) VALUES ('cbs.cpi', 'cbs', 'M');
      INSERT INTO market_series_points (series_key, period, value) VALUES ('cbs.cpi', '2010-01', 80);
    `);
    // 503 on the full request: no short-range retry, cached history untouched.
    let calls: string[] = [];
    const unavailable = async (url: URL | string) => {
      calls.push(String(url));
      return response('busy', { status: 503, contentType: 'text/plain' });
    };
    const failed = await marketData.syncMarketSeries({ keys: ['cbs.cpi'], force: true }, { fetchImpl: unavailable, now: '2026-11-01T10:00:00Z' });
    expect(failed.failed[0].key).toBe('cbs.cpi');
    expect(calls).toHaveLength(1);
    expect(await marketData.getSeriesPoints('cbs.cpi')).toEqual([{ period: '2010-01', value: 80 }]);

    // 500 on the full request: short range is fetched and merged.
    calls = [];
    const shortOnly = async (url: URL | string) => {
      calls.push(String(url));
      return String(url).includes('last=60')
        ? response(CBS_TWO_REBASES)
        : response('{"Message":"Error: Price Data"}', { status: 500 });
    };
    await marketData.syncMarketSeries({ keys: ['cbs.cpi'], force: true }, { fetchImpl: shortOnly, now: '2026-11-01T10:00:00Z' });
    expect(calls).toHaveLength(2);
    const points = await marketData.getSeriesPoints('cbs.cpi');
    expect(points[0]).toEqual({ period: '2010-01', value: 80 });
    expect(points.at(-1)).toEqual({ period: '2025-02', value: 102 });
  });
});
