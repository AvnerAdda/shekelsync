import { expect, test } from '@playwright/test';
import { openAnalysisPage, setupRendererTest } from './helpers/renderer-app';
import en from '../src/i18n/locales/en.json' with { type: 'json' };

const labels = en.analysisPage;
const outlook = {
  modelId: 'pattern-v5', truthRevision: 4, hasCurrentBalance: true, startingBalance: 1000,
  forecastPeriod: { start: '2026-10-02', end: '2027-04-01' },
  combinedData: [
    { date: '2026-04-01', historicalCumulative: 800, expectedCumulative: null, p10Cumulative: null, p90Cumulative: null },
    { date: '2026-10-01', historicalCumulative: 1000, expectedCumulative: 1000, p10Cumulative: 1000, p90Cumulative: 1000 },
    { date: '2026-12-01', historicalCumulative: null, expectedCumulative: 1070, p10Cumulative: 990, p90Cumulative: 1120 },
    { date: '2027-04-01', historicalCumulative: null, expectedCumulative: 1020, p10Cumulative: 940, p90Cumulative: 1090 },
  ],
  summaries: {
    pessimistic: { netCashFlow: -60, endingBalance: 940 },
    base: { income: 100, expenses: 80, netCashFlow: 20, endingBalance: 1020 },
    optimistic: { netCashFlow: 90, endingBalance: 1090 },
  },
  expenseDrivers: [
    { categoryDefinitionId: 2, category: 'Utilities', categoryNameEn: 'Utilities', amount: 40, scheduled: 40, typical: 0, occasional: 0 },
    { categoryDefinitionId: 3, category: 'Repairs', categoryNameEn: 'Repairs', amount: 40, scheduled: 0, typical: 0, occasional: 40 },
  ],
  incomeDrivers: [{ source: 'Deloitte payroll', amount: 100, nextDate: '2026-10-02', expectedPaymentDate: '2026-10-01', awaitingReceipt: true }],
};

for (const width of [1312, 390]) {
  test(`cash-flow outlook agrees with its dashboard preview at ${width}px`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 1000 });
    await page.clock.setFixedTime(new Date('2026-10-01T12:00:00+03:00'));
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    let refreshes = 0;
    await setupRendererTest(page, {
      'GET /api/analytics/forecast-extended': async ({ route, url }) => {
        if (url.searchParams.get('noCache') === 'true') refreshes++;
        await route.fulfill({ json: outlook });
      },
    });
    if (width < 600) {
      await page.goto('/#/plan', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await expect(page.getByRole('heading', { name: 'Financial Analysis' })).toBeVisible();
    } else {
      await openAnalysisPage(page, 'route');
    }
    const preview = page.getByText(labels.dashboard.future.title, { exact: true }).locator('..').locator('..').locator('..');
    await expect(preview.getByText('₪1,020', { exact: true })).toBeVisible();
    await expect(preview.getByText(labels.dashboard.future.baseCase, { exact: true })).toBeVisible();
    await preview.getByRole('button', { name: labels.dashboard.expandView, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('forecast-closing-base')).toHaveText(/1,020/);
    await expect(dialog.getByTestId('forecast-closing-pessimistic')).toHaveText(/940/);
    await expect(dialog.getByTestId('forecast-closing-optimistic')).toHaveText(/1,090/);
    await expect(dialog.getByText(/Through Apr 1, 2027/)).toBeVisible();
    const band = dialog.locator('.recharts-area-area');
    await expect(band).toBeVisible();
    await expect(band).toHaveAttribute('d', /^M/);
    expect(await band.getAttribute('d')).not.toContain('NaN');
    await expect.poll(async () => (await band.boundingBox())?.height || 0).toBeGreaterThan(40);
    await expect(dialog.getByText(/only 10%|most likely|experimental/i)).toHaveCount(0);
    const incomeTable = dialog.getByRole('table', { name: labels.modals.future.incomeSources.title });
    await incomeTable.scrollIntoViewIfNeeded();
    await expect(incomeTable.getByText('Deloitte payroll')).toBeVisible();
    await expect(incomeTable.getByText(/Awaiting receipt/)).toBeVisible();
    const table = dialog.getByRole('table', { name: labels.modals.future.drivers.title });
    await table.scrollIntoViewIfNeeded();
    await expect(table.getByText(labels.modals.future.drivers.occasional)).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByRole('button', { name: labels.modals.future.refresh }).click();
    await expect.poll(() => refreshes).toBeGreaterThan(0);
    await expect(dialog.getByTestId('forecast-closing-base')).toHaveText(/1,020/);
    await dialog.getByTestId('forecast-closing-base').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/shekelsync-cash-flow-outlook-${width}.png` });
    await dialog.getByRole('link', { name: labels.modals.future.reviewAssumptions }).click();
    await expect(page).toHaveURL(/#\/review/);
    expect(pageErrors).toEqual([]);
  });
}
