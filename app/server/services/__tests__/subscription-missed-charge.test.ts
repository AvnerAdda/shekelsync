import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const subscriptionsService = require('../analytics/subscriptions.js');

const PATTERN = {
  id: 9,
  normalizedName: 'partner',
  displayName: 'Partner',
  direction: 'expense',
  isSubscription: true,
  state: 'active',
  frequency: 'monthly',
  amount: 100,
  amountTolerance: 0,
  confidence: 0.9,
  categoryDefinitionId: null,
  firstSeenDate: '2026-06-24',
  lastSeenDate: '2026-09-24',
  occurrenceCount: 4,
  nextExpectedDate: '2026-10-24',
};

interface Fixture {
  syncedThrough?: string | null;
  storedAlerts?: Record<string, unknown>[];
}

function install({ syncedThrough = null, storedAlerts = [] }: Fixture) {
  const query = vi.fn(async (sql: string) => {
    const text = String(sql);
    if (text.includes('FROM subscription_alerts sa')) return { rows: storedAlerts };
    if (text.includes('FROM subscriptions s')) {
      return { rows: [{ id: 50, pattern_key: 'partner', display_name: 'Partner', status: 'active', financial_pattern_id: 9 }] };
    }
    if (text.includes('FROM financial_pattern_transactions')) {
      return { rows: [{ pattern_id: 9, vendor: 'max', last_date: '2026-09-24' }] };
    }
    if (text.includes('FROM transactions') && text.includes('GROUP BY vendor')) {
      return { rows: [{ vendor: 'max', last_date: '2026-10-26T10:00:00.000Z' }] };
    }
    if (text.includes('FROM vendor_credentials')) {
      return { rows: syncedThrough ? [{ vendor: 'max', last_date: syncedThrough }] : [] };
    }
    return { rows: [] };
  });
  subscriptionsService.__setDatabase({ query });
  subscriptionsService.__setFinancialTruth({
    getProjectionSnapshot: () => ({ truthRevision: 1, patterns: [PATTERN] }),
  });
  subscriptionsService.__setRecurringAnalyzer({
    normalizePatternKey: (value: string) => String(value || '').trim().toLowerCase(),
  });
}

const missedAlerts = (result: { alerts: Array<{ alert_type: string }> }) =>
  result.alerts.filter((alert) => alert.alert_type === 'missed_charge');

describe('subscription missed-charge alerts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T09:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    subscriptionsService.__resetDependencies();
  });

  it('waits until the paying account has data well past the expected date', async () => {
    // Latest data for the account is 2-3 days after the expected charge date:
    // the charge may simply not be imported yet.
    install({ syncedThrough: '2026-10-27 07:00:00' });
    const result = await subscriptionsService.getSubscriptionAlerts({ locale: 'en' });
    expect(missedAlerts(result)).toHaveLength(0);
  });

  it('reports the missed charge once the account has synced past the grace window', async () => {
    install({ syncedThrough: '2026-11-08 07:21:49' });
    const result = await subscriptionsService.getSubscriptionAlerts({ locale: 'en' });
    expect(missedAlerts(result)).toEqual([
      expect.objectContaining({
        identity_key: 'subscription:50:missed_charge:2026-10-24',
        expected_date: '2026-10-24',
      }),
    ]);
  });

  it('drops stored missed-charge alerts for an expected date that is no longer missing', async () => {
    install({
      syncedThrough: '2026-11-08 07:21:49',
      storedAlerts: [
        {
          id: 1,
          subscription_id: 50,
          alert_type: 'missed_charge',
          identity_key: 'subscription:50:missed_charge:2026-09-24',
          expected_date: '2026-09-24',
          is_dismissed: 0,
          created_at: '2026-10-05T00:00:00.000Z',
        },
        {
          id: 2,
          subscription_id: 50,
          alert_type: 'price_increase',
          identity_key: 'subscription:50:price_increase:2026-09-24:10000',
          is_dismissed: 0,
          created_at: '2026-09-25T00:00:00.000Z',
        },
      ],
    });

    const result = await subscriptionsService.getSubscriptionAlerts({ locale: 'en' });

    expect(result.alerts.map((alert: { identity_key: string }) => alert.identity_key)).toEqual([
      'subscription:50:price_increase:2026-09-24:10000',
      'subscription:50:missed_charge:2026-10-24',
    ]);
  });
});
