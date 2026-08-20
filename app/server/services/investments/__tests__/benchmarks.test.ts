import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();
const getClientMock = vi.fn();

let service: any;

const sqlText = (value: unknown) => String(value).replace(/\s+/g, ' ').trim();

const benchmarkRow = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  name: 'TA-125 Total Return',
  currency: 'ILS',
  is_total_return: 1,
  source: 'manual CSV',
  source_version: '2026-08',
  is_default: 1,
  created_at: '2026-08-12T10:00:00Z',
  updated_at: '2026-08-12T10:00:00Z',
  ...overrides,
});

beforeEach(async () => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  releaseMock.mockReset();
  getClientMock.mockReset();
  getClientMock.mockResolvedValue({
    query: (...args: any[]) => clientQueryMock(...args),
    release: (...args: any[]) => releaseMock(...args),
  });

  const module = await import('../benchmarks.js');
  service = module.default ?? module;
  service.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
    getClient: (...args: any[]) => getClientMock(...args),
  });
});

afterEach(() => {
  service.__resetDatabase();
});

describe('investment benchmarks service', () => {
  it.each([
    [
      { source: 'manual', points: [{ date: '2026-01-01', value: 100 }, { date: '2026-02-01', value: 101 }] },
      /name is required/i,
    ],
    [
      { name: 'Index', points: [{ date: '2026-01-01', value: 100 }, { date: '2026-02-01', value: 101 }] },
      /source is required/i,
    ],
    [
      { name: 'Index', source: 'manual', currency: 'IL', points: [{ date: '2026-01-01', value: 100 }, { date: '2026-02-01', value: 101 }] },
      /three-letter code/i,
    ],
    [
      { name: 'Index', source: 'manual', points: [{ date: '2026-01-01', value: 100 }] },
      /at least two dated points/i,
    ],
    [
      { name: 'Index', source: 'manual', points: [{ date: 'bad-date', value: 100 }, { date: '2026-02-01', value: 101 }] },
      /invalid benchmark date/i,
    ],
    [
      { name: 'Index', source: 'manual', points: [{ date: '2026-01-01', value: 0 }, { date: '2026-02-01', value: 101 }] },
      /greater than zero/i,
    ],
    [
      { name: 'Index', source: 'manual', isTotalReturn: 'maybe', points: [{ date: '2026-01-01', value: 100 }, { date: '2026-02-01', value: 101 }] },
      /isTotalReturn must be true or false/i,
    ],
  ])('rejects invalid import payload %#', async (payload, message) => {
    await expect(service.importBenchmark(payload)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(message),
    });
    expect(getClientMock).not.toHaveBeenCalled();
  });

  it('requires two distinct dates after duplicate observations are resolved', async () => {
    await expect(service.importBenchmark({
      name: 'Index',
      source: 'manual',
      points: [
        { date: '2026-01-01', value: 100 },
        { date: '2026-01-01', value: 101 },
      ],
    })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/at least two dated points/i),
    });
    expect(getClientMock).not.toHaveBeenCalled();
  });

  it('imports a normalized total-return series transactionally and keeps the last duplicate value', async () => {
    clientQueryMock.mockImplementation((sql: string) => {
      if (sqlText(sql).startsWith('INSERT INTO investment_benchmarks')) {
        return Promise.resolve({ rows: [benchmarkRow()] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const result = await service.importBenchmark({
      name: '  TA-125 Total Return  ',
      currency: 'ils',
      isTotalReturn: true,
      source: '  manual CSV  ',
      sourceVersion: '  2026-08  ',
      points: [
        { date: '2026-02-01', value: 105 },
        { date: '2026-01-01', value: 100 },
        { date: '2026-02-01', value: 106 },
      ],
    });

    expect(result.benchmark).toMatchObject({
      id: 7,
      name: 'TA-125 Total Return',
      currency: 'ILS',
      isTotalReturn: true,
      source: 'manual CSV',
      sourceVersion: '2026-08',
      isDefault: true,
      points: [
        { date: '2026-01-01', value: 100 },
        { date: '2026-02-01', value: 106 },
      ],
    });
    expect(clientQueryMock.mock.calls.map(([sql]) => sqlText(sql))).toEqual([
      'BEGIN',
      'UPDATE investment_benchmarks SET is_default = 0 WHERE is_default = 1',
      expect.stringContaining('INSERT INTO investment_benchmarks'),
      expect.stringContaining('INSERT INTO investment_benchmark_points'),
      expect.stringContaining('INSERT INTO investment_benchmark_points'),
      'COMMIT',
    ]);
    expect(clientQueryMock.mock.calls[2][1]).toEqual([
      'TA-125 Total Return',
      'ILS',
      1,
      'manual CSV',
      '2026-08',
      1,
    ]);
    expect(clientQueryMock.mock.calls[3][1]).toEqual([7, '2026-01-01', 100]);
    expect(clientQueryMock.mock.calls[4][1]).toEqual([7, '2026-02-01', 106]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rolls back and releases the transaction client when a point insert fails', async () => {
    const insertError = new Error('point write failed');
    clientQueryMock.mockImplementation((sql: string, params?: unknown[]) => {
      const text = sqlText(sql);
      if (text.startsWith('INSERT INTO investment_benchmarks')) {
        return Promise.resolve({ rows: [benchmarkRow()] });
      }
      if (text.startsWith('INSERT INTO investment_benchmark_points') && params?.[1] === '2026-02-01') {
        return Promise.reject(insertError);
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await expect(service.importBenchmark({
      name: 'Index',
      source: 'manual',
      points: [
        { date: '2026-01-01', value: 100 },
        { date: '2026-02-01', value: 101 },
      ],
    })).rejects.toBe(insertError);

    const statements = clientQueryMock.mock.calls.map(([sql]) => sqlText(sql));
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('does not treat string false flags as total-return or default labels', async () => {
    clientQueryMock.mockImplementation((sql: string) => {
      if (sqlText(sql).startsWith('INSERT INTO investment_benchmarks')) {
        return Promise.resolve({
          rows: [benchmarkRow({
            name: 'Price Index',
            is_total_return: 0,
            is_default: 0,
            source_version: 'v1',
          })],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const result = await service.importBenchmark({
      name: 'Price Index',
      source: 'manual',
      source_version: 'v1',
      is_total_return: 'false',
      is_default: 'false',
      points: [
        { date: '2026-01-01', value: 100 },
        { date: '2026-02-01', value: 101 },
      ],
    });

    expect(result.benchmark).toMatchObject({
      isTotalReturn: false,
      isDefault: false,
      sourceVersion: 'v1',
    });
    const statements = clientQueryMock.mock.calls.map(([sql]) => sqlText(sql));
    expect(statements).not.toContain(
      'UPDATE investment_benchmarks SET is_default = 0 WHERE is_default = 1',
    );
    expect(clientQueryMock.mock.calls[1][1]).toEqual([
      'Price Index',
      'ILS',
      0,
      'manual',
      'v1',
      0,
    ]);
  });

  it('lists price-return and total-return benchmarks with optional points', async () => {
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      const text = sqlText(sql);
      if (text.startsWith('SELECT * FROM investment_benchmarks')) {
        return Promise.resolve({
          rows: [
            benchmarkRow(),
            benchmarkRow({ id: 8, name: 'S&P 500 Price', currency: 'USD', is_total_return: 0, is_default: 0 }),
          ],
        });
      }
      if (text.includes('FROM investment_benchmark_points')) {
        return Promise.resolve({
          rows: params?.[0] === 7
            ? [{ date: '2026-01-01', value: '100' }, { date: '2026-02-01', value: '110' }]
            : [{ date: '2026-01-01', value: '200' }, { date: '2026-02-01', value: '205' }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await service.listBenchmarks({ includePoints: 'true' });

    expect(result.benchmarks).toHaveLength(2);
    expect(result.benchmarks[0]).toMatchObject({
      id: 7,
      isTotalReturn: true,
      points: [{ date: '2026-01-01', value: 100 }, { date: '2026-02-01', value: 110 }],
    });
    expect(result.benchmarks[1]).toMatchObject({ id: 8, isTotalReturn: false });
  });

  it('compares only overlapping observations and preserves the total-return classification', async () => {
    queryMock.mockImplementation((sql: string) => {
      const text = sqlText(sql);
      if (text.startsWith('SELECT * FROM investment_benchmarks')) {
        return Promise.resolve({ rows: [benchmarkRow()] });
      }
      if (text.includes('FROM investment_benchmark_points')) {
        return Promise.resolve({
          rows: [
            { date: '2025-12-31', value: '100' },
            { date: '2026-01-31', value: '110' },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await service.getBenchmarkComparison({
      startDate: '2026-01-01T12:00:00Z',
      endDate: '2026-02-01T12:00:00Z',
      benchmarkId: 7,
    });

    expect(result).toMatchObject({
      status: 'ok',
      reason: null,
      startDate: '2026-01-01',
      endDate: '2026-02-01',
      startObservationDate: '2025-12-31',
      endObservationDate: '2026-01-31',
      benchmark: { id: 7, isTotalReturn: true },
    });
    expect(result.return).toBeCloseTo(0.1, 12);
    expect(queryMock.mock.calls[0][1]).toEqual([7]);
    expect(queryMock.mock.calls[1][1]).toEqual([7, '2026-02-01']);
  });

  it('converts both benchmark boundaries before comparing with a base-currency portfolio', async () => {
    queryMock.mockImplementation((sql: string) => {
      const text = sqlText(sql);
      if (text.startsWith('SELECT * FROM investment_benchmarks')) {
        return Promise.resolve({ rows: [benchmarkRow({ currency: 'USD' })] });
      }
      return Promise.resolve({
        rows: [
          { date: '2025-12-31', value: 100 },
          { date: '2026-01-31', value: 110 },
        ],
      });
    });
    const convertAmount = vi.fn(async ({ amount, date }: { amount: number; date: string }) => ({
      amount,
      baseAmount: amount * (date === '2025-12-31' ? 3.5 : 3.4),
      complete: true,
      status: 'exact',
    }));
    service.__setFxService({ convertAmount });

    const result = await service.getBenchmarkComparison({
      startDate: '2026-01-01',
      endDate: '2026-02-01',
      baseCurrency: 'ILS',
    });

    expect(result).toMatchObject({
      status: 'ok',
      returnCurrency: 'ILS',
      currencyAdjusted: true,
      fx: { complete: true, baseCurrency: 'ILS' },
    });
    expect(result.nativeReturn).toBeCloseTo(0.1, 12);
    expect(result.return).toBeCloseTo((110 * 3.4) / (100 * 3.5) - 1, 12);
    expect(convertAmount).toHaveBeenCalledTimes(2);
    expect(convertAmount).toHaveBeenNthCalledWith(1, {
      amount: 100,
      currency: 'USD',
      baseCurrency: 'ILS',
      date: '2025-12-31',
    });
    expect(convertAmount).toHaveBeenNthCalledWith(2, {
      amount: 110,
      currency: 'USD',
      baseCurrency: 'ILS',
      date: '2026-01-31',
    });
  });

  it('reports insufficient benchmark overlap instead of fabricating a return', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sqlText(sql).startsWith('SELECT * FROM investment_benchmarks')) {
        return Promise.resolve({ rows: [benchmarkRow()] });
      }
      return Promise.resolve({ rows: [{ date: '2026-01-05', value: 100 }] });
    });

    await expect(service.getBenchmarkComparison({
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    })).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'insufficient_overlapping_points',
      benchmark: { id: 7, isTotalReturn: true },
    });
  });

  it('rejects malformed comparison boundaries and benchmark ids before querying', async () => {
    await expect(service.getBenchmarkComparison({
      startDate: 'not-a-date',
      endDate: '2026-02-01',
    })).rejects.toMatchObject({ status: 400 });
    await expect(service.getBenchmarkComparison({
      startDate: '2026-02-02',
      endDate: '2026-02-01',
    })).rejects.toMatchObject({ status: 400 });
    await expect(service.getBenchmarkComparison({
      startDate: '2026-01-01',
      endDate: '2026-02-01',
      benchmarkId: 'bad',
    })).rejects.toMatchObject({ status: 400 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('removes a benchmark and returns a not-found error for an unknown id', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [benchmarkRow()] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(service.removeBenchmark({ benchmark_id: 7 })).resolves.toMatchObject({
      removed: { id: 7, isTotalReturn: true },
    });
    expect(queryMock.mock.calls[0][1]).toEqual([7]);

    await expect(service.removeBenchmark({ id: 99 })).rejects.toMatchObject({
      status: 404,
      message: 'Benchmark not found',
    });
  });
});
