import { expect, test } from '@playwright/test';
import { goHome, setupRendererTest } from './helpers/renderer-app';

const details = [
  { categoryId: 1, categoryName: 'Salary', vendor: 'discount', income: 1000, expenses: 0, investments: 0 },
  { categoryId: 2, categoryName: 'Bonus', vendor: 'leumi', income: 200, expenses: 0, investments: 0 },
  { categoryId: 3, categoryName: 'Groceries', vendor: 'isracard', income: 0, expenses: 120, investments: 0 },
  { categoryId: 4, categoryName: 'Transport', vendor: 'max', income: 0, expenses: 180, investments: 0 },
  { categoryId: 5, categoryName: 'Funds', vendor: 'discount', income: 0, expenses: 0, investments: 200 },
  { categoryId: 6, categoryName: 'Withdrawal', vendor: 'leumi', income: 0, expenses: 0, investments: -50 },
];

test('real Recharts split bars preserve three separate signed stacks', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.clock.setFixedTime(new Date('2026-09-17T12:00:00+03:00'));
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await setupRendererTest(page, {
    'GET /api/analytics/dashboard': async ({ route }) => route.fulfill({ json: {
      summary: { totalIncome: 1200, totalExpenses: 300, netBalance: 900, netInvestments: 150, investmentOutflow: 200, investmentInflow: 50 },
      history: [{ date: '2026-09-17', income: 1200, expenses: 300, investments: 150, chartBreakdown: details }],
      breakdowns: { byCategory: [], byVendor: [], byMonth: [] },
    } }),
    'GET /api/forecast/daily': async ({ route }) => route.fulfill({ json: {
      dailyForecasts: [{ date: '2026-09-18', income: 1200, expenses: 300, investments: 150,
        cashFlow: 750, chartBreakdown: details }],
    } }),
  });
  await goHome(page);
  const chartOptions = page.getByRole('button', { name: 'Chart options', exact: true });
  await chartOptions.scrollIntoViewIfNeeded();
  await chartOptions.click();
  await page.getByRole('button', { name: 'Subcategories', exact: true }).click();
  await page.keyboard.press('Escape');
  const chart = page.locator('.recharts-wrapper').filter({ has: page.locator('.recharts-bar') }).first();
  await expect(chart).toBeVisible();
  const rectangles = () => chart.locator('.recharts-bar-rectangle .recharts-rectangle').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, fill: element.getAttribute('fill'), dash: element.getAttribute('stroke-dasharray') };
  }).filter(box => box.height > 0 && box.width > 0));
  await expect.poll(async () => (await rectangles()).length).toBe(12);
  const categoryRectangles = await rectangles();
  const columns = [...new Set(categoryRectangles.map(rectangle => Math.round(rectangle.x * 100) / 100))].sort((a, b) => a - b);
  expect(columns).toHaveLength(6);
  for (const column of columns) {
    expect(categoryRectangles.filter(rectangle => Math.abs(rectangle.x - column) < 0.01)).toHaveLength(2);
  }
  const actualInvestment = categoryRectangles.filter(rectangle => Math.abs(rectangle.x - columns[2]) < 0.01).sort((a, b) => a.y - b.y);
  expect(actualInvestment[0].y + actualInvestment[0].height).toBeCloseTo(actualInvestment[1].y, 1);
  expect(categoryRectangles.filter(rectangle => rectangle.dash)).toHaveLength(6);
  await page.mouse.move(categoryRectangles[2].x + 10, categoryRectangles[2].y + 10);
  const tooltip = chart.locator('.recharts-tooltip-wrapper');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Groceries');
  await expect(tooltip).toContainText('₪120');
  await expect(tooltip).toContainText('Withdrawal');
  await expect(tooltip).toContainText('-₪50');
  await expect(tooltip).toContainText('Investments: ₪150');
  await page.screenshot({ path: '/tmp/shekelsync-split-subcategories.png', fullPage: true });

  await chartOptions.click();
  await page.getByRole('button', { name: 'Vendor', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await rectangles()).length).toBe(12);
  const vendorRectangles = await rectangles();
  expect(new Set(vendorRectangles.map(rectangle => Math.round(rectangle.x * 100) / 100)).size).toBe(6);
  await page.mouse.move(vendorRectangles[2].x + 10, vendorRectangles[2].y + 10);
  await expect(tooltip).toContainText('isracard');
  await expect(tooltip).toContainText('max');
  await expect(tooltip).toContainText('discount');
  await expect(tooltip).toContainText('leumi');
  await page.screenshot({ path: '/tmp/shekelsync-split-vendors.png', fullPage: true });
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  console.log(JSON.stringify({ columns, categoryRectangles, pageErrors, consoleErrors }));
});
