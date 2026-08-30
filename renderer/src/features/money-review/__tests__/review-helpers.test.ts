import { describe, expect, it } from 'vitest';
import { filterMoneyReviewItems, statusAfterPrimaryAction } from '../review-helpers';
import type { MoneyReviewItem } from '../types';

const item = (id: number, status: MoneyReviewItem['status']): MoneyReviewItem => ({
  id,
  status,
  source: 'notification',
  sourceKey: `item:${id}`,
  group: 'data',
  actionType: 'anomaly',
  severity: 'low',
  title: `Item ${id}`,
  description: '',
  detectedAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
  snoozedUntil: null,
  potentialImpact: 0,
  confidence: 0.9,
  priority: 50,
  primaryAction: null,
  metadata: {},
});

describe('Money Review helpers', () => {
  const items = [
    item(1, 'active'),
    item(2, 'accepted'),
    item(3, 'snoozed'),
    item(4, 'resolved'),
    item(5, 'dismissed'),
  ];

  it('filters the lifecycle into open, snoozed, and completed views', () => {
    expect(filterMoneyReviewItems(items, 'open').map((entry) => entry.id)).toEqual([1, 2]);
    expect(filterMoneyReviewItems(items, 'snoozed').map((entry) => entry.id)).toEqual([3]);
    expect(filterMoneyReviewItems(items, 'completed').map((entry) => entry.id)).toEqual([4, 5]);
  });

  it('starts active items before their primary action', () => {
    expect(statusAfterPrimaryAction('active')).toBe('accepted');
    expect(statusAfterPrimaryAction('accepted')).toBe('accepted');
  });
});
