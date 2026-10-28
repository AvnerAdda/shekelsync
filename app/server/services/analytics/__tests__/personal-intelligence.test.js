import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const personalIntelligence = require('../personal-intelligence.js');
const database = require('../../database.js');

const originalTz = process.env.TZ;

describe('personal intelligence period bounds', () => {
  let queryMock;

  beforeEach(() => {
    // Israel is ahead of UTC, so local midnight is the previous UTC day.
    process.env.TZ = 'Asia/Jerusalem';
    queryMock = vi.fn(async (sql) => ({
      rows: String(sql).includes('AS period_income') ? [{}] : [],
    }));
    vi.spyOn(database, 'getClient').mockResolvedValue({ query: queryMock, release: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.TZ = originalTz;
  });

  it('queries exactly the requested days', async () => {
    await personalIntelligence.getPersonalIntelligence({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      noCache: true,
    });

    const rangeQueries = queryMock.mock.calls.filter(([, params]) => Array.isArray(params) && params.length >= 2);
    expect(rangeQueries.length).toBeGreaterThan(0);
    for (const [, params] of rangeQueries) {
      expect(params.slice(0, 2)).toEqual(['2026-10-01', '2026-10-31']);
    }
  });
});
