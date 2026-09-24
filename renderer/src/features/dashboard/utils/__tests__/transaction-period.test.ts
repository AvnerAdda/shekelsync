import { describe, expect, it } from 'vitest';
import { getTransactionPeriod } from '../transaction-period';

describe('dashboard transaction periods', () => {
  const start = new Date(2026, 8, 1);
  const end = new Date(2026, 8, 23);

  it('keeps the partial first and last weeks using Monday through Sunday', () => {
    expect(getTransactionPeriod('2026-08-31', 'weekly', start, end))
      .toEqual({ startDate: '2026-09-01', endDate: '2026-09-06' });
    expect(getTransactionPeriod('2026-09-07', 'weekly', start, end))
      .toEqual({ startDate: '2026-09-07', endDate: '2026-09-13' });
    expect(getTransactionPeriod('2026-09-21', 'weekly', start, end))
      .toEqual({ startDate: '2026-09-21', endDate: '2026-09-23' });
  });

  it('clips partial months and handles leap years', () => {
    expect(getTransactionPeriod('2026-09-01', 'monthly', new Date(2026, 8, 12), end))
      .toEqual({ startDate: '2026-09-12', endDate: '2026-09-23' });
    expect(getTransactionPeriod('2024-02-01', 'monthly', new Date(2024, 0, 1), new Date(2024, 2, 1)))
      .toEqual({ startDate: '2024-02-01', endDate: '2024-02-29' });
  });

  it('keeps daily selection local and excludes nonoverlapping or invalid buckets', () => {
    expect(getTransactionPeriod('2026-09-05', 'daily', start, end))
      .toEqual({ startDate: '2026-09-05', endDate: '2026-09-05' });
    expect(getTransactionPeriod('2026-08-24', 'weekly', start, end)).toBeNull();
    expect(getTransactionPeriod('2026-10-01', 'monthly', start, end)).toBeNull();
    expect(getTransactionPeriod('invalid', 'monthly', start, end)).toBeNull();
  });
});
