import { expect, test } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

const predictions = [
  { transactionName: 'Public transport', amount: 106, probability: 1, probabilityWeightedAmount: 106 },
  { transactionName: 'Partner communications', amount: 204, probability: 0.97, probabilityWeightedAmount: 197.88 },
  { transactionName: 'PAYBOX TEL AVIV IL', amount: 80, probability: 0.86, probabilityWeightedAmount: 68.8 },
  { transactionName: 'Hairdresser', amount: 110, probability: 0.83, probabilityWeightedAmount: 91.3 },
  { transactionName: 'Pango Moovit', amount: 126, probability: 0.56, probabilityWeightedAmount: 70.56 },
  { transactionName: 'Additional forecast purchase', amount: 2261.15, probability: 0.4, probabilityWeightedAmount: 904.46 },
].map((prediction, index) => ({
  ...prediction,
  occurrenceId: `forecast-${index + 1}`,
  categoryType: 'expense',
  category_name: 'Expenses',
}));

test('forecast bar tooltip reconciles with every probability-weighted transaction', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.clock.setFixedTime(new Date('2026-09-23T12:00:00+03:00'));
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await setupRendererTest(page, {
    'GET /api/analytics/dashboard': async ({ route }) => route.fulfill({ json: {
      summary: { totalIncome: 2000, totalExpenses: 300, netBalance: 1700, netInvestments: 0 },
      history: [{ date: '2026-09-23', income: 2000, expenses: 300, investments: 0 }],
      breakdowns: { byCategory: [], byVendor: [], byMonth: [] },
    } }),
    'GET /api/forecast/daily': async ({ route }) => route.fulfill({ json: {
      dailyForecasts: [{
        date: '2026-09-24', income: 0, expenses: 1439, investments: 0, cashFlow: -1439,
        predictions, topPredictions: predictions.slice(0, 5),
      }],
    } }),
  });
  await goHome(page);
  const chart = page.locator('.recharts-wrapper').filter({ has: page.locator('.recharts-bar') }).first();
  await expect(chart).toBeVisible();
  await chart.scrollIntoViewIfNeeded();
  const forecastBar = chart.locator('.recharts-bar-rectangle .recharts-rectangle[stroke-dasharray]')
    .filter({ visible: true });
  await expect(forecastBar).toHaveCount(1);
  await forecastBar.hover();
  const tooltip = chart.locator('.recharts-tooltip-wrapper');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Sep 24, 2026');
  await expect(tooltip).toContainText('Expenses: ₪1,439.00');

  await forecastBar.click();
  await expect(page.getByText('Predicted transactions on Sep 24, 2026 (6)', { exact: true })).toBeVisible();
  const expenses = page.getByRole('region', { name: 'Expenses', exact: true });
  await expect(expenses.getByText('₪1,439.00', { exact: true })).toBeVisible();
  await expect(expenses.getByText('Included in forecast', { exact: true })).toHaveCount(6);
  await expect(page.getByText('Each amount below is its contribution to the chart total, weighted by probability. Estimated transaction amounts are shown separately.', { exact: true })).toBeVisible();

  const contributionAmounts = await expenses.getByText('Included in forecast', { exact: true })
    .evaluateAll(labels => labels.map(label => Number(label.previousElementSibling?.textContent?.replace(/[^\d.-]/g, ''))));
  expect(contributionAmounts).toEqual([106, 197.88, 68.8, 91.3, 70.56, 904.46]);
  expect(contributionAmounts.reduce((total, amount) => total + Math.round(amount * 100), 0)).toBe(143900);
  await expect(expenses.getByText('Estimated transaction: ₪204.00', { exact: true })).toBeVisible();
  await expect(expenses.getByText('₪197.88', { exact: true })).toBeVisible();
  await expenses.getByText('₪1,439.00', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/shekelsync-forecast-details.png', fullPage: true });
  await expenses.getByText('Additional forecast purchase', { exact: true }).scrollIntoViewIfNeeded();
  await expect(expenses.getByText('Additional forecast purchase', { exact: true })).toBeVisible();
  await expect(expenses.getByText('40% probability', { exact: true })).toBeVisible();
  await expect(expenses.getByText('Estimated transaction: ₪2,261.15', { exact: true })).toBeVisible();
  await expect(expenses.getByText('₪904.46', { exact: true })).toBeVisible();
  await expect(expenses.getByText('Other forecast contributions', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/shekelsync-forecast-details-additional.png', fullPage: true });
  expect(pageErrors).toEqual([]);
});

for (const period of [
  { aggregation: 'weekly', button: 'Weekly', anchor: '2026-08-31', endDay: '06', tooltipDate: 'Aug 31, 2026' },
  { aggregation: 'monthly', button: 'Monthly', anchor: '2026-09-01', endDay: '23', tooltipDate: 'Sep 01, 2026' },
]) {
  test(`${period.aggregation} bar opens every transaction across the selected portion of the period`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.clock.setFixedTime(new Date('2026-09-23T12:00:00+03:00'));
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const endDate = `2026-09-${period.endDay}`;
    const transactions = Array.from({ length: 125 }, (_, index) => ({
      identifier: `${period.aggregation}-${index + 1}`,
      description: `${period.aggregation} transaction ${String(index + 1).padStart(3, '0')}`,
      vendor: 'test-vendor',
      price: -1,
      date: `${index === 124 ? endDate : '2026-09-01'}T12:00:00`,
      category_name: 'Expenses',
      category_type: 'expense',
    }));
    await setupRendererTest(page, {
      'GET /api/analytics/dashboard': async ({ route, url }) => route.fulfill({ json: {
        summary: { totalIncome: 0, totalExpenses: 125, netBalance: -125, netInvestments: 0 },
        history: [{
          date: url.searchParams.get('aggregation') === period.aggregation ? period.anchor : '2026-09-23',
          income: 0, expenses: 125, investments: 0,
        }],
        breakdowns: { byCategory: [], byVendor: [], byMonth: [] },
      } }),
      'GET /api/forecast/daily': async ({ route }) => route.fulfill({ json: { dailyForecasts: [] } }),
      'GET /api/analytics/transactions-by-date': async ({ route, url }) => route.fulfill({ json: {
        transactions: url.searchParams.get('startDate') === '2026-09-01'
          && url.searchParams.get('endDate') === endDate ? transactions : [],
      } }),
    });
    await goHome(page);
    const aggregationResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/analytics/dashboard' && url.searchParams.get('aggregation') === period.aggregation;
    });
    await page.getByRole('button', { name: period.button, exact: true }).click();
    await aggregationResponse;
    const chart = page.locator('.recharts-wrapper').filter({ has: page.locator('.recharts-bar') }).first();
    await chart.scrollIntoViewIfNeeded();
    const bar = chart.locator('.recharts-bar-rectangle .recharts-rectangle').filter({ visible: true });
    await expect(bar).toHaveCount(1);
    await bar.hover();
    const tooltip = chart.locator('.recharts-tooltip-wrapper');
    await expect(tooltip).toContainText(period.tooltipDate);
    await expect(tooltip).toContainText('Expenses: ₪125');

    const rangeRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/analytics/transactions-by-date');
    await bar.click();
    expect(new URL((await rangeRequest).url()).search).toBe(`?startDate=2026-09-01&endDate=${endDate}`);
    await expect(page.getByText(`Transactions from Sep 01, 2026 to Sep ${period.endDay}, 2026 (125)`, { exact: true })).toBeVisible();
    await expect(page.getByText(new RegExp(`^${period.aggregation} transaction \\d{3}$`))).toHaveCount(125);
    await expect(page.getByText(`${period.aggregation} transaction 001`, { exact: true })).toBeVisible();
    await expect(page.getByText('Sep 01, 2026 · 12:00', { exact: true }).first()).toBeVisible();
    await page.getByText(`${period.aggregation} transaction 125`, { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByText(`${period.aggregation} transaction 125`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Sep ${period.endDay}, 2026 · 12:00`, { exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
}
