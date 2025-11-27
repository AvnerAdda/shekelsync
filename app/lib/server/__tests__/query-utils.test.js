import { describe, expect, it } from 'vitest';

const {
  resolveDateRange,
  buildTypeFilters,
  standardizeResponse,
  standardizeError,
} = require('../query-utils.js');

describe('query-utils', () => {
  it('falls back to months window when dates are missing', () => {
    const now = new Date('2025-01-31T12:00:00Z');
    const realDate = global.Date;
    global.Date = class MockDate extends Date {
      constructor(input) {
        if (input) {
          super(input);
        } else {
          super(now);
        }
      }
    };

    const { start, end } = resolveDateRange({ months: 2 });
    expect(end.toISOString()).toContain('2025-01-31');
    expect(start.getMonth()).toBe(10); // two months back from January lands in November/December crossover

    global.Date = realDate;
  });

  it('builds filters for known types and defaults to expense', () => {
    expect(buildTypeFilters('income')).toMatchObject({
      priceFilter: 'price > 0',
      amountExpression: 'price',
    });
    expect(buildTypeFilters('investment')).toMatchObject({
      priceFilter: '',
      amountExpression: 'ABS(price)',
    });
    const fallback = buildTypeFilters('unknown');
    expect(fallback.priceFilter).toBe('price < 0');
  });

  it('standardizes responses and errors', () => {
    const success = standardizeResponse({ foo: 'bar' }, { meta: true });
    expect(success).toMatchObject({
      success: true,
      data: { foo: 'bar' },
      metadata: expect.objectContaining({ meta: true, timestamp: expect.any(String) }),
    });

    const error = standardizeError('oops', 'BAD', { detail: 1 });
    expect(error.success).toBe(false);
    expect(error.error).toMatchObject({
      code: 'BAD',
      message: 'oops',
      details: { detail: 1 },
      timestamp: expect.any(String),
    });
  });
});
