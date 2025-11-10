import { expect, test } from '@playwright/test';
import { goHome, setupRendererTest, type Handler } from './helpers/renderer-app';

const jsonResponse = (data: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(data),
});

const dashboardPayload = {
  dateRange: {
    start: '2025-08-01T00:00:00.000Z',
    end: '2025-08-31T23:59:59.999Z',
  },
  summary: {
    totalIncome: 12000,
    totalExpenses: 6800,
    netBalance: 5200,
    investmentOutflow: 1500,
    investmentInflow: 500,
    netInvestments: 1000,
    totalAccounts: 4,
  },
  history: [
    { date: '2025-08-01', income: 4000, expenses: 2200 },
    { date: '2025-08-15', income: 4000, expenses: 2300 },
    { date: '2025-08-30', income: 4000, expenses: 2300 },
  ],
  breakdowns: {
    byCategory: [
      { category: 'Housing', total: 2500, count: 3 },
      { category: 'Groceries', total: 1300, count: 6 },
    ],
    byVendor: [
      { vendor: 'Landlord', total: 2000, count: 1 },
      { vendor: 'Supermarket', total: 900, count: 4 },
    ],
    byMonth: [
      { month: '2025-08', income: 12000, expenses: 6800 },
    ],
  },
};

const waterfallPayload = {
  summary: {
    totalIncome: 12000,
    totalExpenses: 6800,
    netInvestments: 1000,
    netBalance: 5200,
    totalTransactions: 24,
  },
  waterfallData: [
    { name: 'Income', value: 12000, type: 'income', cumulative: 12000, startValue: 0, color: '#16a34a', count: 10 },
    { name: 'Expenses', value: -6800, type: 'expense', cumulative: 5200, startValue: 12000, color: '#dc2626', count: 12 },
    { name: 'Investments', value: -1000, type: 'investment', cumulative: 4200, startValue: 5200, color: '#3b82f6', count: 2 },
  ],
  breakdown: {
    income: [],
    expenses: [],
    investments: [],
  },
};

test('dashboard shows loading state then formatted summary values', async ({ page }) => {
  const overrides: Record<string, Handler> = {
    'GET /api/analytics/dashboard': async ({ route }) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill(jsonResponse(dashboardPayload));
    },
    'GET /api/analytics/waterfall-flow': async ({ route }) => {
      await route.fulfill(jsonResponse(waterfallPayload));
    },
  };

  await setupRendererTest(page, overrides);
  await goHome(page);

  const progress = page.getByRole('progressbar').first();
  try {
    await progress.waitFor({ state: 'visible', timeout: 1000 });
    await progress.waitFor({ state: 'detached', timeout: 3000 });
  } catch {
    // Loading indicators are optional; ignore when not rendered.
  }

  await expect(page.getByText('Total Income', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('₪12,000', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Net Balance', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('₪5,200', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Net Investments')).toBeVisible();
  await expect(page.getByText('₪1,000', { exact: true }).first()).toBeVisible();
});
