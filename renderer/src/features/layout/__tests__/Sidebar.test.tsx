import { describe, expect, it } from 'vitest';
import {
  formatSidebarAccountLastSync,
  formatSidebarLastSync,
  getAccountSyncStatus,
} from '../components/sidebar-helpers';

describe('Sidebar helpers', () => {
  it('classifies account sync recency into status buckets', () => {
    const now = new Date('2026-02-09T12:00:00.000Z').getTime();
    expect(getAccountSyncStatus(null, now)).toBe('never');
    expect(getAccountSyncStatus(new Date('2026-02-09T00:30:00.000Z'), now)).toBe('green');
    expect(getAccountSyncStatus(new Date('2026-02-08T00:30:00.000Z'), now)).toBe('orange');
    expect(getAccountSyncStatus(new Date('2026-02-06T00:00:00.000Z'), now)).toBe('red');
  });

  it('formats overall and per-account sync labels from elapsed time', () => {
    const now = new Date('2026-02-09T12:00:00.000Z');

    const sharedLabels = {
      daysAgo: (count: number) => `${count}d`,
      hoursAgo: (count: number) => `${count}h`,
      minutesAgo: (count: number) => `${count}m`,
      justNow: 'now',
    };

    expect(
      formatSidebarLastSync(null, now, {
        never: 'never',
        ...sharedLabels,
      }),
    ).toBe('never');
    expect(
      formatSidebarLastSync(new Date('2026-02-09T11:00:00.000Z'), now, {
        never: 'never',
        ...sharedLabels,
      }),
    ).toBe('1h');

    expect(
      formatSidebarAccountLastSync(null, now, {
        neverSynced: 'never synced',
        yesterday: 'yesterday',
        ...sharedLabels,
      }),
    ).toBe('never synced');
    expect(
      formatSidebarAccountLastSync(new Date('2026-02-08T10:00:00.000Z'), now, {
        neverSynced: 'never synced',
        yesterday: 'yesterday',
        ...sharedLabels,
      }),
    ).toBe('yesterday');
  });
});
