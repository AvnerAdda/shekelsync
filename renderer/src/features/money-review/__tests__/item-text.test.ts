import { describe, expect, it } from 'vitest';
import i18n from 'i18next';
import he from '@renderer/i18n/locales/he.json';
import { buildMoneyReviewTextSpec } from '../item-text';
import type { MoneyReviewItem } from '../types';

const format = {
  money: (value: number) => `₪${value}`,
  date: (value: string) => value,
};

function item(overrides: Partial<MoneyReviewItem>): MoneyReviewItem {
  return {
    id: 1,
    source: 'notification',
    sourceKey: 'key',
    group: 'cash',
    actionType: 'fixed_recurring_missing',
    severity: 'critical',
    title: 'Server title',
    description: 'Server description',
    status: 'active',
    detectedAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
    snoozedUntil: null,
    potentialImpact: 0,
    confidence: 0.9,
    priority: 90,
    primaryAction: null,
    metadata: {},
    ...overrides,
  };
}

describe('Money Review item text', () => {
  it('describes a missing salary from its structured data', () => {
    expect(buildMoneyReviewTextSpec(item({
      metadata: {
        source: 'expected_deposit',
        depositKind: 'salary',
        data: { name: 'Gan Dalia', expected_date: '2026-11-08', expected_amount: 7029, covered_through: '2026-11-19' },
      },
    }), format)).toEqual({
      key: 'deposit.salary',
      title: { name: 'Gan Dalia' },
      description: { date: '2026-11-08', amount: '₪7029', coveredThrough: '2026-11-19' },
    });
  });

  it('recovers the merchant of older subscription items from the server title', () => {
    expect(buildMoneyReviewTextSpec(item({
      title: 'Price increase detected for Spotify',
      metadata: {
        source: 'subscription',
        subscriptionAlertType: 'price_increase',
        data: { old_amount: 19.9, new_amount: 23.9, percentage_change: 20.1 },
      },
    }), format)).toMatchObject({
      key: 'subscription.priceIncrease',
      title: { name: 'Spotify' },
      description: { previous: '₪19.9', current: '₪23.9', percent: 20 },
    });
  });

  it('uses the single-account sentence for one stale account', () => {
    expect(buildMoneyReviewTextSpec(item({
      metadata: {
        source: 'notification',
        notificationType: 'stale_sync',
        data: { stale_count: 1, oldest_account: 'Discount', days_since_sync: 3 },
      },
    }), format)).toEqual({
      key: 'staleSync',
      title: {},
      description: { account: 'Discount', days: 3 },
      descriptionKey: 'descriptionOne',
    });
  });

  it('keeps the server text for unknown or incomplete items', () => {
    expect(buildMoneyReviewTextSpec(item({ metadata: { source: 'quest' } }), format)).toBeNull();
    expect(buildMoneyReviewTextSpec(item({
      metadata: { source: 'notification', notificationType: 'budget_exceeded', data: { category_name: 'Dining' } },
    }), format)).toBeNull();
  });

  it('has a Hebrew string for every text key it can produce', async () => {
    const instance = i18n.createInstance();
    await instance.init({ lng: 'he', resources: { he: { translation: he } } });
    const keys = [
      'deposit.salary', 'deposit.income', 'deposit.investment',
      'subscription.missedCharge', 'subscription.priceIncrease', 'subscription.duplicate',
      'subscription.upcomingRenewal', 'subscription.cancelledStillCharging',
      'budget.exceeded', 'budget.warning', 'budget.projected',
      'staleSync', 'uncategorized', 'cashFlow', 'unusualSpending', 'largeTransaction',
    ];
    keys.forEach((key) => {
      expect(instance.exists(`moneyReview.items.${key}.title`)).toBe(true);
      expect(instance.exists(`moneyReview.items.${key}.description`)).toBe(true);
    });
    expect(instance.t('moneyReview.items.deposit.salary.title', { name: 'גן דליה' })).toBe('המשכורת מ־גן דליה עוד לא נכנסה');
  });
});
