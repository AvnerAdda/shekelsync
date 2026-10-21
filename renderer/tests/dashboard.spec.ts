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

test('first dashboard chart overlays rolling daily averages on the main scale and can hide them', async ({ page }) => {
  const requests: URL[] = [];
  await setupRendererTest(page, {
    'GET /api/analytics/dashboard': async ({ route, url }) => {
      requests.push(url);
      const end = new Date();
      const history = Array.from({ length: 60 }, (_, index) => {
        const date = new Date(end);
        date.setDate(date.getDate() - 59 + index);
        return { date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
          income: index % 10 === 0 ? 2000 : 0, expenses: 100 + index, investments: index % 7 === 0 ? -200 : 50 };
      }).filter(row => row.date >= url.searchParams.get('startDate')!.slice(0, 10)
        && row.date <= url.searchParams.get('endDate')!.slice(0, 10));
      await route.fulfill(jsonResponse({ ...dashboardPayload, history }));
    },
  });
  await goHome(page);
  await page.getByRole('button', { name: '30D', exact: true }).click();
  const chart = page.locator('.recharts-wrapper').filter({ hasText: 'Income · 30-day daily average' });
  await expect(chart).toBeVisible();
  await expect(chart.locator('.recharts-line-curve')).toHaveCount(3);
  await expect(chart.locator('.recharts-yAxis')).toHaveCount(1);
  await expect.poll(() => requests.some(url => url.searchParams.get('includeSummary') === '0'
    && url.searchParams.get('aggregation') === 'daily'
    && url.searchParams.get('includeChartBreakdowns') === '0')).toBe(true);
  await chart.scrollIntoViewIfNeeded();
  await chart.screenshot({ path: '/tmp/shekelsync-rolling-averages.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Chart options', exact: true }).click();
  const rollingRequestCount = requests.filter(url => url.searchParams.get('includeChartBreakdowns') === '0').length;
  await page.getByRole('switch', { name: 'Show 30-day daily averages', exact: true }).uncheck();
  await expect(chart).toHaveCount(0);
  await page.getByRole('switch', { name: 'Show 30-day daily averages', exact: true }).check();
  await expect(chart.locator('.recharts-line-curve')).toHaveCount(3);
  expect(requests.filter(url => url.searchParams.get('includeChartBreakdowns') === '0')).toHaveLength(rollingRequestCount);
});

test('dashboard shows loading state then formatted summary values', async ({ page }) => {
  // On the 30th, MTD and 30D are identical and cached breakdowns need no refetch.
  await page.clock.setFixedTime(new Date('2026-09-23T12:00:00+03:00'));
  const dashboardRequests: URL[] = [];
  const waterfallRequests: URL[] = [];
  const breakdownRequests: URL[] = [];
  const overrides: Record<string, Handler> = {
    'GET /api/analytics/dashboard': async ({ route, url }) => {
      // Rolling overlays request their own lookback, separate from summary filters.
      if (url.searchParams.get('includeSummary') !== '0') dashboardRequests.push(url);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill(jsonResponse(dashboardPayload));
    },
    'GET /api/analytics/waterfall-flow': async ({ route, url }) => {
      waterfallRequests.push(url);
      await route.fulfill(jsonResponse(waterfallPayload));
    },
    'GET /api/analytics/breakdown': async ({ route, url }) => {
      breakdownRequests.push(url);
      await route.fulfill(jsonResponse({
        breakdowns: { byCategory: [], byVendor: [], byMonth: [] },
        summary: { total: 0, count: 0, average: 0, min: 0, max: 0 },
      }));
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

  await expect(
    page.locator('[data-dashboard-summary-card="finance"]').getByText('MTD', { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-dashboard-period-selector="true"]')).toHaveCount(1);
  await expect(page.getByText('Income', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('+₪12,000', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Expenses', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('-₪6,800', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Investments', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('-₪1,000', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('₪4,200', { exact: true }).first()).toBeVisible();

  dashboardRequests.length = 0;
  waterfallRequests.length = 0;
  breakdownRequests.length = 0;
  await page.getByRole('button', { name: '30D' }).click();

  await expect.poll(() => dashboardRequests.length).toBeGreaterThan(0);
  await expect.poll(() => waterfallRequests.length).toBeGreaterThan(0);
  await expect.poll(() => breakdownRequests.length).toBeGreaterThan(0);

  const latestRange = (requests: URL[]) => {
    const request = requests.at(-1);
    return {
      startDate: request?.searchParams.get('startDate'),
      endDate: request?.searchParams.get('endDate'),
    };
  };
  const dashboardRange = latestRange(dashboardRequests);

  expect(latestRange(waterfallRequests)).toEqual(dashboardRange);
  expect(latestRange(breakdownRequests)).toEqual(dashboardRange);
  await expect(
    page.locator('[data-dashboard-summary-card="finance"]').getByText('30D', { exact: true }),
  ).toBeVisible();
});
