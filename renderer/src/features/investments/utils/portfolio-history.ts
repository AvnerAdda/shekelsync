import type { PortfolioHistoryPoint, PortfolioSummary } from '@renderer/types/investments';
import { getOrderedPortfolioAccounts } from './portfolio-categories';

export interface StackedPortfolioHistoryDataPoint {
  date: string;
  fullDate: string;
  [accountId: string]: string | number;
}

function toDateKey(value: string): string {
  return value.split('T')[0];
}

export function buildStackedPortfolioHistoryData(
  portfolio: PortfolioSummary | null,
  accountHistories: Record<number, PortfolioHistoryPoint[]>,
): {
  orderedAccounts: Array<{ id: number; account_name: string }>;
  sortedDates: string[];
  data: StackedPortfolioHistoryDataPoint[];
} {
  if (!portfolio) {
    return { orderedAccounts: [], sortedDates: [], data: [] };
  }

  const orderedAccounts = getOrderedPortfolioAccounts(portfolio).map((account) => ({
    id: Number(account.id),
    account_name: account.account_name,
  }));

  const allDates = new Set<string>();
  const historyMaps = new Map<number, Map<string, number>>();

  orderedAccounts.forEach((account) => {
    const history = Array.isArray(accountHistories[account.id]) ? accountHistories[account.id] : [];
    const valueByDate = new Map<string, number>();

    history.forEach((point) => {
      const dateKey = toDateKey(point.date);
      allDates.add(dateKey);
      valueByDate.set(dateKey, Number(point.currentValue) || 0);
    });

    historyMaps.set(account.id, valueByDate);
  });

  const sortedDates = Array.from(allDates).sort((left, right) => left.localeCompare(right));
  const lastKnownValues = new Map<number, number>();

  const data = sortedDates.map((dateKey) => {
    const point: StackedPortfolioHistoryDataPoint = {
      date: new Date(dateKey).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: sortedDates.length > 90 ? '2-digit' : undefined,
      }),
      fullDate: dateKey,
    };

    orderedAccounts.forEach((account) => {
      const valueByDate = historyMaps.get(account.id);
      if (valueByDate?.has(dateKey)) {
        lastKnownValues.set(account.id, valueByDate.get(dateKey) || 0);
      }

      point[String(account.id)] = lastKnownValues.get(account.id) || 0;
    });

    return point;
  });

  return { orderedAccounts, sortedDates, data };
}
