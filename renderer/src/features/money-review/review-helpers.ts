import type { MoneyReviewItem, MoneyReviewStatus } from './types';

export type MoneyReviewFilter = 'open' | 'snoozed' | 'completed';

export function filterMoneyReviewItems(
  items: MoneyReviewItem[],
  filter: MoneyReviewFilter,
): MoneyReviewItem[] {
  if (filter === 'open') {
    return items.filter((item) => ['active', 'accepted'].includes(item.status));
  }
  if (filter === 'snoozed') {
    return items.filter((item) => item.status === 'snoozed');
  }
  return items.filter((item) => ['resolved', 'dismissed'].includes(item.status));
}

export function statusAfterPrimaryAction(status: MoneyReviewStatus): MoneyReviewStatus {
  return status === 'active' ? 'accepted' : status;
}
