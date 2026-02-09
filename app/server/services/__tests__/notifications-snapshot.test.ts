import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const database = require('../database.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notificationsService = require('../notifications.js');

type AggregateRow = {
  income?: number;
  expenses?: number;
  investment_outflow?: number;
  investment_inflow?: number;
  capital_returns?: number;
  tx_count?: number;
};

function createMockClient({
  installationDate = '2025-01-15T08:00:00.000Z',
  firstTransactionDate = '2024-01-01',
  aggregates = {},
}: {
  installationDate?: string | null;
  firstTransactionDate?: string | null;
  aggregates?: Record<string, AggregateRow>;
}) {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    const text = String(sql);

    if (text.includes('FROM license')) {
      return installationDate ? { rows: [{ installation_date: installationDate }] } : { rows: [] };
    }

    if (text.includes('MIN(date) AS first_date')) {
      return { rows: [{ first_date: firstTransactionDate }] };
    }

    if (text.includes('AS tx_count')) {
      const key = `${params[0]}|${params[1]}`;
      const row = aggregates[key] || {};
      return {
        rows: [{
          income: row.income ?? 0,
          expenses: row.expenses ?? 0,
          investment_outflow: row.investment_outflow ?? 0,
          investment_inflow: row.investment_inflow ?? 0,
          capital_returns: row.capital_returns ?? 0,
          tx_count: row.tx_count ?? 0,
        }],
      };
    }

    return { rows: [] };
  });

  return {
    query,
    release: vi.fn(),
  };
}

describe('notifications snapshot progress service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('builds completed-period windows and computes deltas', async () => {
    vi.setSystemTime(new Date('2025-08-20T12:00:00.000Z'));

    const mockClient = createMockClient({
      aggregates: {
        '2025-08-10|2025-08-16': {
          income: 1000,
          expenses: 600,
          investment_outflow: 200,
          investment_inflow: 50,
          tx_count: 8,
        },
        '2025-08-03|2025-08-09': {
          income: 900,
          expenses: 700,
          investment_outflow: 100,
          investment_inflow: 10,
          tx_count: 7,
        },
      },
    });

    vi.spyOn(database, 'getClient').mockResolvedValue(mockClient);

    const result = await notificationsService.getSnapshotProgress({ now: new Date('2025-08-20T12:00:00.000Z') });

    expect(result.success).toBe(true);
    expect(result.data.triggerKey).toBe('2025-08-17');

    const weekPeriod = result.data.periods.find((period: any) => period.key === 'week');
    expect(weekPeriod.current.start).toBe('2025-08-10');
    expect(weekPeriod.current.end).toBe('2025-08-16');
    expect(weekPeriod.previous.start).toBe('2025-08-03');
    expect(weekPeriod.previous.end).toBe('2025-08-09');
    expect(weekPeriod.deltaNet).toBe(140);
    expect(weekPeriod.deltaNetPct).toBeCloseTo(127.27, 2);

    const monthPeriod = result.data.periods.find((period: any) => period.key === 'month');
    expect(monthPeriod.current.start).toBe('2025-07-01');
    expect(monthPeriod.current.end).toBe('2025-07-31');
    expect(monthPeriod.previous.start).toBe('2025-06-01');
    expect(monthPeriod.previous.end).toBe('2025-06-30');

    expect(result.data.sinceStart.startDate).toBe('2025-01-15');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('uses the previous full week when today is Sunday', async () => {
    vi.setSystemTime(new Date('2025-08-24T09:00:00.000Z')); // Sunday

    const mockClient = createMockClient({});
    vi.spyOn(database, 'getClient').mockResolvedValue(mockClient);

    const result = await notificationsService.getSnapshotProgress({ now: new Date('2025-08-24T09:00:00.000Z') });
    const weekPeriod = result.data.periods.find((period: any) => period.key === 'week');

    expect(weekPeriod.current.start).toBe('2025-08-17');
    expect(weekPeriod.current.end).toBe('2025-08-23');
    expect(weekPeriod.previous.start).toBe('2025-08-10');
    expect(weekPeriod.previous.end).toBe('2025-08-16');
  });

  it('falls back to earliest transaction date when license installation date is missing', async () => {
    vi.setSystemTime(new Date('2025-01-10T10:00:00.000Z'));

    const mockClient = createMockClient({
      installationDate: null,
      firstTransactionDate: '2024-02-01',
      aggregates: {
        '2024-02-01|2025-01-10': {
          income: 4000,
          expenses: 2500,
          investment_outflow: 900,
          investment_inflow: 100,
          tx_count: 20,
        },
      },
    });

    const getClientSpy = vi.spyOn(database, 'getClient').mockResolvedValue(mockClient);

    const result = await notificationsService.getSnapshotProgress({ now: new Date('2025-01-10T10:00:00.000Z') });

    expect(getClientSpy).toHaveBeenCalledTimes(1);
    expect(result.data.sinceStart.startDate).toBe('2024-02-01');
    expect(result.data.sinceStart.endDate).toBe('2025-01-10');
    expect(result.data.sinceStart.net).toBe(700);
    expect(
      mockClient.query.mock.calls.some(([sql]: [string]) => String(sql).includes('MIN(date) AS first_date'))
    ).toBe(true);
  });

  it('applies capital-returns adjustment to investment net impact', async () => {
    vi.setSystemTime(new Date('2025-08-20T12:00:00.000Z'));

    const mockClient = createMockClient({
      aggregates: {
        '2025-08-10|2025-08-16': {
          income: 1000,
          expenses: 600,
          investment_outflow: 300,
          investment_inflow: 0,
          capital_returns: 200,
          tx_count: 10,
        },
        '2025-08-03|2025-08-09': {
          income: 1000,
          expenses: 600,
          investment_outflow: 100,
          investment_inflow: 0,
          capital_returns: 0,
          tx_count: 9,
        },
      },
    });

    vi.spyOn(database, 'getClient').mockResolvedValue(mockClient);

    const result = await notificationsService.getSnapshotProgress({ now: new Date('2025-08-20T12:00:00.000Z') });
    const weekPeriod = result.data.periods.find((period: any) => period.key === 'week');

    // Current: 1000 - 600 - max(0, (300 - 0) - 200) = 300
    expect(weekPeriod.current.net).toBe(300);
    // Previous: 1000 - 600 - max(0, (100 - 0) - 0) = 300
    expect(weekPeriod.previous.net).toBe(300);
    expect(weekPeriod.deltaNet).toBe(0);
  });
});
