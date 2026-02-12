import { describe, expect, it } from 'vitest';

const { DEFAULT_TIME_ZONE, parseUTCDate, toUTCISOString } = require('../time-utils.js');

describe('time-utils', () => {
  it('exports the expected default timezone', () => {
    expect(DEFAULT_TIME_ZONE).toBe('Asia/Jerusalem');
  });

  it('parses Date and numeric inputs', () => {
    const sourceDate = new Date('2025-01-01T10:20:30Z');
    expect(parseUTCDate(sourceDate)).toBe(sourceDate);

    const fromTimestamp = parseUTCDate(sourceDate.getTime());
    expect(fromTimestamp).toBeInstanceOf(Date);
    expect(fromTimestamp.toISOString()).toBe('2025-01-01T10:20:30.000Z');

    expect(parseUTCDate(Number.NaN)).toBeNull();
  });

  it('parses strings with and without timezone hints', () => {
    const withoutTimezone = parseUTCDate('2025-01-02 11:30:00');
    expect(withoutTimezone.toISOString()).toBe('2025-01-02T11:30:00.000Z');

    const withTimezone = parseUTCDate('2025-01-02T11:30:00+02:00');
    expect(withTimezone.toISOString()).toBe('2025-01-02T09:30:00.000Z');
  });

  it('returns null for empty and unsupported inputs', () => {
    expect(parseUTCDate('')).toBeNull();
    expect(parseUTCDate('   ')).toBeNull();
    expect(parseUTCDate('not-a-date')).toBeNull();
    expect(parseUTCDate({})).toBeNull();
    expect(parseUTCDate(null)).toBeNull();
    expect(parseUTCDate(undefined)).toBeNull();
  });

  it('converts valid values to UTC ISO strings', () => {
    expect(toUTCISOString('2025-02-03 01:02:03')).toBe('2025-02-03T01:02:03.000Z');
    expect(toUTCISOString('bad')).toBeNull();
  });
});
