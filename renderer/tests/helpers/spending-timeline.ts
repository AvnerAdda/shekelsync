import type { Page } from '@playwright/test';
import { setupRendererTest } from './renderer-app';
import type { SpendingCategory, SpendingTimelineResponse } from '../../src/types/spending-categories';

export function dateAfter(days: number) {
  const date = new Date(); date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export async function setupSpendingTimeline(page: Page) {
  const state = { targets: { essential: 50, growth: 20, stability: 15, reward: 15 } as Record<SpendingCategory, number>, rollingRequests: [] as number[], timelineRequests: [] as URL[], details: [] as URL[] };
  const json = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  await setupRendererTest(page, {
    'GET /api/spending-categories/timeline': async ({ route, url }) => {
      const rolling = Number(url.searchParams.get('rollingDays')) || 30;
      const start = url.searchParams.get('startDate');
      const end = url.searchParams.get('endDate') || dateAfter(0);
      const history = start ? Math.round((new Date(`${end}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / 86400000) + 1
        : Number(url.searchParams.get('historyDays')) || 90;
      state.rollingRequests.push(rolling);
      state.timelineRequests.push(url);
      const data: SpendingTimelineResponse = {
        period: { start: shiftDate(end, 1 - history), end, history_start: shiftDate(end, 2 - history - rolling), rolling_days: rolling },
        targets: { ...state.targets }, categories_by_allocation: { essential: [], growth: [], stability: [], reward: [], unallocated: [] },
        points: Array.from({ length: history }, (_, i) => {
          const offset = i + 1 - history;
          const essential = offset === 0 ? 8000 : offset === -1 ? 3000 : 3000 + (i % 17) * 200;
          const expenseAmounts = { essential, growth: 1000, stability: 1000, reward: offset === 0 ? 2000 : 1000, unallocated: 0 };
          const expenses = Object.values(expenseAmounts).reduce((sum, value) => sum + value, 0);
          const surplus = Math.max(0, 10000 - expenses);
          const allocationAmounts = { ...expenseAmounts, growth: expenseAmounts.growth + surplus };
          return { date: shiftDate(end, offset), window_start: shiftDate(end, offset + 1 - rolling), income: 10000,
            expenses, net: 10000 - expenses, surplus, deficit: Math.max(0, expenses - 10000), has_income: true,
            expense_amounts: expenseAmounts, allocation_amounts: allocationAmounts,
            percentages: Object.fromEntries(Object.entries(allocationAmounts).map(([key, value]) => [key, value / 100])) as typeof allocationAmounts,
            transaction_counts: { essential: 1, growth: 1, stability: 1, reward: 1, unallocated: 0 } };
        }),
      };
      await route.fulfill(json(data));
    },
    'PUT /api/spending-categories/targets': async ({ route, request }) => {
      state.targets = request.postDataJSON(); await route.fulfill(json({ success: true, targets: state.targets }));
    },
    'GET /api/spending-categories/timeline/transactions': async ({ route, url }) => {
      state.details.push(url);
      await route.fulfill(json({ period: { start: url.searchParams.get('startDate'), end: url.searchParams.get('endDate') },
        spending_category: url.searchParams.get('spendingCategory'), transactions: [], total_count: 0, total_amount: 0, limit: 500, offset: 0 }));
    },
  });
  return state;
}

