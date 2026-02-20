import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let temporalService;

beforeAll(async () => {
  const temporalModule = await import('../temporal.js');
  temporalService = temporalModule.default ?? temporalModule;
});

describe('temporal analytics service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-16T12:00:00.000Z'));
    vi.restoreAllMocks();
    temporalService.__resetDependencies();
  });

  afterEach(() => {
    temporalService.__resetDependencies();
    vi.useRealTimers();
  });

  it('computes precise time percentage across completed and pending expenses', async () => {
    const queryMock = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          date: '2026-01-10T10:00:00.000Z',
          transaction_datetime: '2026-01-10T10:00:00.000Z',
          price: -100,
          hour: '10',
          day_of_week: '1',
          year_week: '2026-02',
          has_precise_time: 0,
        },
        {
          date: '2026-01-11T11:42:00.000Z',
          transaction_datetime: '2026-01-11T11:42:00.000Z',
          price: -50,
          hour: '11',
          day_of_week: '2',
          year_week: '2026-02',
          has_precise_time: 1,
        },
        {
          date: '2026-01-12T00:15:00.000Z',
          transaction_datetime: '2026-01-12T00:15:00.000Z',
          price: -150,
          hour: '00',
          day_of_week: '6',
          year_week: '2026-02',
          has_precise_time: 1,
        },
      ],
    });
    temporalService.__setDatabase({ query: queryMock });

    const result = await temporalService.getTemporalAnalytics({
      timeRange: '6months',
      summary: '1',
      noCache: '1',
    });

    expect(result.preciseTimePercentage).toBeCloseTo(66.666, 2);
    expect(result.weekendPercentage).toBeCloseTo(50, 5);
    expect(result.hourlySpending[10]).toBe(0);
    expect(result.hourlySpending[11]).toBe(50);
    expect(result.hourlySpending[0]).toBe(150);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain("t.status IN ('completed', 'pending')");
    expect(sql).toContain("COALESCE(t.transaction_datetime, t.date)");
  });

  it('returns cached summary response when caching is enabled', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      const queryMock = vi.fn().mockResolvedValue({
        rows: [
          {
            date: '2026-01-10T10:00:00.000Z',
            transaction_datetime: '2026-01-10T10:15:00.000Z',
            price: -100,
            hour: '10',
            day_of_week: '1',
            year_week: '2026-02',
            has_precise_time: 1,
          },
        ],
      });
      temporalService.__setDatabase({ query: queryMock });

      const first = await temporalService.getTemporalAnalytics({
        timeRange: '3months',
        summary: true,
      });
      const second = await temporalService.getTemporalAnalytics({
        timeRange: '3months',
        summary: true,
      });

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('builds full analytics payload for all-range fallback and skips cache when requested', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ earliest: null }] })
      .mockResolvedValueOnce({
        rows: [
          {
            date: '2026-01-10T10:00:00.000Z',
            transaction_datetime: '2026-01-10T10:15:00.000Z',
            price: -100,
            hour: '05',
            day_of_week: '1',
            year_week: '2026-01',
            has_precise_time: 1,
          },
          {
            date: '2026-01-11T11:00:00.000Z',
            transaction_datetime: '2026-01-11T11:00:00.000Z',
            price: -50,
            hour: '11',
            day_of_week: '0',
            year_week: '2026-01',
            has_precise_time: 0,
          },
          {
            date: '2026-01-12T00:15:00.000Z',
            transaction_datetime: '2026-01-12T00:15:00.000Z',
            price: -30,
            hour: '06',
            day_of_week: 'bad',
            year_week: null,
            has_precise_time: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ hour: '5', count: '2' }, { hour: '99', count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ day_of_week: '0', count: '1' }, { day_of_week: '7', count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ date: '2026-01-10', total_amount: '150', transaction_count: '2' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            year_week: '2026-01',
            week_start_date: '2026-01-05',
            total_amount: '150',
            transaction_count: '2',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            year_month: '2026-01',
            month_start_date: '2026-01-01',
            total_amount: '180',
            transaction_count: '3',
          },
        ],
      });
    temporalService.__setDatabase({ query: queryMock });

    const result = await temporalService.getTemporalAnalytics({
      timeRange: 'all',
      noCache: true,
    });

    expect(queryMock).toHaveBeenCalledTimes(7);
    expect(String(queryMock.mock.calls[0][0])).toContain('MIN(COALESCE(transaction_datetime, date))');
    expect(String(queryMock.mock.calls[1][1][0])).toContain('2024-02-16');
    expect(result.weeklyTrend).toEqual([{ week: '2026-01', total: 150 }]);
    expect(result.hourlySpending[5]).toBe(100);
    expect(result.hourlySpending[6]).toBe(30);
    expect(result.hourlyTransactionCount[5]).toBe(2);
    expect(result.weekdayTransactionCount[0]).toBe(1);
    expect(result.dailyEvolution).toHaveLength(1);
    expect(result.weeklyEvolution).toHaveLength(1);
    expect(result.monthlyEvolution).toHaveLength(1);
  });

  it('uses earliest transaction date when timeRange is all and earliest exists', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ earliest: '2020-01-15T10:30:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [] });
    temporalService.__setDatabase({ query: queryMock });

    const result = await temporalService.getTemporalAnalytics({
      timeRange: 'all',
      summary: 'true',
      noCache: '1',
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(String(queryMock.mock.calls[1][1][0])).toContain('2020-01-15');
    expect(result.dateRange.start).toBe('2020-01-15');
  });

  it('uses default six-month range when timeRange is unsupported and mode=summary', async () => {
    const queryMock = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          date: '2026-02-10T00:00:00.000Z',
          transaction_datetime: '2026-02-10T00:00:00.000Z',
          price: -40,
          hour: null,
          day_of_week: '2',
          year_week: '2026-07',
          has_precise_time: 0,
        },
      ],
    });
    temporalService.__setDatabase({ query: queryMock });

    const result = await temporalService.getTemporalAnalytics({
      timeRange: 'invalid',
      mode: 'summary',
      noCache: 'true',
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0][1][0])).toContain('2025-08-16');
    expect(result.preciseTimePercentage).toBe(0);
  });

  it('ignores invalid database adapters passed to __setDatabase', async () => {
    const queryMock = vi.fn().mockResolvedValueOnce({ rows: [] });
    temporalService.__setDatabase({ query: queryMock });
    temporalService.__setDatabase({ query: null });

    await temporalService.getTemporalAnalytics({
      summary: true,
      noCache: true,
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
