import { test, expect, type Page } from '@playwright/test';
import { setupRendererTest } from './helpers/renderer-app';
import en from '../src/i18n/locales/en.json' with { type: 'json' };
import he from '../src/i18n/locales/he.json' with { type: 'json' };
import type { SpendingCategory, SpendingTimelineResponse } from '../src/types/spending-categories';

const labels = en.analysisPage.spendingChart;
function dateAfter(days: number) {
  const date = new Date(); date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
async function fixture(page: Page) {
  const state = { targets: { essential: 50, growth: 20, stability: 15, reward: 15 } as Record<SpendingCategory, number>, rollingRequests: [] as number[], details: [] as URL[] };
  const json = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  await setupRendererTest(page, {
    'GET /api/spending-categories/timeline': async ({ route, url }) => {
      const rolling = Number(url.searchParams.get('rollingDays')) || 30;
      const history = Number(url.searchParams.get('historyDays')) || 90;
      state.rollingRequests.push(rolling);
      const data: SpendingTimelineResponse = {
        period: { start: dateAfter(1 - history), end: dateAfter(0), history_start: dateAfter(2 - history - rolling), rolling_days: rolling },
        targets: { ...state.targets }, categories_by_allocation: { essential: [], growth: [], stability: [], reward: [], unallocated: [] },
        points: Array.from({ length: history }, (_, i) => {
          const offset = i + 1 - history;
          const essential = offset === 0 ? 8000 : offset === -1 ? 3000 : 3000 + (i % 17) * 200;
          const expenseAmounts = { essential, growth: 1000, stability: 1000, reward: offset === 0 ? 2000 : 1000, unallocated: 0 };
          const expenses = Object.values(expenseAmounts).reduce((sum, value) => sum + value, 0);
          const surplus = Math.max(0, 10000 - expenses);
          const allocationAmounts = { ...expenseAmounts, growth: expenseAmounts.growth + surplus };
          return { date: dateAfter(offset), window_start: dateAfter(offset + 1 - rolling), income: 10000,
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

test('stacked time series preserves overspending and selects the exact window for details', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/#/plan?tab=spending');
  const chart = page.getByTestId('spending-timeline');
  await expect(chart).toBeVisible();
  await expect(chart.locator('.recharts-area')).toHaveCount(5);
  await expect(chart.getByText(labels.timeline.timeAxis, { exact: true })).toBeVisible();
  await expect(chart.getByText('125%', { exact: true })).toBeVisible();
  await expect(page.getByTestId('spending-summary-deficit')).toContainText('-₪2,000');
  await expect(page.getByTestId('target-line-essential')).toHaveAttribute('data-percentage', '50');
  await expect(page.getByTestId('target-line-growth')).toHaveAttribute('data-percentage', '70');
  await page.getByLabel(labels.timeline.inspectDate).fill(dateAfter(-1));
  await expect(page.getByTestId('spending-summary-growthRemainder')).toContainText('+₪4,000');
  const growthCard = page.getByRole('button', { name: 'View Growth transactions', exact: true });
  await expect(growthCard).toContainText('50.0%');
  await expect(growthCard).toContainText('₪5,000');
  await expect(growthCard).toContainText('Growth expenses₪1,000');
  await expect(growthCard).toContainText('Unspent income₪4,000');
  await page.getByRole('button', { name: 'View Growth transactions', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(state.details.at(-1)?.searchParams.get('startDate')).toBe(dateAfter(-30));
  expect(state.details.at(-1)?.searchParams.get('endDate')).toBe(dateAfter(-1));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '60 days', exact: true }).click();
  await expect.poll(() => state.rollingRequests.at(-1)).toBe(60);
  await expect(page.getByText(labels.timeline.subtitle.replace('{{days}}', '60'))).toBeVisible();
  await chart.scrollIntoViewIfNeeded();
  const chartBox = await chart.boundingBox();
  const targetLine = await page.getByTestId('target-line-essential').boundingBox();
  await chart.click({ position: { x: targetLine!.x - chartBox!.x + 20, y: targetLine!.y - chartBox!.y } });
  await expect.poll(async () => page.getByLabel(labels.timeline.inspectDate).inputValue()).not.toBe(dateAfter(-1));
  expect((await page.getByLabel(labels.timeline.inspectDate).inputValue()) < dateAfter(-50)).toBe(true);
  await page.getByRole('button', { name: labels.timeline.latest, exact: true }).click();
  await expect(page.getByLabel(labels.timeline.inspectDate)).toHaveValue(dateAfter(0));
  await page.getByRole('button', { name: labels.timeline.previousDay, exact: true }).click();
  await expect(page.getByLabel(labels.timeline.inspectDate)).toHaveValue(dateAfter(-1));
  await page.mouse.move(20, 20);
  await page.getByRole('heading', { name: labels.timeline.title, exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/shekelsync-spending-timeline.png', fullPage: true, animations: 'disabled' });
});

test('compact timeline remains usable in dark mode', async ({ page }) => {
  await fixture(page);
  await page.goto('/#/plan?tab=spending');
  await page.getByRole('button', { name: 'Switch to Dark Mode', exact: true }).click();
  await page.setViewportSize({ width: 760, height: 900 });
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  const chart = page.getByTestId('spending-timeline');
  await expect(chart).toBeVisible();
  await chart.scrollIntoViewIfNeeded();
  const bounds = await chart.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(760);
  await page.getByRole('button', { name: labels.timeline.previousDay, exact: true }).click();
  await expect(page.getByTestId('spending-summary-growthRemainder')).toContainText('+₪4,000');
  await chart.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/shekelsync-spending-timeline-dark.png', fullPage: true, animations: 'disabled' });
});

test('saved targets immediately move the cumulative horizontal boundaries', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/#/plan?tab=spending');
  await expect(page.getByTestId('spending-timeline')).toBeVisible();
  await page.getByTestId('spending-targets-toggle').click();
  const essential = page.getByRole('slider', { name: 'Essential', exact: true });
  const growth = page.getByRole('slider', { name: 'Growth', exact: true });
  await essential.focus(); await essential.press('ArrowLeft');
  await growth.focus(); await growth.press('ArrowRight');
  const desired = Number(await essential.inputValue());
  const previousY = await page.getByTestId('target-line-essential').getAttribute('y1');
  await page.getByRole('button', { name: en.analysisPage.targets.actions.save, exact: true }).click();
  await expect.poll(() => state.targets.essential).toBe(desired);
  await expect(page.getByTestId('target-line-essential')).toHaveAttribute('data-percentage', String(desired));
  await expect(page.getByTestId('target-line-growth')).toHaveAttribute('data-percentage', '70');
  await expect(page.getByTestId('target-line-essential')).not.toHaveAttribute('y1', previousY!);
});

test('Hebrew timeline preserves percentage direction and amount privacy', async ({ page }) => {
  await fixture(page);
  await page.goto('/#/plan?tab=spending');
  await page.evaluate(() => { localStorage.setItem('finance-mask-amounts', 'true'); });
  await page.reload();
  await expect(page.getByTestId('spending-summary-income')).toContainText('****');
  await expect(page.getByTestId('spending-summary-income')).not.toContainText('10,000');
  await page.getByRole('button', { name: en.titleBar.tooltips.changeLanguage, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Hebrew', exact: true }).click();
  await expect(page.getByRole('heading', { name: he.analysisPage.spendingChart.timeline.title, exact: true })).toBeVisible();
  await expect(page.getByTestId('spending-timeline')).toBeVisible();
  await expect(page.getByTestId('spending-timeline').getByText('125%', { exact: true })).toBeVisible();
  const essentialBox = await page.getByTestId('target-line-essential').boundingBox();
  const growthBox = await page.getByTestId('target-line-growth').boundingBox();
  expect(growthBox!.y).toBeLessThan(essentialBox!.y);
  expect(essentialBox!.width).toBeGreaterThan(100);
  expect(essentialBox!.height).toBeLessThan(3);
  const ticks = page.getByTestId('spending-timeline').locator('.recharts-xAxis-tick-labels text');
  const first = await ticks.first().boundingBox();
  const last = await ticks.last().boundingBox();
  expect(last!.x).toBeGreaterThan(first!.x);
  await page.getByTestId('spending-timeline').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/shekelsync-spending-timeline-he.png', fullPage: true, animations: 'disabled' });
});
