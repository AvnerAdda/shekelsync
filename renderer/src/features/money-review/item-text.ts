import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import type { MoneyReviewItem } from './types';

/**
 * Review items are generated on the server with English fallback text. The
 * renderer rebuilds the title and description from the item's type and data so
 * they follow the app language and the privacy mask. Unknown types, and types
 * whose data is incomplete, keep the server text.
 */

type Values = Record<string, string | number>;

export interface MoneyReviewTextSpec {
  key: string;
  title: Values;
  description: Values | null;
  /** Variant of the description key, e.g. `descriptionNoAmount`. */
  descriptionKey?: string;
}

export interface MoneyReviewTextFormatters {
  money: (value: number) => string;
  date: (value: string) => string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function amount(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function dateOnly(value: unknown): string | null {
  const match = String(value ?? '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

/** Subscription items embed the merchant in the server title ("Missed charge for X"). */
function subscriptionName(item: MoneyReviewItem, data: Record<string, unknown>): string | null {
  const fromData = text(data.subscription_name);
  if (fromData) return fromData;
  const match = item.title.match(/\b(?:for|from)\s+(.+)$/);
  return match ? match[1].trim() : null;
}

export function buildMoneyReviewTextSpec(
  item: MoneyReviewItem,
  format: MoneyReviewTextFormatters,
): MoneyReviewTextSpec | null {
  const metadata = record(item.metadata);
  const data = record(metadata.data);
  const money = (...values: unknown[]) => {
    const value = amount(...values);
    return value === null ? null : format.money(Math.abs(value));
  };
  const date = (...values: unknown[]) => {
    for (const value of values) {
      const day = dateOnly(value);
      if (day) return format.date(day);
    }
    return null;
  };

  if (metadata.source === 'expected_deposit') {
    const kind = String(metadata.depositKind || '');
    const name = text(data.name);
    const expected = date(data.expected_date);
    const covered = date(data.covered_through);
    if (!['salary', 'income', 'investment'].includes(kind) || !name || !expected || !covered) return null;
    const expectedAmount = amount(data.expected_amount);
    return {
      key: `deposit.${kind}`,
      title: { name },
      description: expectedAmount && expectedAmount > 0
        ? { date: expected, amount: format.money(expectedAmount), coveredThrough: covered }
        : { date: expected, coveredThrough: covered },
      ...(expectedAmount && expectedAmount > 0 ? {} : { descriptionKey: 'descriptionNoAmount' }),
    };
  }

  if (metadata.source === 'subscription') {
    const alertType = String(metadata.subscriptionAlertType || '');
    const name = subscriptionName(item, data);
    if (!name) return null;
    if (alertType === 'missed_charge') {
      const expected = date(data.expected_date);
      const value = money(data.detected_amount);
      if (!expected) return null;
      return value
        ? { key: 'subscription.missedCharge', title: { name }, description: { date: expected, amount: value } }
        : { key: 'subscription.missedCharge', title: { name }, description: { date: expected }, descriptionKey: 'descriptionNoAmount' };
    }
    if (alertType === 'price_increase') {
      const previous = money(data.old_amount);
      const current = money(data.new_amount);
      const percent = amount(data.percentage_change);
      if (!previous || !current) return null;
      return {
        key: 'subscription.priceIncrease',
        title: { name },
        description: { previous, current, percent: percent === null ? '' : Math.round(percent) },
      };
    }
    if (alertType === 'duplicate') {
      const value = money(data.new_amount, data.old_amount);
      const day = date(data.evidence_end_date);
      return value && day
        ? { key: 'subscription.duplicate', title: { name }, description: { amount: value, date: day } }
        : null;
    }
    if (alertType === 'upcoming_renewal') {
      const day = date(data.expected_date, data.evidence_end_date, record(metadata.timeScope).end);
      const value = money(data.detected_amount, data.new_amount);
      if (!day) return null;
      return value
        ? { key: 'subscription.upcomingRenewal', title: { name }, description: { date: day, amount: value } }
        : { key: 'subscription.upcomingRenewal', title: { name }, description: { date: day }, descriptionKey: 'descriptionNoAmount' };
    }
    if (alertType === 'cancelled_still_charging') {
      const day = date(data.evidence_end_date);
      return day ? { key: 'subscription.cancelledStillCharging', title: { name }, description: { date: day } } : null;
    }
    return null;
  }

  const type = String(metadata.notificationType || '');
  const category = text(data.category_name);
  switch (type) {
    case 'budget_exceeded':
    case 'budget_warning': {
      const spent = money(data.spent);
      const budget = money(data.budget);
      const percent = amount(data.percentage);
      if (!category || !spent || !budget) return null;
      return {
        key: type === 'budget_exceeded' ? 'budget.exceeded' : 'budget.warning',
        title: { category },
        description: { spent, budget, percent: percent === null ? '' : Math.round(percent) },
      };
    }
    case 'budget_projected': {
      const projected = money(data.projected_total);
      const budget = money(data.limit, data.budget);
      if (!category || !projected || !budget) return null;
      return { key: 'budget.projected', title: { category }, description: { projected, budget } };
    }
    case 'stale_sync': {
      const accounts = amount(data.stale_count);
      const days = amount(data.days_since_sync);
      const account = text(data.oldest_account);
      if (accounts === 1 && account && days !== null) {
        return { key: 'staleSync', title: {}, description: { account, days }, descriptionKey: 'descriptionOne' };
      }
      return accounts && accounts > 1
        ? { key: 'staleSync', title: {}, description: { accounts } }
        : null;
    }
    case 'uncategorized_transactions': {
      const transactions = amount(data.count);
      const total = money(data.total_amount);
      return transactions && total
        ? { key: 'uncategorized', title: {}, description: { transactions, amount: total } }
        : null;
    }
    case 'cash_flow_alert': {
      const days = amount(data.days_remaining);
      return days !== null && Number.isFinite(days)
        ? { key: 'cashFlow', title: {}, description: { days: Math.max(0, Math.round(days)) } }
        : null;
    }
    case 'unusual_spending':
    case 'high_transaction': {
      const merchant = text(data.merchant, data.vendor);
      const value = money(data.amount);
      const day = date(data.date);
      if (!merchant || !value) return null;
      if (type === 'unusual_spending') {
        return category
          ? { key: 'unusualSpending', title: { merchant }, description: { amount: value, category } }
          : { key: 'unusualSpending', title: { merchant }, description: { amount: value }, descriptionKey: 'descriptionNoCategory' };
      }
      return day ? { key: 'largeTransaction', title: { merchant }, description: { amount: value, date: day } } : null;
    }
    default:
      return null;
  }
}

/** Localized title and description for a review item, falling back to the server text. */
export function useMoneyReviewItemText() {
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'moneyReview.items' });
  const { formatCurrency } = useFinancePrivacy();
  const locale = i18n?.language || 'en';

  return useCallback((item: MoneyReviewItem): { title: string; description: string } => {
    const dateFormat = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
    const spec = buildMoneyReviewTextSpec(item, {
      money: (value) => formatCurrency(value, { maximumFractionDigits: value < 100 ? 2 : 0 }),
      date: (value) => {
        const [year, month, day] = value.split('-').map(Number);
        return dateFormat.format(new Date(year, month - 1, day, 12));
      },
    });
    if (!spec || !i18n?.exists?.(`moneyReview.items.${spec.key}.title`)) {
      return { title: item.title, description: item.description };
    }
    return {
      title: t(`${spec.key}.title`, spec.title),
      description: spec.description
        ? t(`${spec.key}.${spec.descriptionKey || 'description'}`, spec.description)
        : item.description,
    };
  }, [formatCurrency, i18n, locale, t]);
}
