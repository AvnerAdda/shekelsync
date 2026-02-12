import { describe, expect, it } from 'vitest';
import { getSecurityTooltip, parseSecuritySummaryLevel } from '../components/SecurityIndicator';

describe('parseSecuritySummaryLevel', () => {
  it('reads a nested API payload level', () => {
    expect(
      parseSecuritySummaryLevel({
        success: true,
        data: { level: 'secure' },
      }),
    ).toBe('secure');
  });

  it('falls back to top-level level when data is missing', () => {
    expect(parseSecuritySummaryLevel({ level: 'warning' })).toBe('warning');
  });

  it('returns unknown for unsupported levels', () => {
    expect(
      parseSecuritySummaryLevel({
        data: { level: 'critical' },
      }),
    ).toBe('unknown');
  });

  it('returns unknown for malformed payloads', () => {
    expect(parseSecuritySummaryLevel({})).toBe('unknown');
    expect(parseSecuritySummaryLevel(null)).toBe('unknown');
    expect(parseSecuritySummaryLevel('secure')).toBe('unknown');
  });
});

describe('getSecurityTooltip', () => {
  it('maps each supported level to the expected tooltip', () => {
    expect(getSecurityTooltip('secure')).toBe('Security: All systems secure');
    expect(getSecurityTooltip('warning')).toBe('Security: Warning - Check details');
    expect(getSecurityTooltip('error')).toBe('Security: Issues detected');
    expect(getSecurityTooltip('unknown')).toBe('Security status unknown');
  });
});
