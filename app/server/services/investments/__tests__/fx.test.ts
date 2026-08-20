import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let fxService: any;

beforeEach(async () => {
  queryMock.mockReset();
  const module = await import('../fx.js');
  fxService = module.default ?? module;
  fxService.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
  });
});

afterEach(() => {
  fxService.__resetDatabase();
});

function mockSchemaAndBaseCurrency(baseCurrency = 'ILS') {
  queryMock.mockImplementation((sql: string) => {
    const text = String(sql);
    if (text.includes('SELECT base_currency')) {
      return Promise.resolve({ rows: [{ base_currency: baseCurrency }] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

describe('investment FX service', () => {
  it('creates its local schema and resolves identity conversion with the default base currency', async () => {
    mockSchemaAndBaseCurrency();

    const result = await fxService.convertAmount({
      amount: 125,
      currency: 'ils',
      date: '2026-08-12',
    });

    expect(result).toMatchObject({
      amount: 125,
      currency: 'ILS',
      baseAmount: 125,
      baseCurrency: 'ILS',
      rate: 1,
      rateDate: '2026-08-12',
      status: 'identity',
      complete: true,
    });
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes('CREATE TABLE IF NOT EXISTS investment_fx_rates'))).toBe(true);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes('FROM investment_fx_rates') && String(sql).includes('rate_date <='))).toBe(false);
  });

  it('upserts and lists manual rates with normalized currencies', async () => {
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('INSERT INTO investment_fx_rates')) {
        return Promise.resolve({
          rows: [{
            rate_date: params?.[0],
            from_currency: params?.[1],
            to_currency: params?.[2],
            rate: params?.[3],
            source: params?.[4],
          }],
        });
      }
      if (text.includes('SELECT rate_date') && text.includes('ORDER BY rate_date DESC')) {
        return Promise.resolve({
          rows: [{
            rate_date: '2026-08-11',
            from_currency: 'USD',
            to_currency: 'ILS',
            rate: 3.72,
            source: 'manual',
          }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const inserted = await fxService.upsertRate({
      rateDate: '2026-08-11',
      fromCurrency: 'usd',
      toCurrency: 'ils',
      rate: 3.72,
    });
    const listed = await fxService.listRates({ fromCurrency: 'usd', toCurrency: 'ils' });

    expect(inserted).toEqual({
      rateDate: '2026-08-11',
      fromCurrency: 'USD',
      toCurrency: 'ILS',
      rate: 3.72,
      source: 'manual',
    });
    expect(listed).toEqual([inserted]);
    const insertCall = queryMock.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO investment_fx_rates'));
    expect(insertCall?.[1]).toEqual(['2026-08-11', 'USD', 'ILS', 3.72, 'manual']);
  });

  it('persists a normalized base-currency preference', async () => {
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      if (String(sql).includes('RETURNING base_currency')) {
        return Promise.resolve({ rows: [{ base_currency: params?.[0] }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await expect(fxService.setBaseCurrency('eur')).resolves.toBe('EUR');
    const updateCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('RETURNING base_currency'));
    expect(updateCall?.[1]).toEqual(['EUR']);
  });

  it('uses the latest exact-or-prior rate and never accepts a future row', async () => {
    queryMock.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes('rate_date <= $3')) {
        return Promise.resolve({
          rows: [{
            rate_date: '2026-08-08',
            from_currency: 'USD',
            to_currency: 'ILS',
            rate: 3.7,
            source: 'manual',
          }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const prior = await fxService.getRate({
      fromCurrency: 'USD',
      toCurrency: 'ILS',
      date: '2026-08-10',
    });

    expect(prior).toMatchObject({
      rateDate: '2026-08-08',
      requestedDate: '2026-08-10',
      rate: 3.7,
      ageDays: 2,
      status: 'prior',
    });
    const lookupCall = queryMock.mock.calls.find(([sql]) => String(sql).includes('rate_date <= $3'));
    expect(lookupCall?.[1]).toEqual(['USD', 'ILS', '2026-08-10']);

    const exact = await fxService.getRate({
      fromCurrency: 'USD',
      toCurrency: 'ILS',
      date: '2026-08-08',
    });
    expect(exact).toMatchObject({
      requestedDate: '2026-08-08',
      rateDate: '2026-08-08',
      status: 'exact',
      ageDays: 0,
    });

    queryMock.mockImplementation((sql: string) => {
      if (String(sql).includes('rate_date <= $3')) {
        return Promise.resolve({
          rows: [{
            rate_date: '2026-08-11',
            from_currency: 'USD',
            to_currency: 'ILS',
            rate: 3.8,
            source: 'bad-adapter',
          }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const future = await fxService.getRate({
      fromCurrency: 'USD',
      toCurrency: 'ILS',
      date: '2026-08-10',
    });
    expect(future).toMatchObject({ status: 'missing', rate: null, rateDate: null });
  });

  it('prefers a direct rate over available reciprocal and ILS-cross paths', async () => {
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      if (!String(sql).includes('rate_date <= $3')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      const [fromCurrency, toCurrency] = params || [];
      const rowsByPair: Record<string, Record<string, unknown>> = {
        'USD|EUR': {
          rate_date: '2026-08-12',
          from_currency: 'USD',
          to_currency: 'EUR',
          rate: 0.91,
          source: 'direct manual',
        },
        'EUR|USD': {
          rate_date: '2026-08-12',
          from_currency: 'EUR',
          to_currency: 'USD',
          rate: 1.2,
          source: 'reverse manual',
        },
      };
      const row = rowsByPair[`${fromCurrency}|${toCurrency}`];
      return Promise.resolve({ rows: row ? [row] : [] });
    });

    const result = await fxService.getRate({
      fromCurrency: 'USD',
      toCurrency: 'EUR',
      date: '2026-08-12',
    });

    expect(result).toMatchObject({
      rate: 0.91,
      source: 'direct manual',
      rateDate: '2026-08-12',
      ageDays: 0,
      status: 'exact',
    });
    expect(result.derived).toBeUndefined();
    const rateLookups = queryMock.mock.calls.filter(([sql]) =>
      String(sql).includes('rate_date <= $3'));
    expect(rateLookups).toHaveLength(1);
  });

  it('derives a reciprocal from the latest-prior reverse rate', async () => {
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      if (String(sql).includes('rate_date <= $3')
        && params?.[0] === 'USD'
        && params?.[1] === 'ILS') {
        return Promise.resolve({
          rows: [{
            rate_date: '2026-08-11',
            from_currency: 'USD',
            to_currency: 'ILS',
            rate: 4,
            source: 'Bank of Israel representative rate',
          }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await fxService.convertAmount({
      amount: 400,
      currency: 'ILS',
      baseCurrency: 'USD',
      date: '2026-08-12',
    });

    expect(result).toMatchObject({
      baseAmount: 100,
      rate: 0.25,
      rateDate: '2026-08-11',
      rateAgeDays: 1,
      status: 'prior',
      complete: true,
      derived: true,
      derivation: 'reciprocal',
      rateComponents: [expect.objectContaining({
        fromCurrency: 'USD',
        toCurrency: 'ILS',
        rateDate: '2026-08-11',
      })],
      source: expect.stringMatching(/derived reciprocal.*Bank of Israel/i),
    });
    const rate = await fxService.getRate({
      fromCurrency: 'ILS',
      toCurrency: 'USD',
      date: '2026-08-12',
    });
    expect(rate).toMatchObject({
      derived: true,
      derivation: 'reciprocal',
      components: [{
        fromCurrency: 'USD',
        toCurrency: 'ILS',
        rate: 4,
        rateDate: '2026-08-11',
        ageDays: 1,
        status: 'prior',
      }],
    });
  });

  it('derives a cross through ILS using the oldest component date and weakest status', async () => {
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      if (!String(sql).includes('rate_date <= $3')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      const [fromCurrency, toCurrency] = params || [];
      if (fromCurrency === 'USD' && toCurrency === 'ILS') {
        return Promise.resolve({
          rows: [{
            rate_date: '2026-08-12',
            from_currency: 'USD',
            to_currency: 'ILS',
            rate: 3.6,
            source: 'BOI USD',
          }],
        });
      }
      if (fromCurrency === 'EUR' && toCurrency === 'ILS') {
        return Promise.resolve({
          rows: [{
            rate_date: '2026-08-10',
            from_currency: 'EUR',
            to_currency: 'ILS',
            rate: 4.5,
            source: 'BOI EUR',
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fxService.getRate({
      fromCurrency: 'USD',
      toCurrency: 'EUR',
      date: '2026-08-12',
    });

    expect(result).toMatchObject({
      rate: 0.8,
      rateDate: '2026-08-10',
      ageDays: 2,
      status: 'prior',
      derived: true,
      derivation: 'ils_cross',
      source: expect.stringMatching(/derived via ILS.*BOI USD.*BOI EUR/i),
    });
    expect(result.components).toEqual([
      expect.objectContaining({
        fromCurrency: 'USD',
        toCurrency: 'ILS',
        rateDate: '2026-08-12',
        ageDays: 0,
        status: 'exact',
      }),
      expect.objectContaining({
        fromCurrency: 'EUR',
        toCurrency: 'ILS',
        rateDate: '2026-08-10',
        ageDays: 2,
        status: 'prior',
      }),
    ]);
    const rateLookups = queryMock.mock.calls.filter(([sql]) =>
      String(sql).includes('rate_date <= $3'));
    expect(rateLookups).toHaveLength(4);
    expect(rateLookups.every(([, params]) => params?.[2] === '2026-08-12')).toBe(true);

    await expect(fxService.getRate({
      fromCurrency: 'USD',
      toCurrency: 'EUR',
      date: '2026-08-30',
    })).resolves.toMatchObject({
      rateDate: '2026-08-10',
      ageDays: 20,
      status: 'stale',
      derivation: 'ils_cross',
    });
    await expect(fxService.getRate({
      fromCurrency: 'USD',
      toCurrency: 'EUR',
      date: '2026-08-30',
      maxAgeDays: 30,
    })).resolves.toMatchObject({
      rateDate: '2026-08-10',
      ageDays: 20,
      status: 'prior',
      derivation: 'ils_cross',
    });
  });

  it('marks a cross exact only when every stored leg is exact', async () => {
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      if (!String(sql).includes('rate_date <= $3')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      const [fromCurrency, toCurrency] = params || [];
      const rates: Record<string, number> = { USD: 3.6, EUR: 4.5 };
      if (toCurrency === 'ILS' && rates[String(fromCurrency)]) {
        return Promise.resolve({
          rows: [{
            rate_date: '2026-08-12',
            from_currency: fromCurrency,
            to_currency: 'ILS',
            rate: rates[String(fromCurrency)],
            source: `BOI ${fromCurrency}`,
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(fxService.getRate({
      fromCurrency: 'USD',
      toCurrency: 'EUR',
      date: '2026-08-12',
    })).resolves.toMatchObject({
      rate: 0.8,
      rateDate: '2026-08-12',
      ageDays: 0,
      status: 'exact',
      derivation: 'ils_cross',
    });
  });

  it('never uses a future component to construct an ILS cross', async () => {
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      if (!String(sql).includes('rate_date <= $3')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      const [fromCurrency, toCurrency] = params || [];
      if (fromCurrency === 'USD' && toCurrency === 'ILS') {
        return Promise.resolve({
          rows: [{
            rate_date: '2026-08-13',
            from_currency: 'USD',
            to_currency: 'ILS',
            rate: 3.6,
            source: 'future adapter row',
          }],
        });
      }
      if (fromCurrency === 'EUR' && toCurrency === 'ILS') {
        return Promise.resolve({
          rows: [{
            rate_date: '2026-08-12',
            from_currency: 'EUR',
            to_currency: 'ILS',
            rate: 4.5,
            source: 'BOI EUR',
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(fxService.getRate({
      fromCurrency: 'USD',
      toCurrency: 'EUR',
      date: '2026-08-12',
    })).resolves.toMatchObject({
      rate: null,
      rateDate: null,
      status: 'missing',
    });
  });

  it('keeps native totals and refuses to publish a mixed-currency base total when a rate is missing', async () => {
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('rate_date <= $3') && params?.[0] === 'USD') {
        return Promise.resolve({
          rows: [{
            rate_date: '2026-08-10',
            from_currency: 'USD',
            to_currency: 'ILS',
            rate: 3.7,
            source: 'manual',
          }],
        });
      }
      if (text.includes('rate_date <= $3') && params?.[0] === 'EUR') {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await fxService.summarizeAmounts([
      { amount: 100, currency: 'USD', date: '2026-08-10' },
      { amount: 50, currency: 'USD', date: '2026-08-10' },
      { amount: 20, currency: 'EUR', date: '2026-08-10' },
      { amount: 25, currency: 'ILS', date: '2026-08-10' },
    ], { baseCurrency: 'ILS' });

    expect(result.nativeTotals).toEqual([
      { currency: 'EUR', total: 20, count: 1 },
      { currency: 'ILS', total: 25, count: 1 },
      { currency: 'USD', total: 150, count: 2 },
    ]);
    expect(result.convertedSubtotal).toBe(580);
    expect(result.baseTotal).toBeNull();
    expect(result.complete).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({ currency: 'EUR', status: 'missing' });
  });

  it('marks an overly old prior rate as stale and leaves the converted amount unavailable', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (String(sql).includes('rate_date <= $3')) {
        return Promise.resolve({
          rows: [{
            rate_date: '2026-07-01',
            from_currency: 'USD',
            to_currency: 'ILS',
            rate: 3.6,
            source: 'manual',
          }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await fxService.convertAmount({
      amount: 10,
      currency: 'USD',
      baseCurrency: 'ILS',
      date: '2026-08-10',
      maxAgeDays: 7,
    });

    expect(result).toMatchObject({
      rate: 3.6,
      rateDate: '2026-07-01',
      status: 'stale',
      baseAmount: null,
      complete: false,
    });
  });

  it('defaults to a 14-day maximum age while allowing weekends and explicit wider limits', async () => {
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      if (String(sql).includes('rate_date <= $3')
        && params?.[0] === 'USD'
        && params?.[1] === 'ILS') {
        return Promise.resolve({
          rows: [{
            rate_date: '2026-08-07',
            from_currency: 'USD',
            to_currency: 'ILS',
            rate: 3.6,
            source: 'Friday BOI rate',
          }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    expect(fxService.DEFAULT_MAX_AGE_DAYS).toBe(14);
    await expect(fxService.convertAmount({
      amount: 10,
      currency: 'USD',
      baseCurrency: 'ILS',
      date: '2026-08-09',
    })).resolves.toMatchObject({
      baseAmount: 36,
      rateAgeDays: 2,
      status: 'prior',
      complete: true,
    });
    await expect(fxService.convertAmount({
      amount: 10,
      currency: 'USD',
      baseCurrency: 'ILS',
      date: '2026-09-01',
    })).resolves.toMatchObject({
      baseAmount: null,
      rateAgeDays: 25,
      status: 'stale',
      complete: false,
    });
    await expect(fxService.convertAmount({
      amount: 10,
      currency: 'USD',
      baseCurrency: 'ILS',
      date: '2026-09-01',
      maxAgeDays: 30,
    })).resolves.toMatchObject({
      baseAmount: 36,
      rateAgeDays: 25,
      status: 'prior',
      complete: true,
    });

    const summary = await fxService.summarizeAmounts([
      { amount: 10, currency: 'USD', date: '2026-09-01' },
    ], { baseCurrency: 'ILS' });
    expect(summary).toMatchObject({
      baseTotal: null,
      convertedSubtotal: 0,
      complete: false,
    });
    expect(summary.missing[0]).toMatchObject({ status: 'stale', rateAgeDays: 25 });
  });

  it('parses the Bank of Israel CSV shape, including quoted fields', () => {
    const parsed = fxService.__parseBoiCsv([
      'BASE_CURRENCY,COUNTER_CURRENCY,UNIT_MULT,TIME_PERIOD,OBS_VALUE,COMMENT',
      '"USD","ILS","0","2026-08-11","3.7000","official, daily"',
      'EUR,ILS,0,2026-08-11,4.2500,official',
      'JPY,ILS,2,2026-08-11,1.8866,official',
    ].join('\n'));

    expect(parsed).toEqual([
      {
        fromCurrency: 'USD',
        toCurrency: 'ILS',
        rateDate: '2026-08-11',
        rate: 3.7,
        source: 'Bank of Israel representative rate',
      },
      {
        fromCurrency: 'EUR',
        toCurrency: 'ILS',
        rateDate: '2026-08-11',
        rate: 4.25,
        source: 'Bank of Israel representative rate',
      },
      {
        fromCurrency: 'JPY',
        toCurrency: 'ILS',
        rateDate: '2026-08-11',
        rate: 0.018866,
        source: 'Bank of Israel representative rate',
      },
    ]);
  });

  it('rejects a Bank of Israel response whose required columns are missing', () => {
    expect(() => fxService.__parseBoiCsv([
      'CURRENCY,DATE,VALUE',
      'USD,2026-08-11,3.7',
    ].join('\n'))).toThrow(expect.objectContaining({
      status: 502,
      message: expect.stringMatching(/expected columns/i),
    }));
  });

  it('syncs selected Bank of Israel rates and records request and source metadata', async () => {
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      if (String(sql).includes('INSERT INTO investment_fx_rates')) {
        return Promise.resolve({
          rows: [{
            rate_date: params?.[0],
            from_currency: params?.[1],
            to_currency: params?.[2],
            rate: params?.[3],
            source: params?.[4],
          }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue([
        'BASE_CURRENCY,COUNTER_CURRENCY,TIME_PERIOD,OBS_VALUE',
        'USD,ILS,2026-08-10,3.70',
        'EUR,ILS,2026-08-10,4.25',
        'GBP,ILS,2026-08-10,4.95',
      ].join('\n')),
    });

    const result = await fxService.syncBoiRates({
      baseCurrency: 'ils',
      currencies: ['usd', 'EUR', 'usd'],
      startDate: '2026-08-01',
      endDate: '2026-08-12',
    }, { fetchImpl: fetchMock });

    expect(result).toMatchObject({
      baseCurrency: 'ILS',
      imported: 2,
      source: 'Bank of Israel representative rate',
      rates: [
        { fromCurrency: 'USD', toCurrency: 'ILS', rateDate: '2026-08-10', rate: 3.7 },
        { fromCurrency: 'EUR', toCurrency: 'ILS', rateDate: '2026-08-10', rate: 4.25 },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestOptions] = fetchMock.mock.calls[0];
    expect(requestUrl).toBeInstanceOf(URL);
    expect(requestUrl.searchParams.get('c[DATA_TYPE]')).toBe('OF00');
    expect(requestUrl.searchParams.get('c[BASE_CURRENCY]')).toBe('USD,EUR');
    expect(requestUrl.searchParams.get('c[COUNTER_CURRENCY]')).toBe('ILS');
    expect(requestUrl.searchParams.get('format')).toBe('csv');
    expect(requestUrl.searchParams.get('startPeriod')).toBe('2026-08-01');
    expect(requestUrl.searchParams.get('endPeriod')).toBe('2026-08-12');
    expect(requestUrl.searchParams.has('lastNObservations')).toBe(false);
    expect(requestUrl.href).toContain('c%5BBASE_CURRENCY%5D=USD,EUR');
    expect(requestUrl.href).not.toContain('USD%2CEUR');
    expect(requestOptions).toMatchObject({ headers: { Accept: 'text/csv' } });

    const rateWrites = queryMock.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO investment_fx_rates'));
    expect(rateWrites).toHaveLength(2);
    expect(rateWrites.map(([, params]) => params)).toEqual([
      ['2026-08-10', 'USD', 'ILS', 3.7, 'Bank of Israel representative rate'],
      ['2026-08-10', 'EUR', 'ILS', 4.25, 'Bank of Israel representative rate'],
    ]);
  });

  it('surfaces Bank of Israel network and HTTP failures without writing rates', async () => {
    const networkFetch = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(fxService.syncBoiRates({
      baseCurrency: 'ILS',
      currencies: ['USD'],
    }, { fetchImpl: networkFetch })).rejects.toMatchObject({
      status: 503,
      message: expect.stringMatching(/offline/i),
    });

    const httpFetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(fxService.syncBoiRates({
      baseCurrency: 'ILS',
      currencies: ['USD'],
    }, { fetchImpl: httpFetch })).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/HTTP 429/i),
    });
    expect(queryMock.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO investment_fx_rates'))).toBe(false);
  });

  it('rejects automatic sync for a non-ILS base before making a request', async () => {
    const fetchMock = vi.fn();

    await expect(fxService.syncBoiRates({
      base_currency: 'EUR',
      currencies: ['USD'],
    }, { fetchImpl: fetchMock })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/ILS base currency/i),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an inverted Bank of Israel sync date range before making a request', async () => {
    const fetchMock = vi.fn();

    await expect(fxService.syncBoiRates({
      baseCurrency: 'ILS',
      currencies: ['USD'],
      startDate: '2026-08-12',
      endDate: '2026-08-01',
    }, { fetchImpl: fetchMock })).rejects.toMatchObject({
      status: 400,
      message: 'startDate must be on or before endDate',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
