import { describe, expect, it } from 'vitest';
import { formatMetricKey, formatTimestamp } from '../DiagnosticsPanel';

describe('DiagnosticsPanel helpers', () => {
  it('formats metric keys into readable labels', () => {
    expect(formatMetricKey('row_counts')).toBe('Row counts');
    expect(formatMetricKey('avgDurationMs')).toBe('Avg Duration Ms');
    expect(formatMetricKey('waterfall')).toBe('Waterfall');
  });

  it('returns null for empty or invalid timestamps', () => {
    expect(formatTimestamp()).toBeNull();
    expect(formatTimestamp('')).toBeNull();
    expect(formatTimestamp('not-a-date')).toBeNull();
  });

  it('formats valid timestamps into localized strings', () => {
    const value = formatTimestamp('2026-02-09T12:00:00.000Z');
    expect(typeof value).toBe('string');
    expect(value).toBeTruthy();
  });
});
