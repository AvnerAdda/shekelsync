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

for (const mode of ['light', 'dark'] as const) {
  test(`net position renders a readable estimated range in ${mode} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.clock.setFixedTime(new Date('2026-09-23T12:00:00+03:00'));
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await setupRendererTest(page, {
      'GET /api/analytics/dashboard': async ({ route }) => route.fulfill({ json: {
        summary: { totalIncome: 1000, totalExpenses: 250, netBalance: 750, netInvestments: 0 },
        history: [{ date: '2026-09-23', income: 1000, expenses: 250, investments: 0 }],
        breakdowns: { byCategory: [], byVendor: [], byMonth: [] },
      } }),
      'GET /api/forecast/daily': async ({ route }) => route.fulfill({ json: {
        dailyForecasts: [
          { date: '2026-09-24', income: 0, expenses: 50, investments: 0, cashFlow: -50 },
          { date: '2026-09-25', income: 0, expenses: 100, investments: 0, cashFlow: -100 },
        ],
        predictionIntervals: { level: 0.8, daily: [
          { date: '2026-09-24', cumulativeCashFlow: { p10: -100, p50: -50, p90: 50 } },
          { date: '2026-09-25', cumulativeCashFlow: { p10: -250, p50: -150, p90: 100 } },
        ] },
      } }),
    });
    await goHome(page);
    if (mode === 'dark') await page.getByRole('button', { name: 'Switch to Dark Mode' }).click();
    await page.getByRole('button', { name: 'Net Position', exact: true }).click();
    const rangeLegend = page.getByText('Estimated range (P10–P90)', { exact: true });
    await expect(rangeLegend).toBeVisible();
    // Visibility alone allows transparent text. Check the actual paint colour.
    expect(await rangeLegend.evaluate(element => getComputedStyle(element).color)).not.toBe('rgba(0, 0, 0, 0)');
    const swatch = rangeLegend.locator('..').locator('svg [fill]').first();
    await expect(swatch).toBeVisible();
    await expect(swatch).not.toHaveAttribute('fill', 'transparent');
    const band = page.locator('.forecast-range-band path.recharts-area-area');
    await expect(band).toBeVisible();
    await expect(band).toHaveAttribute('d', /^M/);
    await expect(band).toHaveAttribute('fill-opacity', mode === 'dark' ? '0.24' : '0.16');
    await expect(band).not.toHaveAttribute('fill', 'transparent');
    expect(await band.getAttribute('d')).not.toContain('NaN');
    // A degenerate bridge point alone must not satisfy the visible range check.
    await expect.poll(async () => (await band.boundingBox())?.height || 0).toBeGreaterThan(50);
    await expect(page.getByText(/experimental/i)).toHaveCount(0);
    await page.screenshot({ path: `/tmp/shekelsync-forecast-range-${mode}.png`, fullPage: true });
    expect(pageErrors).toEqual([]);
  });
}

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
  await expect(page.getByText('Each amount below contributes to the chart total. Payment dates are estimates; everyday spending is shown as a daily average.', { exact: true })).toBeVisible();

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
  await expect(expenses.getByText('Estimated date', { exact: true })).toHaveCount(6);
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

const tieredPredictions = [
  { category: 'Groceries', category_name: 'Groceries', amount: 300, probability: 1, probabilityWeightedAmount: 300,
    timingBasis: 'daily_average', confidenceTier: 'uncertain', amountRange: { low: 200, high: 400 } },
  { transactionName: 'Electricity', amount: 600, probability: 1, probabilityWeightedAmount: 600,
    timingBasis: 'estimated', confidenceTier: 'likely', amountRange: { low: 450, high: 750 } },
  { transactionName: 'Sofa installment', amount: 500, probability: 1, probabilityWeightedAmount: 500,
    timingBasis: 'scheduled', confidenceTier: 'sure', amountRange: { low: 500, high: 500 } },
].map((prediction, index) => ({ ...prediction, occurrenceId: `tiered-${index + 1}`, categoryType: 'expense' }));

for (const mode of ['light', 'dark'] as const) {
  test(`forecast bars separate sure, likely and uncertain amounts in ${mode} mode`, async ({ page }) => {
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
          date: '2026-09-24', income: 0, expenses: 1430, investments: 0, cashFlow: -1430,
          confidenceBreakdown: {
            income: { sure: 0, likely: 0, uncertain: 0 },
            expenses: { sure: 500, likely: 600, uncertain: 330 },
            investments: { sure: 0, likely: 0, uncertain: 0 },
          },
          predictions: tieredPredictions, topPredictions: tieredPredictions,
        }],
      } }),
    });
    await goHome(page);
    if (mode === 'dark') await page.getByRole('button', { name: 'Switch to Dark Mode' }).click();
    const chart = page.locator('.recharts-wrapper').filter({ has: page.locator('.recharts-bar') }).first();
    await chart.scrollIntoViewIfNeeded();
    const segments = chart.locator('.recharts-bar-rectangle .recharts-rectangle[stroke-dasharray]').filter({ visible: true });
    await expect(segments).toHaveCount(3);
    const fills = await segments.evaluateAll(nodes => nodes.map(node => node.getAttribute('fill')));
    expect(new Set(fills).size).toBe(3);
    for (const tier of ['Sure', 'Likely', 'Uncertain']) {
      const label = chart.getByText(tier, { exact: true });
      await expect(label).toBeVisible();
      expect(await label.evaluate(element => getComputedStyle(element).color)).not.toBe('rgba(0, 0, 0, 0)');
    }

    // The logarithmic axis keeps the same three segments, sized by tier share.
    await page.locator('button[value="log"]').click();
    await expect(segments).toHaveCount(3);
    expect(new Set(await segments.evaluateAll(nodes => nodes.map(node => node.getAttribute('fill')))).size).toBe(3);

    await segments.first().hover();
    const tooltip = chart.locator('.recharts-tooltip-wrapper');
    await expect(tooltip).toContainText('Expenses: ₪1,430.00');
    await expect(tooltip).toContainText('Sure ₪500.00 · Likely ₪600.00 · Uncertain ₪330.00');

    await segments.first().click();
    const expenses = page.getByRole('region', { name: 'Expenses', exact: true });
    await expect(expenses.getByText('Sure', { exact: true })).toBeVisible();
    await expect(expenses.getByText('Likely', { exact: true })).toBeVisible();
    await expect(expenses.getByText('Uncertain', { exact: true })).toBeVisible();
    await expect(expenses.getByText(/Usually ₪450\.00–₪750\.00/)).toBeVisible();
    await page.screenshot({ path: `/tmp/shekelsync-forecast-tiers-${mode}.png`, fullPage: true });
    expect(pageErrors).toEqual([]);
  });
}
