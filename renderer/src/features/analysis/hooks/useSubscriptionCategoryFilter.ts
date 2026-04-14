import { useState, useMemo, useCallback, useEffect } from 'react';
import type {
  Subscription,
  SubscriptionSummary,
  SubscriptionAlert,
  SubscriptionFrequency,
} from '@renderer/types/subscriptions';

const STORAGE_KEY = 'shekelsync:subscription-category-filter';

function getFirstLevelCategory(sub: Subscription): string {
  return sub.parent_category_name || sub.category_name || 'Uncategorized';
}

function convertToMonthly(amount: number, frequency: SubscriptionFrequency | string): number {
  switch (frequency) {
    case 'daily': return amount * 30;
    case 'weekly': return amount * 4.33;
    case 'biweekly': return amount * 2.17;
    case 'monthly': return amount;
    case 'bimonthly': return amount / 2;
    case 'quarterly': return amount / 3;
    case 'yearly': return amount / 12;
    default: return amount;
  }
}

function loadExcluded(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const arr = JSON.parse(stored);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch { /* ignore */ }
  return new Set();
}

function saveExcluded(excluded: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...excluded]));
  } catch { /* ignore */ }
}

interface UseSubscriptionCategoryFilterOptions {
  subscriptions: Subscription[];
  summary: SubscriptionSummary | null;
  alerts: SubscriptionAlert[];
}

export function useSubscriptionCategoryFilter({
  subscriptions,
  summary,
  alerts,
}: UseSubscriptionCategoryFilterOptions) {
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(loadExcluded);

  // Persist to localStorage whenever excluded set changes
  useEffect(() => {
    saveExcluded(excludedCategories);
  }, [excludedCategories]);

  // Extract unique first-level categories sorted alphabetically
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const sub of subscriptions) {
      cats.add(getFirstLevelCategory(sub));
    }
    return [...cats].sort((a, b) => a.localeCompare(b));
  }, [subscriptions]);

  // Clean up excluded categories that no longer exist
  useEffect(() => {
    const available = new Set(availableCategories);
    setExcludedCategories((prev) => {
      const cleaned = new Set([...prev].filter((c) => available.has(c)));
      if (cleaned.size !== prev.size) return cleaned;
      return prev;
    });
  }, [availableCategories]);

  const isFiltering = excludedCategories.size > 0;

  const isCategorySelected = useCallback(
    (category: string) => !excludedCategories.has(category),
    [excludedCategories],
  );

  const toggleCategory = useCallback((category: string) => {
    setExcludedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setExcludedCategories(new Set());
  }, []);

  const deselectAll = useCallback(() => {
    setExcludedCategories(new Set(availableCategories));
  }, [availableCategories]);

  // Filtered subscriptions
  const filteredSubscriptions = useMemo(() => {
    if (!isFiltering) return subscriptions;
    return subscriptions.filter((sub) => !excludedCategories.has(getFirstLevelCategory(sub)));
  }, [subscriptions, excludedCategories, isFiltering]);

  // Filtered alerts — keep only alerts whose subscription_id is in filtered set
  const filteredAlerts = useMemo(() => {
    if (!isFiltering) return alerts;
    const allowedIds = new Set(filteredSubscriptions.map((s) => s.id).filter(Boolean));
    return alerts.filter((a) => allowedIds.has(a.subscription_id));
  }, [alerts, filteredSubscriptions, isFiltering]);

  // Recomputed summary from filtered subscriptions
  const filteredSummary = useMemo((): SubscriptionSummary | null => {
    if (!summary) return null;
    if (!isFiltering) return summary;

    const activeFiltered = filteredSubscriptions.filter((s) => s.status === 'active');

    const monthlyTotal = activeFiltered.reduce((sum, sub) => {
      const amount = sub.user_amount || sub.detected_amount || 0;
      const frequency = sub.user_frequency || sub.detected_frequency || 'monthly';
      return sum + convertToMonthly(amount, frequency);
    }, 0);

    const yearlyTotal = monthlyTotal * 12;

    // Category breakdown
    const categoryMap: Record<string, { name: string; icon: string | null; color: string | null; count: number; monthly_total: number }> = {};
    for (const sub of activeFiltered) {
      const categoryName = getFirstLevelCategory(sub);
      if (!categoryMap[categoryName]) {
        categoryMap[categoryName] = {
          name: categoryName,
          icon: sub.category_icon,
          color: sub.category_color,
          count: 0,
          monthly_total: 0,
        };
      }
      const amount = sub.user_amount || sub.detected_amount || 0;
      const frequency = sub.user_frequency || sub.detected_frequency || 'monthly';
      categoryMap[categoryName].count++;
      categoryMap[categoryName].monthly_total += convertToMonthly(amount, frequency);
    }

    // Frequency breakdown
    const frequencyMap: Record<string, { frequency: SubscriptionFrequency; count: number; monthly_total: number }> = {};
    for (const sub of activeFiltered) {
      const frequency = (sub.user_frequency || sub.detected_frequency || 'monthly') as SubscriptionFrequency;
      if (!frequencyMap[frequency]) {
        frequencyMap[frequency] = { frequency, count: 0, monthly_total: 0 };
      }
      const amount = sub.user_amount || sub.detected_amount || 0;
      frequencyMap[frequency].count++;
      frequencyMap[frequency].monthly_total += convertToMonthly(amount, frequency);
    }

    return {
      total_count: filteredSubscriptions.length,
      active_count: activeFiltered.length,
      monthly_total: Math.round(monthlyTotal * 100) / 100,
      yearly_total: Math.round(yearlyTotal * 100) / 100,
      category_breakdown: Object.values(categoryMap).sort((a, b) => b.monthly_total - a.monthly_total),
      frequency_breakdown: Object.values(frequencyMap).sort((a, b) => b.monthly_total - a.monthly_total),
    };
  }, [summary, filteredSubscriptions, isFiltering]);

  return {
    availableCategories,
    isCategorySelected,
    toggleCategory,
    selectAll,
    deselectAll,
    isFiltering,
    filteredSubscriptions,
    filteredAlerts,
    filteredSummary,
  };
}
